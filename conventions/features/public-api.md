# 레시피: 공개 API 제공 — API 키·버전·사용량 제한 `[대외]` ⚑

> 확정: 2026-10-19 | 테이블: `schemas/23_api_client.sql` | 원칙: api.md(URL·봉투·에러 계약), rate-limit.md 3-2절(한도 미들웨어), auth.md(화면 인증과 분리) | 짝: public-id.md(외부 노출 ID), cache.md(인증 결과 캐시), webhook-receive.md(서명 방식 — 우리가 웹훅을 보낼 때도 같은 방식), request-id.md
> 외부 연동사에게 여는 API는 **화면용 API와 인증·한도·호환성 약속이 다르다**. 연동사마다 **API 키**(원문은 발급 때 한 번만 보여주고 해시만 저장)로 인증하고, **연동사별 한도**를 걸고, URL에 **메이저 버전**을 박아 깨지는 변경은 새 버전으로만 낸다.

## 1. 언제 쓰나

파트너사·고객사 시스템이 우리 데이터를 서버 간(server-to-server)으로 조회·등록하는 API. 우리 화면이 쓰는 API(쿠키 세션·JWT)와 같은 라우트를 공유하지 않는다. 사용자를 대신해 위임 권한을 주는 구조(제3자 앱이 이용자 동의로 접근)는 OAuth 인가 서버가 필요하다 — 이 레시피 범위 밖.

⚑ 되돌리기 어려운 이유: 한 번 공개한 URL·필드·에러 코드는 연동사 코드에 박혀 우리가 혼자 바꿀 수 없다. 키 형식·인증 헤더도 마찬가지 — 처음 정한 것이 계약이 된다.

## 2. 결정 항목 (기본값)

| 결정 | 기본값 | 대안 / 비고 |
|---|---|---|
| 경로 | `/api/public/v1/...` — 화면 API와 분리, 메이저 버전만 URL에 | 헤더 버전 — 로그·프록시 설정에서 보이지 않는다 |
| 인증 | `X-API-Key` 헤더 — **쿼리 문자열 금지**(접근 로그·프록시 로그·브라우저 기록에 남는다) | `Authorization: Bearer` — 같은 값을 그 헤더로 받아도 된다(하나로 정한다) |
| 키 형식 | **접두어 16자 고정** `{서비스 약어 3자}_{live\|test}_{랜덤 7자}` + `_` + 32바이트 base64url = 60자 | 접두어는 공개 식별자(로그·화면), 뒤는 비밀 |
| 저장 | `key_prefix` + **sha256(키 전체)**만 — 원문 저장 금지 | 32바이트 랜덤이라 느린 해시(bcrypt)가 필요 없다 — 사람이 정한 비밀번호와 다르다 |
| 키 수 | 연동사당 여러 개 — 새 키 발급 → 연동사 전환 → 옛 키 폐기(무중단 교체) | |
| 권한 | 키마다 `scopes`(예: `orders:read`) — 라우트가 필요한 scope를 선언 | 연동사 전체 권한 — 키 하나 유출 = 전부 |
| 한도 | **연동사별** `rate_limit_per_min`(기본 60) — 전역 IP 한도에서 공개 API는 제외 | IP 기준 — 4절 실측 |
| 인증 결과 캐시 | 30초 + **폐기 시 즉시 삭제** | 다중 인스턴스면 폐기가 다른 인스턴스 캐시에 닿지 않는다 — 30초 지연을 운영 화면에 안내하거나 공유 캐시(cache.md 2절) |
| 사용 기록 | `last_used_at`은 1분 단위로 묶어 갱신, 요청 로그에 `key_prefix`·연동사 ID | 매 요청 UPDATE — 쓰기 폭주 |
| 폐기·변경 공지 | `contact_email`로, 버전 폐기는 최소 6개월 전 + 응답에 `Sunset` 헤더(RFC 8594) | 기간은 계약서에 맞춘다 |
| CORS | **열지 않는다** — 서버 간 호출 전용 | 브라우저에서 부르면 키가 노출된다 |

## 3. 표준 설계

### 3-1. 발급

```js
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const KEY_PREFIX_LEN = 16;
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/**
 * API 키 발급 — 원문은 이 반환값으로 한 번만 보여준다(다시 볼 수 없다 — 잃어버리면 재발급)
 * @param {'live'|'test'} env 운영·테스트 키 구분 — 접두어에 드러나 잘못 쓴 키를 바로 알아본다
 */
export async function issueApiKey(apiClientId, scopes, env = 'live') {
  const prefix = `${SERVICE_CODE}_${env}_${randomBytes(4).toString('hex').slice(0, 7)}`;   // SERVICE_CODE = 3자 상수 → 3+1+4+1+7 = 16자
  const key = `${prefix}_${randomBytes(32).toString('base64url')}`;
  await apiKeyRepo.insert({ apiClientId, keyPrefix: prefix, keyHash: sha256(key), scopes: scopes.join(',') });
  return key;
}
```

### 3-2. 인증·권한·한도

```js
/** API 키 인증 — 접두어(앞 16자)로 한 행을 찾고 해시를 상수 시간으로 비교 */
export async function apiKeyAuth(req, res, next) {
  const key = req.get('x-api-key') ?? '';
  if (key.length !== 60) return res.status(401).json({ message: 'API 키가 올바르지 않습니다.', error: 'INVALID_API_KEY' });
  const prefix = key.slice(0, KEY_PREFIX_LEN);                       // 고정 길이로 자른다 — split('_')는 비밀 부분의 '_'에 깨진다(4절)
  const row = await cachedKeyLookup(prefix);                           // 30초 캐시, 폐기 시 삭제 (3-3절)
  if (!row || !timingSafeEqual(Buffer.from(row.keyHash), Buffer.from(sha256(key)))) {
    return res.status(401).json({ message: 'API 키가 올바르지 않습니다.', error: 'INVALID_API_KEY' });
  }
  req.apiClient = { id: row.apiClientId, scopes: new Set(row.scopes.split(',')), limitPerMin: row.rateLimitPerMin, keyPrefix: prefix };
  touchLastUsed(row.apiKeyId);                                         // 메모리에 모아 1분마다 한 번 UPDATE
  next();
}

/** 라우트별 필요 권한 — 없으면 403 (401과 구분: 키는 맞는데 권한이 없다) */
export const requireScope = (scope) => (req, res, next) =>
  req.apiClient.scopes.has(scope) ? next() : res.status(403).json({ message: '이 API를 호출할 권한이 없습니다.', error: 'INSUFFICIENT_SCOPE' });

// app.js — 전역 IP 한도(rate-limit.md 3-2절)에서 공개 API를 빼고, 공개 API는 연동사별 한도
app.use('/api', limiter(60_000, 300, { skip: (req) => req.path.startsWith('/public/') }));   // rate-limit.md 3-2절 limiter — '/api' 마운트라 req.path는 '/public/…'
app.use('/api/public/v1', apiKeyAuth, rateLimit({
  windowMs: 60_000, limit: (req) => req.apiClient.limitPerMin, keyGenerator: (req) => `client:${req.apiClient.id}`,
  standardHeaders: 'draft-7', legacyHeaders: false,
}));
app.get('/api/public/v1/orders', requireScope('orders:read'), listOrdersForClient);
```

- 응답 봉투·에러 코드는 api.md 5절 그대로 — 공개 API 문서에 **에러 코드 목록**을 싣는다(연동사가 분기하는 기준).
- 데이터 범위: 연동사는 **자기 데이터만** — 모든 쿼리에 `api_client_id` 조건(auth.md 4-2절 데이터 스코프와 같은 원리), 응답 ID는 공개 ID(public-id.md).

### 3-3. 폐기와 캐시

- 폐기 = `UPDATE api_key SET revoked_at = NOW() WHERE key_prefix = :p` **+ 같은 처리에서 인증 캐시 삭제** — 캐시만 믿으면 폐기한 키가 TTL 동안 계속 통과한다.
- 다중 인스턴스: 폐기한 인스턴스의 캐시만 지워진다 — TTL을 짧게(30초) 두고 운영 화면에 "최대 30초 후 차단"을 표시하거나, 공유 캐시 + 무효화 전파(multi-instance.md 3-3절).

### 3-4. 버전

- **깨지지 않는 변경**(필드 추가, 선택 파라미터 추가, 새 엔드포인트)은 같은 버전에서 — 연동사는 모르는 필드를 무시해야 한다고 문서에 명시.
- **깨지는 변경**(필드 삭제·이름·타입 변경, 필수 파라미터 추가, 에러 코드 의미 변경)은 `/v2` — v1은 공지한 폐기일까지 유지, 응답에 `Sunset: <날짜>` 헤더.
- 버전별 라우터를 디렉터리로 나눈다(`routes/public/v1/`, `v2/`) — 서비스 계층은 공유하고 응답 변환만 버전별.

- 실측 2026-10-19 (Node 22 · Express 4.22 · express-rate-limit 7.5 + MariaDB 10.11):

| 상황 | 결과 |
|---|---|
| 발급 | 60자 키, DB에는 접두어 + sha256만 |
| 같은 IP의 연동사 A·B, 연동사별 한도 3회 | A 4번째 429 / 이어서 B 200 — 서로 영향 없음 |
| `limit`을 함수로(연동사 A 2회·B 4회) | A 3번째·B 5번째 429, `RateLimit-Policy`도 연동사별 값 |
| 전역 IP 한도(`/api`)에 공개 API 포함 | **3회 뒤 공개 API 429 + 같은 IP의 화면 API도 전부 429** |
| 전역 한도에서 `skip`으로 공개 API 제외 | 공개 API는 연동사 한도(5회)까지 200, 화면 API는 자기 한도대로 |
| 키 끝 한 글자 변조 | 401 |
| 폐기 직후, 캐시 그대로 | **200 — 캐시 30초 동안 계속 통과** |
| 폐기 처리에서 캐시도 삭제 | 401 |
| 32바이트 base64url 비밀 1000개 | **491개에 `_` 포함** — `split('_')`로 비밀을 꺼내면 절반이 잘린다 |

## 4. 함정 (STRICT)

| 함정 | 증상 | 처방 |
|---|---|---|
| 키 원문 저장 | DB 유출 = 모든 연동사 키 유출 | sha256만, 원문은 발급 응답 1회 |
| `split('_')`로 접두어·비밀 분리 | 비밀의 절반가량이 `_`를 포함 (실측) — 꺼낸 값이 잘린다 | 고정 길이 `slice(0, 16)` |
| 전역 IP 한도 아래에 공개 API | **연동사 호출이 IP 한도에 막히고 같은 IP의 화면까지 429** (실측) | 전역 한도 `skip` + 연동사별 한도 |
| IP 기준 한도 | 서버가 여러 대인 연동사는 한도 × 대수, NAT 뒤 여러 연동사는 한도 공유 | `keyGenerator` = 연동사 ID |
| 폐기 시 캐시 미삭제 | **폐기한 키가 TTL 동안 통과** (실측) | 폐기 처리에서 삭제 + 짧은 TTL |
| 쿼리 문자열로 키 전달 | 접근 로그·프록시 로그에 키가 남는다 | 헤더만 받는다(쿼리에 키가 오면 400) |
| 화면 API를 그대로 공개 | 화면 개편이 연동사를 깨뜨린다, 화면 전용 필드 노출 | 공개 API 라우터·응답 변환 분리 |
| 필드 삭제·이름 변경을 같은 버전에서 | 연동사 장애 | 새 메이저 버전 |
| 401과 403 혼용 | 연동사가 "키 재발급"과 "권한 요청"을 구분하지 못한다 | 키 문제 401, 권한 문제 403 |
| `last_used_at` 매 요청 UPDATE | 호출량만큼 쓰기 — 행 잠금 경합 | 1분 묶음 갱신 |
| 브라우저에서 공개 API 호출 허용(CORS) | 키가 프론트 코드·네트워크 탭에 노출 | CORS 미허용, 서버 간 전용 |

## 5. 스택별 구현

| 구성 | Express | Spring |
|---|---|---|
| 키 인증 | `apiKeyAuth` 미들웨어 (3-2절, 실측) | `OncePerRequestFilter`를 `securityMatcher("/api/public/**")` 체인에 `addFilterBefore(new ApiKeyFilter(), AuthorizationFilter.class)`, 세션 `STATELESS`, 화면용 `SecurityFilterChain`과 분리 — **필터를 `@Component`·`@Bean`으로 만들지 않는다**: Boot가 서블릿 필터로 자동 등록해 **모든 경로에 걸리고**, 화면 API까지 키를 요구해 401이 난다. 빈이어야 하면 `FilterRegistrationBean.setEnabled(false)` (실측 2026-10-20, Boot 4.1.1 · Security 7: 분리 체인은 키 없음 401·있음 200·화면 요청에 필터 0회·Set-Cookie 없음 / 빈 등록 시 화면 `/api/app/me` 401 / `setEnabled(false)` 후 200) |
| 해시 비교 | `timingSafeEqual` | `MessageDigest.isEqual` |
| 연동사별 한도 | express-rate-limit `keyGenerator` + `limit` 함수 | Bucket4j 등 — 키 = 연동사 ID |
| 버전 라우터 | `routes/public/v1/` | `@RequestMapping("/api/public/v1")` 컨트롤러 패키지 분리 |
| 문서 | OpenAPI 명세 파일을 저장소에 두고 버전별 공개 | springdoc — 공개 API 그룹만 공개 |

## 6. 검증 포인트

- 자동화 테스트: 3-4절 표의 상황 + 다른 연동사의 데이터 ID로 조회 → 404(존재 여부를 드러내지 않는다) / scope 없는 키 → 403 / 쿼리 문자열 키 → 400.
- 계약 테스트: v1 응답 스냅샷(필드 목록·타입)을 테스트로 고정 — 깨지는 변경이 같은 버전에 들어오면 실패.
- 운영 전: 테스트 키(`_test_`)가 운영 DB에 없는지, 접근 로그에 키 원문이 없는지(grep `_live_` 뒤 43자).
