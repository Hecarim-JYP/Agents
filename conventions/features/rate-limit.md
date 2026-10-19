# 레시피: 요청 빈도 제한·봇 방지(CAPTCHA)·WAF/DDoS 경계 `[대외]`

> 확정: 2026-10-16 | 원칙: auth.md 1절(계정 단위 잠금), docker.md 7절(프록시) | 템플릿: `scaffolds/templates/nginx-proxy.conf`·`Caddyfile`(실제 IP 전달) | 짝: account-lifecycle.md(발송 빈도), personal-data.md(접속기록 IP)
> 빈도 제한의 출발점은 **"누구의 요청인가"를 정확히 아는 것**이다. 프록시 뒤 실제 IP를 잘못 얻으면 제한이 **전원에게 한꺼번에 걸리거나(모두가 프록시 IP), 아무에게도 안 걸린다(위조 IP)**.

## 1. 언제 쓰나

외부에 열린 모든 API. 특히 로그인·가입·인증 코드 발송·비밀번호 재설정·검색처럼 비용이 크거나 남용할 가치가 있는 엔드포인트. **3-1절(실제 IP)은 사내 시스템도 해당**한다 — 로그인 이력·접속기록의 IP가 같은 문제를 겪는다.

## 2. 결정 항목 (기본값)

| 결정 | 기본값 | 대안 / 비고 |
|---|---|---|
| 제한 키 | 전역: IP / 로그인: IP (+ 계정 단위 잠금은 auth.md 1절) / 발송: IP + 대상 | **IP만으로 강하게 막지 않는다** — 통신사·회사 NAT 뒤에서는 많은 사용자가 IP 하나를 공유한다 |
| 한도 | 전역 `/api` IP당 **분당 300** · 로그인 IP당 **분당 10** · 발송 IP당 **시간당 20** (대상당 한도는 account-lifecycle.md 2절) | 운영 로그를 보고 조정, CLAUDE.md에 기록 |
| 카운터 저장소 | **앱 메모리** — 단일 인스턴스 전제(docker.md 7절) | 다중 인스턴스면 Redis 등 공유 저장소(multi-instance.md 3-2절 — 실측: 메모리 저장소는 한도가 인스턴스 수 배). CLAUDE.md "다중화 전환 목록"에 기록 |
| 초과 응답 | **429 + `Retry-After` + RateLimit 헤더 + 에러 봉투**(`TOO_MANY_REQUESTS`) | api.md 5절 |
| CAPTCHA 위치 | **상시 아님** — 가입·발송 요청, 로그인 3회 실패 이후 | 제공사(reCAPTCHA·hCaptcha·Turnstile 등) 선택 = 이용자 정보가 제공사로 간다 → 개인정보 처리방침 반영 |
| CAPTCHA 장애 시 | **차단(fail-closed) + 에러 알림**(error-alert.md) | 통과(fail-open)는 장애 동안 봇이 그대로 들어온다 |
| DDoS 대응 주체 | **오픈 전 확인해 CLAUDE.md에 기록** — IDC·클라우드·CDN 중 누가 대용량 공격을 흡수하나 | 앱 빈도 제한은 DDoS를 막지 못한다 (3-4절) |

## 3. 표준 설계

### 3-1. 실제 IP — 프록시가 덮어쓰고, 앱은 1홉만 믿는다 (STRICT)

- **맨 앞 프록시는 `X-Forwarded-For`를 클라이언트가 보낸 값에 이어 붙이지 않고 접속 IP로 덮어쓴다** — nginx `proxy_set_header X-Forwarded-For $remote_addr;`. Caddy는 기본 동작이 덮어쓰기다.
- 앱은 **프록시 1홉만** 신뢰한다 — Express `app.set('trust proxy', 1)`, Spring `server.forward-headers-strategy: native`.

실측 (2026-10-16, nginx 1.24 · Caddy 2.6.2 · Express 4.22 · express-rate-limit 7.5 — 클라이언트 `192.0.2.2` → 프록시 → 앱, 프록시가 앱에 붙는 주소 `127.0.0.1`):

| 구성 | 정상 요청 | 클라이언트가 `X-Forwarded-For: 6.6.6.6` 위조 |
|---|---|---|
| nginx 이어 붙이기(`$proxy_add_x_forwarded_for`) → 앱이 받는 헤더 | 실제 IP | `6.6.6.6, <실제 IP>` |
| nginx 덮어쓰기(`$remote_addr`) → 앱이 받는 헤더 | 실제 IP | 실제 IP |
| Caddy 기본 → 앱이 받는 헤더 | 실제 IP | 실제 IP |
| Express `trust proxy` 미설정 → `req.ip` | `127.0.0.1`(프록시) | `127.0.0.1` — **모든 사용자가 같은 IP** |
| Express `trust proxy = true` → `req.ip` | `192.0.2.2` | **`6.6.6.6`** — 빈도 제한 3회/분에 위조 IP를 바꿔 가며 5회 → 5회 모두 200 |
| Express `trust proxy = 1` → `req.ip` (이어 붙이기·덮어쓰기 모두) | `192.0.2.2` | `192.0.2.2` — 5회 → 200 200 200 429 429 |

- **Spring은 이어 붙이기 방식에서 두 전략 모두 위조값을 채택한다** (원문 소스 확인 2026-10-16):
  - `framework` 전략(`ForwardedHeaderFilter`)은 `X-Forwarded-For`의 **맨 왼쪽 값**을 클라이언트 IP로 쓴다 (spring-web 6.2 `ForwardedHeaderUtils.parseForwardedFor`) → 클라이언트가 보낸 값 그대로.
  - `native` 전략(Tomcat `RemoteIpValve`)은 오른쪽부터 읽으며 **사설 대역(10/8·172.16/12·192.168/16·127/8 등 — `internalProxies` 기본값)을 프록시로 보고 건너뛴다** (Tomcat 10.1) → 사내망처럼 접속 IP가 사설 대역이면 실제 IP를 건너뛰고 그 왼쪽의 위조값을 채택한다.
  - 프록시가 덮어쓰면 값이 하나뿐이라 두 전략 모두 실제 IP가 된다. 그래서 **방어 위치는 앱 설정이 아니라 맨 앞 프록시**다.
- 앞에 로드밸런서·CDN이 추가되면 홉 수가 바뀐다 — nginx `set_real_ip_from`(LB 대역) + `real_ip_header X-Forwarded-For`로 `$remote_addr`를 실제 IP로 복원한 뒤 같은 덮어쓰기를 유지한다 (이 레시피에서 미검증 — 전환 시 위 표를 다시 실측).

### 3-2. 계층별 한도

```js
// 전역 → 엔드포인트별 순서로 건다. 초과 응답은 에러 봉투(api.md 5절)
import rateLimit from 'express-rate-limit';

app.set('trust proxy', 1);                                  // 3-1절 — 이 줄이 없으면 전원이 같은 IP

/**
 * 빈도 제한 미들웨어 생성 — 초과 시 429 + Retry-After + RateLimit 헤더 + 에러 봉투
 * @param {number} windowMs 창 길이(ms)
 * @param {number} limit 창 안에서 허용할 요청 수
 * @param {object} [extra] express-rate-limit 추가 옵션 (예: skip)
 */
const limiter = (windowMs, limit, extra = {}) => rateLimit({
  windowMs, limit, standardHeaders: 'draft-7', legacyHeaders: false, ...extra,
  handler: (req, res) => res.status(429).json({ message: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.', error: 'TOO_MANY_REQUESTS' }),
});

app.use('/api', limiter(60_000, 300, { skip: (req) => req.path.startsWith('/public/') }));   // 공개 API는 연동사별 한도 (public-api.md 3-2절)
app.use('/api/auth/login', limiter(60_000, 10));
app.use(['/api/auth/signup', '/api/auth/password-reset', '/api/auth/send-code'], limiter(3_600_000, 20));
```

- 실측 응답 헤더: `RateLimit-Policy: 3;w=60`, `RateLimit: limit=3, remaining=0, reset=60`, `Retry-After: 60` + 본문 봉투.
- **대상(이메일·휴대폰)당 한도는 메모리 카운터가 아니라 `account_token` 테이블로 계산한다** — 재시작해도 하루 한도가 초기화되지 않고, 인덱스 `(purpose, target, created_at)`가 이미 있다:
  ```sql
  SELECT COUNT(*) AS today_count, MAX(created_at) AS last_sent_at
    FROM account_token
   WHERE purpose = :purpose AND target = :target AND created_at > NOW() - INTERVAL 1 DAY
  ```
  `last_sent_at`이 60초 이내거나 `today_count >= 5`면 429. 단, **응답 문구는 계정 존재 여부와 무관하게 같게** 한다(account-lifecycle.md 3-3절).

### 3-3. CAPTCHA

- 화면이 받은 토큰을 **서버가 제공사 검증 API로 확인**한다 — 화면에서만 확인하면 API를 직접 호출해 건너뛴다. 검증 호출은 `external/` 연동 계층 + 타임아웃(integration.md 4절).
- 서버 검증에서 성공 여부와 함께 **호스트명(제공사가 주면 action도)** 을 확인한다 — 다른 사이트에서 받은 토큰을 재사용하는 것을 막는다.
- 제공사 장애(타임아웃·5xx)는 2절 기본값대로 차단 + 에러 알림.
- 실측하지 않았다(외부 서비스) — 도입 시 /live-test에서 실제 키로 확인한다.

### 3-4. 경계 — 앱이 막는 것과 못 막는 것

| 공격 | 막는 층 |
|---|---|
| 대용량 트래픽(회선 포화) | 회선·IDC·클라우드·CDN — **요청이 앱에 오기 전에 회선이 찬다** |
| 대량 HTTP 요청 | CDN·WAF의 빈도 규칙 → 프록시 → 앱(3-2절) |
| 계정 대입·비밀번호 스프레이 | 앱 — IP 한도 + 계정 잠금 + 흔한 비밀번호 차단(auth.md 1절) |
| 기능 남용(발송·가입·검색) | 앱 — 대상 키 한도 + CAPTCHA |
| 알려진 공격 패턴(SQL 인젝션 등) | WAF는 보조. 본 방어는 바인딩 파라미터(sql.md)·출력 인코딩 |

## 4. 함정 (STRICT)

| 함정 | 증상 | 처방 |
|---|---|---|
| `trust proxy` 미설정 | 모든 요청이 프록시 IP — 한 사람이 한도를 채우면 **전원이 429**, 접속기록 IP가 전부 프록시 (실측) | `trust proxy 1` |
| `trust proxy = true` | `X-Forwarded-For` 위조로 IP를 바꿔 가며 무제한 (실측 5회 모두 200). express-rate-limit은 `ERR_ERL_PERMISSIVE_TRUST_PROXY` 로그만 남기고 막지 않는다 | `trust proxy 1` |
| 프록시가 이어 붙이기 + Spring | `framework`는 맨 왼쪽 위조값, `native`는 사설 대역 접속 IP를 건너뛰고 위조값 (원문 소스) | 프록시에서 덮어쓰기 (3-1절) |
| IP만으로 강한 제한 | NAT 뒤 정상 사용자가 함께 차단 | 키 조합, IP 한도는 넉넉히 |
| 메모리 카운터 + 다중 인스턴스 | 인스턴스 수만큼 한도가 늘어난다 | 공유 저장소 |
| 하루 한도를 메모리에만 | 재시작하면 초기화 | `account_token`으로 계산 (3-2절) |
| CAPTCHA를 화면에서만 확인 | API 직접 호출로 우회 | 서버 검증 |
| 429 기본 응답(문자열) | 화면이 에러 봉투를 못 읽는다 | `handler`로 봉투 |

## 5. 스택별 구현

| 구성 | Express | Spring |
|---|---|---|
| 실제 IP | `app.set('trust proxy', 1)` + `req.ip` | `server.forward-headers-strategy: native` + `request.getRemoteAddr()` (프록시 덮어쓰기 전제) |
| 빈도 제한 | express-rate-limit (7.x 실측) | Bucket4j 등 — 필터에서 (이 레시피에서 미검증) |
| 대상당 한도 | `account_token` 집계 쿼리 | 동일 |
| CAPTCHA 검증 | `external/captcha` 클라이언트 | 동일 |

## 6. 검증 포인트

- 자동화 테스트: 한도+1번째 요청 → 429 + 봉투 + `Retry-After` / 대상당 60초 안 재발송 → 429.
  - ⚠ **앱 단독 테스트로는 IP 위조 방어를 검증할 수 없다** — supertest 같은 클라이언트는 앱에 직접 붙으므로 그 자신이 "1홉"이 되어 보낸 `X-Forwarded-For`가 그대로 믿어진다. 방어는 프록시에 있다.
- 실동작 검증(/live-test): **배포 구성(프록시 포함)으로** `X-Forwarded-For: 6.6.6.6`을 붙여 로그인 실패 → `login_history.ip_address`가 실제 IP인지, 같은 IP로 한도 초과 시 다른 PC는 정상인지.
