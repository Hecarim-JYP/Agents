# 변경 이력 — 2026-10-19

> 작업 베이스 커밋 a025c91(10-16 변경 이력 갱신) 이후 5커밋.
> 사용자 요청 "3-2차 진행해" — 운영 기능 카탈로그 `[대외]`의 남은 11개 항목을 레시피 10개로 묶어 진행했다. 이번에는 **Docker가 동작해(mirror.gcr.io 이미지) 스캐폴드 compose 템플릿 그대로 스택을 띄워** 배포·프록시 동작을 실측할 수 있었다.
> 핵심 주제: **① 스캐폴드 배포 흐름의 결함 정정 — 재배포 후 서비스 전체가 점검 안내 503에 고정 ② 레시피 10개 + 스키마 4개 ③ 3-1차 "MySQL 8.0 미검증" 해소**

---

## 1. 스캐폴드 배포 결함 — 재배포 후 서비스 전체 503 고정 (fix)

기존: nginx 프록시 템플릿이 `proxy_pass http://server:3000;`처럼 컨테이너 이름을 고정으로 써서, nginx가 **기동할 때 한 번만** IP를 해석했다.
변경: Docker 내장 DNS로 요청 시점에 다시 해석(`resolver 127.0.0.11 valid=1s` + 변수 `proxy_pass`) + `proxy_connect_timeout 2s`.

| 실측 (Docker 29.8 · compose 5.6 · nginx-unprivileged 1.27, 스캐폴드 compose 템플릿 그대로) | 결과 |
|---|---|
| client·server를 같은 태그로 함께 재배포 (일반적인 배포) | **두 컨테이너가 IP를 맞바꿈** → `/api`·화면 모두 503 고정, 재배포를 반복해도 풀리지 않음. proxy 재시작으로만 복구 |
| server 재배포 중 다른 컨테이너가 옛 IP를 차지 | 고정 해석 20초 내내 503 / 재해석 0.3초 후 200 |
| 순차 교체 중 DNS 캐시 5초 + 연결 타임아웃 기본 60초 | 최대 응답 **60,057ms**, 503 531건 |
| 최종 템플릿(1초 + 2초)으로 부하 중 순차 교체 3회 | **실패 0건**, 최대 2초대 |
| Caddy 템플릿 | 기본 동작이 재해석 — 0.3초 복구 |

**변경 파일**: `scaffolds/templates/nginx-proxy.conf`, `Caddyfile`(주석), `conventions/docker.md` 7절(STRICT — 고정 이름으로 바꾸지 않는다)

## 2. 프록시 압축 (feat)

- 베이스 이미지 `nginx-unprivileged:1.27`의 nginx.conf는 `#gzip on;`(꺼짐)이고 템플릿도 켜지 않아 **JS·JSON이 원본 크기로 나갔다**(실측).
- 프록시에서 gzip(nginx)·zstd/gzip(Caddy `encode`)을 켰다 — 실측 JS 143,738 → 54,312바이트, 목록 JSON 10,100 → 589바이트. nginx gzip은 200·403·404 응답만 압축한다(201은 안 됨 — 실측).

**변경 파일**: `scaffolds/templates/nginx-proxy.conf`, `Caddyfile`

## 3. 레시피 10개 + 스키마 4개 (feat)

| 레시피 | 스키마 | 실측으로 확정한 함정 |
|---|---|---|
| `zero-downtime-deploy.md` 무중단 배포 | — | 1절 + **`.env` 태그를 나중에 바꾸면 다른 compose 명령이 server를 옛 태그로 되돌림** / client 두 버전 공존 중 화면 열기 60회 중 **33회 JS 404**(순차 교체 금지) / SIGKILL로 빼면 처리 중 POST 3건 실패 / HEALTHCHECK `interval=30s`면 healthy까지 31초(`--start-interval`로 3초) |
| `multi-instance.md` 다중 인스턴스 ⚑ | — | 2개로 늘리면: 빈도 제한 3회 → **6회**, 설정 변경 후 한쪽만 옛 값, 업로드 절반 404, 하루 1회 작업 2회 실행 → Redis 저장소·pub/sub 무효화로 해소(실측). 같은 호스트 복제본은 named volume 공유, MariaDB 11.4 `max_connections` 151 |
| `static-assets.md` 정적 자산 | — | 배포 후 열린 탭의 옛 청크 404 → **흰 화면**, `vite:preloadError` 새로고침으로 해소 / 캐시 프록시가 Cache-Control 없는 개인 파일을 **다른 사용자에게 줌**(`private, no-store`로 해소) / 썸네일 요청 시 생성 91ms·목록 20건 510ms |
| `load-test.md` 부하 테스트 | — | 풀 크기 10 → 481 req/s·p50 205ms, 50 → 2,158 req/s (**오류 0 — 지연으로만 드러남**) / **bcryptjs는 로그인 몰림 동안 다른 API 처리량 0**, 네이티브 bcrypt는 영향 없음, 스레드풀 증설은 효과 미미 |
| `error-pages.md` 에러 응답·화면·상태 페이지 | — | 흔한 errorHandler는 깨진 JSON·용량 초과를 **전부 500**(5xx 알림 소음) / 최상위 ErrorBoundary 없으면 흰 화면 |
| `seo.md` 검색 노출 ⚑ | — | SPA는 수집기에 모든 경로가 같은 제목·빈 본문·200 / 프리렌더를 디렉터리로 저장하면 **301 + Location에 내부 포트** / 루트 프리렌더가 SPA 껍데기를 덮어씀 → 프리렌더 모드 nginx 설정(실측) |
| `social-login.md` 소셜 로그인 ⚑ | `18_user_identity.sql` | 이메일이 같으면 자동 연결 → **미인증 사전 가입 계정을 통한 탈취**(시뮬레이션), 양쪽 인증 확인 + 미인증 계정 무효화로 차단 |
| `account-withdrawal.md` 탈퇴·파기·분리 보관 ⚑ | `20_retained_personal_data.sql` | `is_active = 0`만이면 개인정보 잔존 + **같은 이메일 재가입 ER_DUP_ENTRY** / 별도 스키마 이동은 같은 트랜잭션에 묶임(롤백 실측) |
| `consent.md` 동의 이력 ⚑ | `19_terms_consent.sql` | 추가 전용 트리거가 UPDATE 거부 / **MySQL 8에서 앱 계정으로 트리거 생성 → ERROR 1419**(테이블만 생기고 중단) — 관리자 계정으로 실행하면 정상 / 재동의 판정 SQL 양쪽 DB 동일 결과 |
| `inquiry.md` 문의·신고 | `21_inquiry.sql` | 같은 신고자 동시 5회 → UNIQUE로 1건 |

**법령·제공사 사양 확인 범위** (법제처·카카오·네이버 사이트는 이 환경에서 접속 불가 — 검색 결과로 교차 확인):
- 확인: 개인정보 유효기간제(휴면 분리 의무) **2023-09-15 시행 개정으로 폐지**, 2023 개정 제15조('불가피하게' 삭제)·제22조(구분 동의, 선택 미동의로 서비스 거부 금지), 구글 OIDC discovery 원문(`email_verified`, PKCE S256), 카카오 회원번호 앱 종속·탈퇴 시 연결 끊기 안내(데브톡).
- **원문 미확인**: 전자상거래법 시행령 제6조 보존기간 중 3년(소비자 불만·분쟁처리), 파기 "5일 이내"(교육부 지침 기반 2차 자료), 네이버 OIDC·이메일 인증 필드 — 각 레시피 1-1절에 표시하고 **법무 확인 후 CLAUDE.md 기록을 MANDATORY**로 했다.

## 4. 기존 문서 연결 (docs)

- 시작 결정 체크리스트 **29(검색 노출)·30(대외 자체 가입 계정 정책)** 신설, 22번 근거에 multi-instance 링크, 기초 테이블 18~21
- `auth.md` 6절: **순수 JS `bcryptjs` 금지**(이벤트 루프 차단 실측), 소셜 로그인 행 / `express.md` 3절: 본문 파싱 400·용량 초과 413 / `react.md` 8절: 최상위 ErrorBoundary + 청크 실패 새로고침 / `ops.md` 2절: `DEPLOY_TAG`부터 갱신, 7절: 장애 공지 경로 / `patterns.md` 0-3절·`migration.md` 4절·`cache.md`·`rate-limit.md`·`error-alert.md`·`account-lifecycle.md`·`personal-data.md` 링크
- catalog `[대외]` 전 항목 📄(3-1·3-2차 완료 — 남은 것은 4차), `dev-rules` 카탈로그 기능 목록, 프로필 29·30, OVERVIEW 1.8, README

## 5. 발견했지만 고치지 않음 (확인 필요)

| 항목 | 내용 |
|---|---|
| nginx 템플릿의 `listen [::]:8080;` | IPv6를 커널에서 끈 호스트(`ipv6.disable=1`)에서는 **nginx가 기동하지 못한다**(이 환경에서 실측: `socket() [::]:8080 failed (97)`). 기본 compose 네트워크는 IPv4라 이 줄의 이득은 작다 — 제거 또는 유지 결정 필요 → **같은 날 제거 (11절)** |
| JWT 서명 시크릿 변수 | 10-16에 보고한 그대로 — compose 템플릿·`.env.example`에 연결 지점이 없다 → **같은 날 해소 (6절)** |

---

## 검증

| 항목 | 결과 |
|---|---|
| `node scripts/check-refs.mjs` | 통과 — 문서 56개 / 참조 501건 (skills·agents 포함 확장: 65개 / 522건) |
| `scripts/verify-templates.sh` | 통과 — 두 모드 compose 병합·치환 정상 |
| 프록시 템플릿 실기동 (Docker, 스캐폴드 compose 그대로) | nginx: 기본 헤더·XFF 덮어쓰기·압축·앱 정지 시 503 안내(`/health` 502)·IP 변경 0.3초 복구·순차 교체 3회 실패 0 / Spring 헬스 변형(변수 + URI) 정상 / `nginx -t` 통과 / Caddy: `caddy validate`·`fmt` 통과, gzip·zstd, IP 변경 0.3초 복구 |
| 스키마 22종 | MariaDB 10.11 전부 적용 / MySQL 8.0.46 전부 적용(19번 트리거만 ERROR 1419 — 관리자 계정 실행 시 정상, 앱 계정 UPDATE 차단 확인) |
| 3-1차 레시피 SQL의 MySQL 8.0 검증 | **해소** — account-lifecycle·mfa 레시피 SQL이 MySQL 8.0.46에서 MariaDB와 같은 결과 |
| `install.sh` 임시 HOME 설치 | 레시피 34개·스키마 22개 설치 확인 |
| 환경 제약으로 바꿔서 잰 것 | 이 커널에 IPv6가 없어 실측용 복사본에서만 `listen [::]:8080;` 제외(5절), 빌드 컨테이너는 npm 접근 불가라 호스트에서 설치한 `node_modules` 사용 — 둘 다 측정 대상(프록시·종료·배포 동작)과 무관 |
| 실측 안 한 것 | CAPTCHA·카카오·네이버 실제 연동, ClamAV, Spring 쪽 구현(Bucket4j·Redis·예외 매핑), 여러 호스트 구성, Playwright 이미지로의 프리렌더 CI — 각 레시피에 "미검증" 표기 |
| `install.ps1` 재실행 | **미수행** — 회사 PC에서 `git pull` 후 실행 필요 |

---

## 커밋 코멘트

```
@@ 2026-10-19 @@
운영 기능 카탈로그 3-2차 — [대외] 레시피 10개 + 재배포 후 서비스 전체 503 고정 결함 정정

■ 결함 정정 (스캐폴드 compose 그대로 실기동해 재현)
- nginx 프록시가 컨테이너 이름을 기동 때만 해석 → 재배포로 IP가 바뀌면(client·server 맞바꿈) 전체 503 고정
  → resolver 127.0.0.11 valid=1s + 변수 proxy_pass + proxy_connect_timeout 2s (순차 교체 3회 실패 0)
- 압축 꺼짐(베이스 이미지 기본) → 프록시 gzip / Caddy encode

■ 레시피 (conventions/features/)
- zero-downtime-deploy, multi-instance, static-assets, load-test, error-pages, seo
- social-login, account-withdrawal, consent, inquiry
- schemas: 18_user_identity, 19_terms_consent, 20_retained_personal_data, 21_inquiry

■ 연결
- 체크리스트 29(검색 노출)·30(대외 계정 정책), auth.md bcryptjs 금지, express.md 400/413, react.md ErrorBoundary
- 3-1차 레시피 SQL MySQL 8.0 검증 완료
```

---
---

# 2부 — JWT 시크릿 연결 + 4차(법적 요건 묶음)

> 사용자 요청 "jwt 환경변수는 example 에 등록해야지 / 그리고 4차도 진행해". 1부 이후 커밋.
> 핵심 주제: **① 서명 키를 `.env.example`·compose에 연결 + 환경변수 추가 규칙 보강 ② 4차 레시피 8개 + 스키마 4개 ③ 법령 원문 확인 경로 확보(legalize-kr) — 3-2차 "원문 미확인" 해소**

## 6. JWT 서명 시크릿을 `.env.example`·compose에 연결 (fix)

기존: 규칙(auth.md 2절 "서명 키는 환경변수로만")과 코드 예시는 있는데, `.env.example`·compose server `environment:` 어디에도 자리가 없어 매 프로젝트가 직접 추가하다 빠뜨릴 수 있었다.
변경:
- compose server에 `JWT_SECRET: ${JWT_SECRET:?JWT_SECRET 미설정}` — 비어 있으면 기동 전에 실패(실측: 메시지 그대로 출력)
- `.env.example`에 빈 `JWT_SECRET=` + 생성 명령 주석, 스캐폴드 생성 절차 3에서 **랜덤값(48바이트 base64)으로 채움**(example에는 값을 넣지 않는다)
- `auth.md`·`spring.md`가 같은 변수명을 가리키게, `verify-templates.sh`/`.ps1`에 검증용 더미 값
- **`ops.md` 1절 규칙 보강 (MANDATORY)**: 새 환경변수는 `.env.example`과 compose server `environment:` **양쪽에** — base는 `.env`를 통째 주입하지 않으므로(docker.md 4-1절) example에만 넣으면 컨테이너에 값이 들어가지 않는다. 4차 레시피의 키(`FIELD_ENC_KEY_V{n}`·`UNSUBSCRIBE_KEY`·`PG_SECRET_KEY`·`WEBHOOK_SECRET_{SOURCE}`)도 이 규칙으로 안내

**변경 파일**: `scaffolds/templates/docker-compose.yml`, `scaffolds/default.md`, `conventions/auth.md`, `conventions/spring.md`, `conventions/ops.md`, `scripts/verify-templates.sh`, `scripts/verify-templates.ps1`

## 7. 법령 원문 확인 경로 (docs)

- 법제처(law.go.kr)는 이 환경에서 접속 불가(403). **법제처 데이터를 마크다운으로 옮긴 공개 git 저장소(legalize-kr — 법령·행정규칙)** 를 읽기 전용으로 받아 조문을 직접 확인했다. 각 레시피 1-1절에 "원문 확인 2026-10-19 — legalize-kr"와 판본(공포·시행일)을 적었다.
- 이 경로로 **1부 3절의 원문 미확인 항목을 해소**했다:

| 항목 | 확인 결과 | 반영 |
|---|---|---|
| 전자상거래법 시행령 제6조 보존기간 | 표시·광고 6개월 / 계약·청약철회 5년 / 대금결제·공급 5년 / **소비자 불만·분쟁처리 3년** + 동의 철회 소비자 기록 별도 보존(②3호) — 2026-07-21 시행본 | account-withdrawal.md, inquiry.md(보관 3년) |
| 파기 5일 | **표준 개인정보 보호지침 제10조** — 5일 이내 파기, 기록, 책임자 확인 / 제11조 분리 보관 + 처리방침 고지 (2025-04-11 시행본) | account-withdrawal.md |
| 장기 미이용 분리(휴면) | 현행 법률·시행령에 조항 없음 확인 | account-withdrawal.md |
| 동의 관련 | 제15조 ①4호, 제22조 ①③⑤, 시행령 제17조 ①②④ | consent.md |
| 접속기록 점검 주기 | 현행 고시는 주기를 정하지 않는다(이전 판본의 "월 1회"는 현행 문언에 없음) — 내부 관리계획으로 정해 이행 | personal-data.md |

## 8. 4차 레시피 8개 + 스키마 4개 (feat)

| 레시피 | 스키마 | 원문 확인한 법정 요건 | 실측으로 확정한 함정 |
|---|---|---|---|
| `field-encryption.md` 민감 정보 암호화 ⚑ | — | 개인정보 보호법 제24조의2, 시행령 제21조의2, 안전성 확보조치 기준 제7조 ②③⑥ | DB `AES_ENCRYPT`는 **같은 평문 → 같은 암호문**(ECB) + **키·평문이 일반 로그에 그대로** / 앱 GCM + 블라인드 인덱스: 하이픈 없이 검색 성공·인덱스 사용, 1만 행 복호화 63~82ms, 키 교체 후 옛 행 복호화 |
| `privacy-rights.md` 열람·정정·삭제·처리정지 | `25_privacy_request.sql` | 법 제35~38조, 시행령 제41~47조, 표준지침 제31~34조, 민법 제155~161조 — **받은 날부터 달력일 10일**, 연기·거절은 사유 + 이의제기방법, 수집 때 요구 안 한 증빙 금지 | **영업일로 세면 3~4일 늦은 기한**(10-19 접수 → 11-02, 법정 10-29) / UTC 날짜로 자르면 통지 기한이 하루 틀림 — Node·Java 같은 결과 |
| `marketing-message.md` 광고성 정보 발송 | (19번 `terms_type`·`channel` 값 추가) | 정보통신망법 제50조, 시행령 제61~62조의3 — 사전 동의, **21~08시 별도 동의(전자우편 제외)**, 동의·거부 처리 결과 **14일 내 통지**, **2년마다 확인** | 컨테이너 UTC에서 `getHours()`가 한국 22:30을 13시로 → **야간 광고 발송** / **2024-02-29 + 2년: JS는 03-01(하루 늦음), DB `DATE_ADD`는 02-28** / 재확인 SQL 양쪽 DB 동일 |
| `payment.md` 결제(PG) ⚑ | `24_payment.sql` | 전자상거래법 제17·18조, 시행령 제21조·제21조의3 — 청약철회 7일, **환급 3영업일**, 지연배상 연 15% | 리다이렉트 금액 그대로 승인 → **5만 원 주문이 100원 결제로 완료** / 승인 응답 유실을 실패로 → **돈은 나갔는데 주문 실패** / **취소 재시도마다 새 멱등 키 → 3만 원 결제에 6만 원 환불** / 동시 부분 취소는 조건부 UPDATE로 1건만 |
| `webhook-receive.md` 웹훅 수신 | `22_webhook_inbox.sql` | (법정 요건 없음 — 서명 방식은 Standard Webhooks, 2차 출처) | 재직렬화 본문 검증 → 정상 웹훅 전부 401 / **전역 `express.json()` 뒤 라우트 `verify`는 실행되지 않음** / 요청 안에서 처리 → 제공사 4회 재전송·4회 처리 / 수신함 + 즉시 200 → 1회·31ms |
| `public-api.md` 공개 API ⚑ | `23_api_client.sql` | — | **전역 IP 한도가 공개 API와 같은 IP의 화면 API까지 429** → `skip`으로 제외 / 폐기 후 캐시 30초 동안 통과 / base64url 비밀 1000개 중 491개에 `_` → `split('_')` 금지 |
| `mail-domain-auth.md` SPF·DKIM·DMARC | — | (수신 측 요건 — Gmail 가이드라인·RFC 8058, 2차 출처) | mailauth 검증: SPF include 11개 → permerror, `From` 도메인 불일치 → DMARC fail, 본문 변경 + 미등록 IP → DMARC fail / **nodemailer 기본 DKIM 서명에 `List-Unsubscribe-Post`가 빠짐** → `headerFieldNames` 지정 |
| `gdpr.md` 해외 이용자·국외 이전 | — | 개인정보 보호법 제28조의8(국외 이전 — 조회 포함). GDPR 제3·27조·적정성 결정은 2차 출처 | 분석 스크립트를 HTML에 직접 → **동의 전 쿠키 생성** / 동의 게이트: 거부 시 `consent`만 |

**원문을 확인하지 못한 것** (레시피에 "미확인·2차 출처"로 표시, 착수 시 확인 MANDATORY): 정보통신망법 시행령 **별표 6**("(광고)" 표기 방법), GDPR 제12조 ③(1개월)·제33조(72시간)·ePrivacy 쿠키 요건, PG 승인 가능 시간·웹훅 서명 여부, Gmail 가이드라인 원문(접근 불가), 열람등요구 통지서 고시 서식.

## 9. 기존 문서 연결 (docs)

- 시작 결정 체크리스트 **27 보강**(고유식별정보·카드·계좌 저장 시 앱 계층 암호화), **31(결제 PG)·32(외부 공개 API)** 신설, 기초 테이블 22~25 포함 조건, 절차 1의 "23개" → 32개(낡은 수치 정정)
- `rate-limit.md` 3-2절: limiter가 추가 옵션을 받고 전역 한도에서 공개 API 제외 / `integration.md` 1·4절: 웹훅·공개 API·결제 승인 링크 / `api.md` 1절: `/api/public/v1` / `notification.md` 3-3절: 메일 도메인 인증·광고성 정보 분리 / `personal-data.md`·`consent.md`·`account-withdrawal.md` 짝 링크
- `19_terms_consent.sql` 주석: `MARKETING_{EMAIL|SMS|PUSH|NIGHT}`, `channel = UNSUBSCRIBE`
- catalog 4차 전 항목 📄 — **카탈로그의 모든 항목이 레시피 또는 기존 컨벤션으로 채워졌다**, `dev-rules` 기능 목록, 프로필 31·32 + 미적용 신호, OVERVIEW 1.9(스키마 26종·체크리스트 32항목), README

## 10. 발견했지만 고치지 않음 (확인 필요)

| 항목 | 내용 |
|---|---|
| nginx 템플릿의 `listen [::]:8080;` | 1부 5절 그대로 — 사용자에게 영향 분석을 보고하고 결정 대기 → **사용자 결정으로 제거 (11절)** |

## 11. nginx 템플릿에서 IPv6 리슨 제거 (fix)

기존: `nginx.conf`·`nginx-proxy.conf`에 `listen [::]:8080;` — "IPv6로 들어오는 접속까지 받기 위해".
변경: `listen 8080;`(IPv4)만 두고, `docker.md` 2-3절을 **[::] 리슨 금지(STRICT)** 로 바꿨다. IPv6 네트워크를 켜서 직접 받는 구성일 때만 프로젝트에서 추가하고 CLAUDE.md에 기록한다.

| 확인 | 결과 |
|---|---|
| 이득이 있는 경로 | 없음 — 기본 compose 네트워크 IPv6 꺼짐, 프록시 DNS `ipv6=off`, 호스트 공개 포트는 IPv6 사용자 요청도 컨테이너 IPv4로 전달, 헬스체크는 `127.0.0.1` 고정 |
| 손해 (커널 IPv6 없는 호스트, 로컬 nginx 1.24로 템플릿 그대로 기동) | 수정 전 두 템플릿 모두 `socket() [::]:8080 failed (97: Address family not supported by protocol)`로 **기동 실패** / 수정 후 둘 다 기동 — 정적 `/` 200, 프록시는 upstream 없음 안내 503(템플릿 동작 그대로) |

**변경 파일**: `scaffolds/templates/nginx.conf`, `scaffolds/templates/nginx-proxy.conf`, `conventions/docker.md`

---

## 검증 (2부)

| 항목 | 결과 |
|---|---|
| `node scripts/check-refs.mjs` | 통과 — 문서 64개 / 참조 562건 (skills·agents 포함 확장: 73개 / 579건), 맨 파일명 참조도 전부 실재 |
| `scripts/verify-templates.sh` | 통과 — 두 모드 compose 병합·치환 정상, `JWT_SECRET` 없으면 "JWT_SECRET 미설정"으로 실패 |
| 스키마 26종 | 새 DB에 00~25 전부 적용 — MariaDB 10.11·MySQL 8.0.46(관리자 계정) 모두 39개 테이블, 오류 0 |
| 레시피 SQL 원문 그대로 실행 | 열람등요구 기한 감시·광고 2년 확인·부분 취소 한도 — 양쪽 DB 같은 결과 |
| 실측 스크립트 | 8절 표 전부 — Node 22 · Express 4.22 · express-rate-limit 7.5 · mysql2 3.24 · nodemailer 6.10 · mailauth 4.13 · Chromium 헤드리스 · Java 21 |
| `install.sh` 임시 HOME 설치 | 레시피 42개·스키마 26개, 설치본과 저장소 conventions 동일 |
| 실측 안 한 것 | 실제 PG·실제 수신함(Gmail)·실제 DNS, Spring 쪽 구현(AES-GCM·웹훅 원본 바이트·API 키 필터) — 각 레시피에 "미검증" 표기 |
| `verify-templates.ps1`·`install.ps1` 실행 | **미수행** — 이 환경에 PowerShell 없음. `.ps1`은 BOM·CRLF 유지만 확인. 회사 PC에서 `git pull` 후 `install.ps1` 실행 필요 |

---

## 커밋 코멘트 (2부)

```
@@ 2026-10-19 (2부) @@
JWT 서명 키를 .env.example·compose에 연결 + 운영 기능 카탈로그 4차(법적 요건 묶음) 레시피 8개

■ 결함 정정
- JWT_SECRET: 규칙만 있고 .env.example·compose에 자리가 없던 것 → 양쪽 연결, 미설정 시 기동 실패
- ops.md 1절: 새 환경변수는 .env.example + compose server environment 양쪽에 (MANDATORY)

■ 레시피 (conventions/features/) — 법령은 legalize-kr로 원문 확인
- field-encryption, privacy-rights, marketing-message, payment
- webhook-receive, public-api, mail-domain-auth, gdpr
- schemas: 22_webhook_inbox, 23_api_client, 24_payment, 25_privacy_request

■ 연결
- 체크리스트 27 보강·31(결제)·32(공개 API), rate-limit 전역 한도에서 공개 API 제외
- 3-2차 원문 미확인(보존 3년·파기 5일·휴면) 해소

■ nginx 템플릿 IPv6 리슨 제거
- listen [::]:8080 → IPv6를 끈 호스트에서 nginx 기동 실패(실측), 기본 구성에서 이득 없음 → IPv4만 (docker.md 2-3절 STRICT)
```

---
---

# 3부 — 전체 검증 (스택 버전·스캐폴드·훅·템플릿)

> 사용자 요청: "전체 검증 한 번 돌려봐 — 어제 new project 해봤는데 스프링 버전 3 얘기하던데 전부 다 확인해봐".
> 방법: 문서·템플릿의 버전 표기를 **Maven Central·npm·Docker Hub의 현행과 대조**하고, **최신 버전으로 실제 프로젝트를 만들어** 문서 코드·템플릿·훅을 그대로 돌렸다. 핵심: **① "Spring 3"의 원인 — Spring 빌드 템플릿 부재 ② 스캐폴드가 지금 그대로는 깨진다(ESLint 설치 ERESOLVE) ③ 순환 의존 린트와 훅 타입 검사가 조용히 무력이었다**

## 12. "Spring 3"의 원인과 정정 (fix)

- 해당 세션 기록은 이 환경에서 볼 수 없어 원인은 재현으로 좁혔다. `spring.md`는 이미 Boot 4.x를 명시하지만 **스캐폴드가 Initializr 산출물에만 의존하고 대체 경로가 없었다** — Initializr에 접근하지 못하면 `build.gradle`을 기억(학습 데이터 기본값 = Boot 3.x)으로 쓰게 된다(이 환경도 start.spring.io가 차단). 문서에도 3.x 시절 문구가 남아 있었다.
- 사실 확인(Maven Central, 2026-10-19): **Boot 3.x의 마지막 OSS 릴리스는 3.5.16(2026-06-25)**, 현행 4.0.8·4.1.1(2026-08-20), 4.2.0-M2. Boot 4 = Framework 7.0.9 · Security 7.1 · Jackson 3.1 · JUnit 6.0 · Hibernate 7.4 · Tomcat 11.

| 항목 | 기존 | 변경 (근거) |
|---|---|---|
| 빌드 파일 | Initializr 산출물만 | **`scaffolds/templates/build.gradle`·`checkstyle.xml` 신설** — Boot 4.1.1·Gradle 9.8.2 실빌드 검증, Initializr를 못 쓸 때 이걸로 시작하고 버전을 최신 GA로 갱신. spring.md 0절에 **"Boot 3.x로 시작하지 않는다(STRICT)"** |
| `@MockBean` (testing·integration) | 안내 | **`@MockitoBean`** — Boot 4에서 `@MockBean`은 제거(실측: 패키지 없음 컴파일 오류) |
| JUnit 5 (spring·testing·scaffold·profile) | 표기 | JUnit Jupiter(Boot 4 관리 — 6.x), `@WebMvcTest`는 `spring-boot-starter-webmvc-test` |
| jsr310 모듈 | "기본" | Jackson 3 내장 — 따로 넣지 않는다(실측: `LocalDate` ISO 직렬화) |
| MyBatis | "Boot 4.0.x 고정(4.1 미지원)" | **해제** — 스타터 4.1.0이 2026-07-16 출시, Boot 4.1.1에서 전체 기동·실DB 조회(실측). 스타터 대응 버전을 맞춘다 |
| QueryDSL | 좌표 없음 | 원 저장소 5.1.0(2024-01) 이후 출시 없음 → 포크 `io.github.openfeign.querydsl` 7.x (실측: Boot 4.1.1·Hibernate 7.4 조회 정상) |
| Spotless 6.25.0 / Checkstyle 10.17.0 | spring.md에 고정 | 템플릿으로 이동 — 8.10.4(6.25.0은 Gradle 11에서 제거될 API 경고)·14.3.0 |
| "Checkstyle이 순환 의존 검사" | spring.md 7절 | **틀린 기술** — Checkstyle에 그런 검사가 없다. ArchUnit `ArchitectureTest` 추가(실측: 순환 → `check` 실패) |
| 예외 처리 예시 (spring.md 4절) | NotFound + Exception 핸들러 | **버전 무관 결함** — 그대로 쓰면 검증 실패·깨진 JSON이 500. 검증 400(snake_case `field`)·본문 400·업로드 413·프레임워크 예외는 자기 상태(404·405) 코드로 교체(실측) |

## 13. Boot 4에서 그대로인 것 (실측 2026-10-19, Boot 4.1.1 · Gradle 9.8.2 · Java 21)

snake_case 전역 설정·`@JsonInclude(NON_NULL)` / 요청 ID 필터·MDC / 커밋 후 리스너 + `REQUIRES_NEW` 정상 기동, 기본 전파면 `IllegalStateException`으로 기동 실패(Framework 7.0.9) / `server.shutdown` 미지정이어도 graceful / `forward-headers-strategy` framework = XFF 맨 왼쪽(위조 가능)·native = 마지막 공인 IP / `@MockBean` 컴파일 오류 — 각 레시피에 Boot 4 재확인을 병기했다.

## 14. Node 최신 메이저 재검증 (실측 2026-10-19)

레시피 실측은 Express 4.22·express-rate-limit 7.5·nodemailer 6.10 등으로 했지만 **지금 `npm i`는 Express 5.3·express-rate-limit 8.7·zod 4.6·multer 2.4·nodemailer 10.1·mailauth 8.0·file-type 22·pino 10·bcrypt 6·redis 6·rate-limit-redis 6·vitest 5를 설치한다.** 레시피 코드를 그대로 돌린 결과 **모두 문서대로** 동작했다: 본문 파싱 400·용량 413(`err.type` 값 동일)·zod 4 `issues`·로그인 한도 429·Redis 저장소 한도·웹훅 파서 순서·DKIM/SPF/DMARC 6개 상황·원클릭 헤더 서명 범위(nodemailer 10도 기본 서명에서 `List-Unsubscribe-Post` 누락)·`fileTypeFromBuffer`·pino `mixin`·bcrypt `'!'` 해시·sharp 픽셀 상한·autocannon 결과 필드·Express 5 라우트 템플릿/`req.baseUrl`/trust proxy. 차이 하나 — **Express 5는 async 예외를 `asyncHandler` 없이도 errorHandler로 넘긴다**(express.md·error-alert.md에 병기).

## 15. 스캐폴드 결함 (실측) — 지금 그대로는 새 프로젝트가 깨진다

| 결함 | 증상 | 처방 |
|---|---|---|
| **ESLint 설치 ERESOLVE** | 최신 Vite 템플릿(create-vite 9.3)이 **TypeScript ~7.0**을 넣는데 typescript-eslint 8.72는 `typescript <6.1.0` — 스캐폴드 절차의 `npm i -D …`가 실패 | TS 프로젝트는 `typescript@~6.0.3` 먼저 고정(default.md 린트 절·템플릿 헤더). 고정 후 설치·`npm run build`·린트 통과 |
| **`import/no-cycle` 무력** | TS 템플릿 2종에서 순환을 **0건** 검출(파서·리졸버 설정 없음), JS 클라이언트는 `@/` 별칭 순환 누락. 2026-07-17 검증의 "client 7건 전부 검출"은 규칙 8개 중 순환을 뺀 7개였다 | 템플릿 4종에 `import/parsers` + `eslint-import-resolver-typescript` — 상대경로·별칭 순환 모두 검출, 오탐 없음, 나머지 규칙 전부 재검출 |
| **훅 타입 검사 무력** | Vite의 루트 `tsconfig.json`은 `files: []` + `references` — 훅의 `tsc --noEmit`이 **아무 파일도 검사하지 않아** 타입 오류가 exit 0 | `post-edit-check.mjs`: 참조형이면 `tsc -b --noEmit` — 타입 오류 exit 2, 정상 exit 0(참조형·단일 tsconfig 모두) |
| `baseUrl` 안내 (design.md 8절) | TypeScript 6에서 `error TS5101`로 `tsc -b` 실패 | `paths`만 — 별칭·린트 리졸버 그대로 동작(실측) |
| Vite 템플릿의 oxlint | `"lint": "oxlint"`가 기본 — ESLint 템플릿과 이중 | 스캐폴드가 oxlint 제거 + `lint`를 ESLint로 |
| Stop 훅 Gradle 피드백 | `--quiet`라 실패 테스트 이름 없이 "보고서를 보라"만 | 템플릿 `testLogging`(quiet 수준 포함) — `FailTest > fails() FAILED` + 단언 내용이 피드백에 나온다 |

## 16. 이미지 태그

| 템플릿 | 기존 | 변경 (근거) |
|---|---|---|
| nginx (정적 Dockerfile·프록시) | `nginx-unprivileged:1.27-alpine` | **1.30-alpine** — 1.27 태그는 2025-06-23 이후 갱신 없음(보안 패치 없음). 1.30.6에서 템플릿 2종 재검증: 문법·SPA fallback·gzip(25,892→1,082B)·XFF 덮어쓰기·보안 헤더·앱 정지 503·재기동 후 재해석. 기본값(gzip 꺼짐·UID 101·wget) 동일 |
| Flyway (deploy migrate) | `flyway/flyway:10` | **12** — 10은 MariaDB 11.4를 "지원 검증 안 된 버전(최신 지원 11.2)"으로 경고, 12.11은 경고 없이 적용(실측) |
| 유지 | `node:22-slim`·`mariadb:11.4`·`eclipse-temurin:21`·`caddy:2-alpine` | 모두 이번 주 갱신 중(지원 계열) |

**변경 파일**: `scaffolds/templates/build.gradle`(신규)·`checkstyle.xml`(신규)·`eslint.config.*.mjs` 4종·`docker-compose.deploy.yml`, `hooks/post-edit-check.mjs`, `scaffolds/default.md`, `profiles/project-default.md`, `conventions/spring.md`·`testing.md`·`integration.md`·`express.md`·`design.md`·`docker.md`, `features/error-pages.md`·`error-alert.md`·`domain-event.md`·`graceful-shutdown.md`·`static-assets.md`·`multi-instance.md`·`upload-security.md`·`load-test.md`, `docs/OVERVIEW.md`(1.10), `CLAUDE.md`(검증 규칙 3줄)

## 검증 (3부)

| 항목 | 결과 |
|---|---|
| Spring 템플릿 그대로 새 프로젝트 `./gradlew check` | 정상 코드 통과 / 패키지 순환 추가 → ArchUnit 실패 / Checkstyle 위반 3종 검출 |
| 훅 (실제 프로젝트에 JSON stdin, BOM 없음) | Node 수정: 정상 0·린트 위반 2·타입 오류 2 / Java 수정: 정상 0·포맷 위반 2·컴파일 오류 2 / Stop: 통과 0·실패 2(Vitest·Gradle 모두 실패 테스트 이름 포함)·마커 없음 0 |
| ESLint 템플릿 4종 | 규칙별 위반 검출 + 정상 코드 오탐 없음 (최신 Vite TS·JS 앱, Node TS·JS) |
| 참조 검사 | `check-refs.mjs` 통과(문서 64개/참조 567건), 확장(73개/584건) 통과 |
| compose 템플릿 | `verify-templates.sh` 통과 |
| 스키마 26종 | 새 DB에 전부 — MariaDB 10.11·MySQL 8.0.46 모두 39개 테이블, 오류 0 |
| 인코딩 | `install.ps1` BOM 있음, `verify-templates.ps1` BOM + CRLF, 변경 파일 BOM·CRLF 없음 |
| `install.sh` 임시 HOME | 새 템플릿 2종·고친 훅 설치, 설치본 = 저장소, 훅 등록 |
| **실측 못 한 것** | `shadcn init`(레지스트리 ui.shadcn.com 차단) · start.spring.io 직접 생성(차단 — 템플릿으로 대체 검증) · Spring Docker 이미지 빌드(빌드 컨테이너에 네트워크 없음) · Next.js · `install.ps1`·`verify-templates.ps1` 실행(PowerShell 없음) · 사용자의 해당 세션 기록 |
| 환경 | 이 세션 컨테이너가 중간에 재시작되며 로컬 MariaDB 데이터 파일이 사라져 테스트 DB를 새 데이터 디렉터리로 다시 만들었다(측정 대상과 무관) |

---

## 커밋 코멘트 (3부)

```
@@ 2026-10-19 (3부) @@
전체 검증 — Spring 빌드 템플릿 신설(Boot 3 유입 차단) + 스캐폴드 깨짐 3건 정정 + 낡은 버전 고정값 갱신

■ Spring (Boot 4.1.1 · Gradle 9.8.2 실빌드)
- templates/build.gradle·checkstyle.xml 신설 — Initializr를 못 쓰면 기억(Boot 3.x) 대신 이걸로
- @MockBean → @MockitoBean, JUnit 6, Jackson 3, MyBatis 4.0.x 고정 해제, QueryDSL 포크
- 예외 처리 예시: 검증·본문 오류가 500이던 결함 정정, Checkstyle 순환 검사 오기술 → ArchUnit

■ 스캐폴드 (최신 Vite·npm 그대로 재현)
- TypeScript 7 → ESLint 설치 ERESOLVE: TS 6.0 고정
- import/no-cycle가 TS에서 0건: 파서·리졸버 설정 / 훅 타입 검사 무력: 참조형 tsconfig는 tsc -b
- baseUrl(TS5101) 안내 제거, Vite oxlint 제거 안내, Gradle 실패 테스트 로그

■ 이미지: nginx 1.27 → 1.30, Flyway 10 → 12 (실기동 재검증)
■ Node 최신 메이저(Express 5·zod 4·nodemailer 10 등)에서 레시피 코드 재검증 — 전부 문서대로
```

