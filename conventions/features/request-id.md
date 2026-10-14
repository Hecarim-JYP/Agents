# 레시피: 요청 추적 ID `[공통]`

> 확정: 2026-10-14 | 원칙: ops.md 3절("요청마다 식별자를 부여해 한 요청의 로그를 이어 본다")의 구현
> 요청마다 ID를 하나 정해 **모든 로그 줄·응답 헤더·외부 호출**에 싣는다. 사용자가 "에러났어요"라고 할 때 화면의 코드 하나로 그 요청의 로그 전체를 찾는다.

## 1. 언제 쓰나

모든 서버. 비 HTTP 실행 단위(outbox relay, 배치)도 같은 구조로 실행 단위 ID를 쓴다(3-3절).

## 2. 결정 항목 (기본값)

| 결정 | 기본값 | 근거 |
|---|---|---|
| 헤더 이름 | `X-Request-Id` | 프록시·사내 시스템이 널리 쓰는 이름 |
| 생성 주체 | **앱 미들웨어**. 들어온 헤더가 형식에 맞으면 이어받는다 | 프록시가 생성해 넘기는 구성에서도 같은 ID로 이어진다 |
| 클라이언트 전달 | **응답 헤더로만** — 에러 봉투에 키를 추가하지 않는다 | api.md 5절 봉투 계약을 바꾸지 않는다. 화면은 헤더를 읽어 표시 |
| 로그 형식 | 모든 로그 줄에 `request_id` 필드 | 이 필드 하나로 검색한다 |

## 3. 표준 설계

### 3-1. 서버 — 맨 앞 미들웨어 + 컨텍스트 저장 + 로거 자동 첨부

- 요청 ID 미들웨어는 **로깅·인증보다 먼저** 등록한다 — 인증 실패 로그에도 ID가 있어야 한다.
- ID는 **요청 컨텍스트**(Node `AsyncLocalStorage` / Spring MDC)에 넣고, **로거가 컨텍스트에서 자동으로 읽는다**. 서비스·쿼리 함수에 ID를 인자로 넘기지 않는다.
- 들어온 값은 `^[A-Za-z0-9-]{1,64}$`일 때만 이어받고, 아니면 새로 만든다.

### 3-2. 화면 — 문의 코드 표시

- 공용 에러 메시지 유틸(react.md 7절 — 에러 메시지 추출 단일 유틸)이 5xx 응답이면 `x-request-id` 헤더 앞 8자를 "문의 코드"로 덧붙인다: `"저장에 실패했습니다 (문의 코드: 1cc39ac2)"`. 로그 검색은 앞부분 일치로 충분하다.
- 같은 출처(`baseURL='/api'` — react.md 7절)라 헤더를 그냥 읽을 수 있다. 다른 출처 호출이면 서버가 `Access-Control-Expose-Headers: X-Request-Id`를 줘야 보인다.

### 3-3. 전파

| 경로 | 처리 |
|---|---|
| 우리 → 사내 API (`external/`) | 나가는 요청에 `X-Request-Id`를 붙인다 — 상대 로그와 연결된다 (integration.md 7절 로깅과 짝) |
| outbox 적재 | 적재 로그에 `outbox_message_id`를 남긴다 — 요청 ID → 메시지 → relay 로그로 이어진다 |
| relay·배치 | HTTP 요청이 없으므로 실행 단위 ID를 같은 컨텍스트에 넣는다: relay는 선점 묶음 `run_id`(outbox.md 3-3절), 배치는 `batch:{배치명}:{UUID}` |
| 비동기 리스너 | Node는 AsyncLocalStorage가 이어진다. Spring `@Async`는 5절의 TaskDecorator로 복사 |

### 3-4. 프록시 연동 (선택)

프록시 접근 로그까지 같은 ID로 묶고 싶으면 프록시가 ID를 만들어 넘긴다 — nginx는 `proxy_set_header X-Request-Id $request_id;` + `log_format`에 `$request_id`. 앱은 3-1절 규칙대로 형식 검증 후 이어받는다.

## 4. 함정 (STRICT)

| 함정 | 증상 | 처방 |
|---|---|---|
| 요청 ID를 모듈 변수·전역에 저장 | 동시 요청끼리 ID가 섞여 **엉뚱한 요청의 로그**를 보게 된다 | 요청 컨텍스트에 저장 (실측: 동시 3요청이 각자 ID 유지) |
| `next()`를 컨텍스트 `run` 밖에서 호출 | 이후 핸들러에서 ID가 `undefined` | `requestContext.run(store, () => next())` |
| 콜백 기반 라이브러리 | 콜백이 다른 요청의 실행 흐름에서 불려 컨텍스트가 바뀔 수 있다 | promise API 사용 — `mysql2/promise`는 풀 대기 후에도 ID 유지(실측, connectionLimit 1에서 동시 3요청) |
| 들어온 헤더를 그대로 신뢰 | 개행을 넣은 값으로 로그 위조, 초장문으로 로그 오염 | 형식 검증 후 이어받기 (실측: 100자 값 → 새 UUID로 대체) |
| **Spring: MDC 정리 누락** | 스레드 풀 재사용으로 **다음 요청 로그에 이전 요청의 ID**가 찍힌다 | 필터의 `finally`에서 `MDC.remove` |
| **Spring: `@Async`·전용 스레드 풀** | 새 스레드에는 MDC가 없다 — 비동기 로그에서 ID 유실 | `TaskDecorator`로 MDC 복사 |
| 에러 봉투에 `request_id` 키 추가 | 응답 계약 변경 — 클라이언트 전체 영향 (api.md 5절) | 응답 헤더로만 |

## 5. 스택별 구현

**Express** (실측 2026-10-14: Express 4.22 + pino 9 + Node 22):

```js
/*
 * 파일명 : requestContext.js
 * 용도 : 요청 ID를 AsyncLocalStorage에 담아 await·타이머를 건너 유지한다
 * 최초등록 : YYYY-MM-DD [박진영]
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export const requestContext = new AsyncLocalStorage();
const VALID_ID = /^[A-Za-z0-9-]{1,64}$/;   // 들어온 값은 형식이 맞을 때만 이어받는다 (로그 위조 방지)

/**
 * 요청 ID 미들웨어 — 앱의 맨 앞(로깅·인증보다 먼저)에 등록한다
 * @param {import('express').Request} req 요청
 * @param {import('express').Response} res 응답
 * @param {import('express').NextFunction} next 다음 미들웨어
 */
export function requestId(req, res, next) {
  const incoming = req.get('X-Request-Id');
  const id = incoming && VALID_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', id);                    // 화면·프록시가 같은 ID를 볼 수 있게 응답에 싣는다
  requestContext.run({ requestId: id }, () => next());  // run 안에서 next — 이후 체인 전체가 컨텍스트를 갖는다
}
```

```js
// logger.js — 모든 로그 줄에 컨텍스트의 요청 ID를 자동으로 붙인다 (pino 예 — 로거 선택은 새 의존성이므로 사전 보고)
import pino from 'pino';
import { requestContext } from './requestContext.js';

export const logger = pino({
  mixin: () => ({ request_id: requestContext.getStore()?.requestId }),   // 로그를 쓸 때마다 호출된다
});
```

**Spring**:

```java
// 요청 ID 필터 — 가장 먼저 실행되게 순서를 지정하고, finally에서 반드시 MDC를 비운다
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class RequestIdFilter extends OncePerRequestFilter {
  private static final Pattern VALID_ID = Pattern.compile("^[A-Za-z0-9-]{1,64}$");

  @Override
  protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
      throws ServletException, IOException {
    String incoming = req.getHeader("X-Request-Id");
    String id = (incoming != null && VALID_ID.matcher(incoming).matches()) ? incoming : UUID.randomUUID().toString();
    MDC.put("request_id", id);
    res.setHeader("X-Request-Id", id);
    try {
      chain.doFilter(req, res);
    } finally {
      MDC.remove("request_id");   // 스레드 풀 재사용 시 다음 요청으로 새지 않게
    }
  }
}
```

- 로그 패턴(logback)에 `%X{request_id}`를 넣는다.
- `@Async` executor에 MDC 복사 `TaskDecorator`를 등록한다: 제출 시점의 `MDC.getCopyOfContextMap()`을 실행 스레드에서 `MDC.setContextMap()`으로 설정하고 끝나면 `MDC.clear()`.

## 6. 검증 포인트

- 자동화 테스트: 응답에 `X-Request-Id`가 있다 / 형식 맞는 값은 이어받고 틀린 값은 새로 만든다.
- 실동작 검증(/live-test): 일부러 에러를 내고 → 화면의 문의 코드로 서버 로그를 검색 → 그 요청의 로그 줄이 전부, 그리고 그것만 나오는지 확인. 동시 요청 중에도 섞이지 않는지.
