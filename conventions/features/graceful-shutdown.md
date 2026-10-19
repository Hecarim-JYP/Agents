# 레시피: 안전 종료 (graceful shutdown) `[공통]`

> 확정: 2026-10-14 | 관련: docker.md 2절(Dockerfile CMD), ops.md 2절(배포 원칙), outbox.md(relay 종료)
> 배포·재시작은 매번 "종료"다. 종료 신호(SIGTERM)를 받으면 **새 연결을 막고 → 처리 중 요청을 끝내고 → 자원을 닫고 → 종료**한다. 없으면 배포할 때마다 저장 요청 일부가 중간에 끊긴다.

## 1. 언제 쓰나

모든 서버·워커 컨테이너(server, outbox relay). `docker compose run --rm`으로 도는 배치는 배포로 중단되지 않으므로 대상이 아니다 (batch.md 4절).

- ⚠ **단일 인스턴스에서 안전 종료는 "처리 중 요청 보호"까지다** — 재기동하는 몇 초 동안의 새 요청은 받을 곳이 없다. 무중단 배포는 인스턴스 2개 이상 + 순차 교체가 필요하다 (대외 카탈로그 항목).

## 2. 결정 항목 (기본값)

종료 대기 시간은 **안쪽이 바깥보다 짧아야** 한다 — 바깥(Docker)이 먼저 끝나면 앱이 정리하는 도중에 SIGKILL을 맞는다:

| 층 | 값 | 설정 위치 |
|---|---|---|
| 앱 종료 대기 상한 | **20초** | Node: 5절 `DRAIN_TIMEOUT_MS` / Spring: `spring.lifecycle.timeout-per-shutdown-phase` |
| 컨테이너 종료 유예 | **30초** | compose `stop_grace_period` — 스캐폴드 base 템플릿의 server에 기본 포함 |

- Docker의 기본 유예는 10초다. 장시간 요청(대용량 엑셀 생성 등)이 있으면 두 값을 함께 늘린다 — 순서(앱 < 컨테이너)를 유지한다.

## 3. 표준 설계 — 종료 순서

```
SIGTERM 수신
 ① 종료 플래그 ON (중복 신호 무시)
 ② 새 연결 거부 (server.close) + 지금 유휴인 keep-alive 연결 즉시 닫기
 ③ 처리 중 요청 완료 대기 — 끝난 응답의 연결은 응답 직후 닫는다
 ④ 백그라운드 작업 정리 — relay는 현재 묶음까지만 (outbox.md 5절)
 ⑤ 자원 정리 — DB 풀 종료
 ⑥ exit 0 / 상한(20초) 초과 시 error 로그 + exit 1
```

## 4. 함정 (STRICT)

| 함정 | 증상 | 처방 |
|---|---|---|
| **Node: SIGTERM 핸들러 없음** | 컨테이너의 PID 1은 핸들러가 없는 신호를 **무시한다** → `docker stop`이 10초 기다렸다 SIGKILL → 처리 중 요청이 끊기고 DB 연결이 정리되지 않는다 (실측: PID 1 node, 핸들러 없음 → SIGTERM 후에도 생존) | 5절 `registerShutdown` |
| **셸 형식 CMD** (`CMD node dist/index.js`) | `/bin/sh`가 PID 1이 되어 **앱에 신호를 전달하지 않는다** (실측) | exec 형식 `CMD ["node", "dist/index.js"]` — docker.md 2-1절 템플릿 유지 |
| **`npm start`를 CMD로** | npm이 SIGTERM에 먼저 종료되고, 앱은 **핸들러가 돌기 전에** 함께 강제 종료된다 (실측: 앱 핸들러 로그 없음) | 운영 CMD는 `node`를 직접 실행 |
| keep-alive 연결 | `server.close()`는 새 연결만 막는다 — 처리 중이던 연결이 응답 후 유휴 상태로 남아 종료가 수 초 늘어진다 (실측: 3초 지연) | 5절 `closeConnectionOnShutdown` — 응답 직후 유휴 연결 닫기 (실측: 응답과 동시에 종료) |
| **Spring Boot 3.3 이하 기본값** | `server.shutdown` 기본이 `IMMEDIATE` — 처리 중 요청을 기다리지 않는다 (3.4부터 `GRACEFUL`) | 버전과 무관하게 `server.shutdown: graceful` 명시 (근거: spring-boot-autoconfigure 3.3.13·3.5.6 `ServerProperties` 소스 확인. Boot 4.1.1 실측 2026-10-19: 미지정이면 graceful, `immediate` 지정 시 대기 없음 — 명시하면 버전·설정 실수와 무관해진다) |
| **Spring 대기 상한 30초 > Docker 유예 10초** | `timeout-per-shutdown-phase` 기본 30초 — 기다리는 도중 Docker가 SIGKILL | 2절 값 체인 (앱 20초 < 컨테이너 30초) |
| 강제 종료 타이머가 프로세스를 붙잡음 | 정리가 끝났는데도 타이머 때문에 즉시 안 끝난다 | 타이머에 `.unref()` |

## 5. 스택별 구현

**Express** (실측 2026-10-14: Express 4.22 + Node 22, PID 1로 기동 → SIGTERM → 처리 중 요청 200 완료 · 새 요청 거부 · 자원 정리 · exit 0):

```js
/*
 * 파일명 : shutdown.js
 * 용도 : 안전 종료 — SIGTERM을 받으면 새 연결을 막고, 처리 중 요청을 끝낸 뒤 자원을 닫고 종료한다
 * 최초등록 : YYYY-MM-DD [박진영]
 */
const DRAIN_TIMEOUT_MS = 20_000;   // compose stop_grace_period(30s)보다 짧게 — 넘기면 Docker가 SIGKILL
let shuttingDown = false;
let httpServer = null;

/**
 * 종료 중에 끝난 응답의 연결은 응답 직후 닫는다 — keep-alive 연결 때문에 종료가 늘어지는 것 방지
 * @param {import('express').Request} req 요청
 * @param {import('express').Response} res 응답
 * @param {import('express').NextFunction} next 다음 미들웨어
 */
export function closeConnectionOnShutdown(req, res, next) {
  res.once('finish', () => {
    if (shuttingDown && httpServer) setImmediate(() => httpServer.closeIdleConnections());
  });
  next();
}

/**
 * 종료 핸들러 등록 — app.listen 직후 호출한다
 * @param {import('node:http').Server} server HTTP 서버
 * @param {() => Promise<void>} closeResources DB 풀 등 자원 정리
 * @param {{ info: Function, error: Function }} logger 로거
 */
export function registerShutdown(server, closeResources, logger) {
  httpServer = server;
  const shutdown = (signal) => {
    if (shuttingDown) return;                       // SIGTERM·SIGINT 중복 호출 가드
    shuttingDown = true;
    logger.info({ signal }, '종료 시작 — 새 연결 거부, 처리 중 요청 대기');
    setTimeout(() => { logger.error('종료 대기 초과 — 강제 종료'); process.exit(1); }, DRAIN_TIMEOUT_MS).unref();
    server.close(async () => {                      // 처리 중 요청이 모두 끝나면 호출된다
      await closeResources();
      logger.info('종료 완료');
      process.exit(0);
    });
    server.closeIdleConnections();                  // 지금 유휴인 keep-alive 연결은 즉시 닫는다
  };
  process.on('SIGTERM', shutdown);                  // docker stop — PID 1은 핸들러가 없으면 무시한다
  process.on('SIGINT', shutdown);                   // 로컬 Ctrl+C
}
```

```js
// index.js — 등록 순서: 요청 ID(request-id.md) → 종료 연결 처리 → 라우터
app.use(requestId);
app.use(closeConnectionOnShutdown);
// ... 라우터
const server = app.listen(PORT);
registerShutdown(server, () => getPool().end(), logger);
```

**Spring** (`application.yml`):

```yaml
server:
  shutdown: graceful                    # 3.3 이하 기본 immediate — 버전과 무관하게 명시
spring:
  lifecycle:
    timeout-per-shutdown-phase: 20s     # 기본 30s — compose stop_grace_period(30s)보다 짧게
```

- JVM은 PID 1이어도 SIGTERM을 받아 종료 훅을 실행한다(실측: PID 1 java → 종료 훅 실행, exit 143) — exec 형식 `CMD ["java", "-jar", "app.jar"]`(docker.md 2-2절)를 유지하면 된다.

**compose**: 스캐폴드 base 템플릿의 `server`에 `stop_grace_period: 30s`가 들어 있다. outbox relay 등 다른 상주 서비스를 추가할 때도 같은 값을 둔다.

## 6. 검증 포인트

- 실동작 검증(/live-test 런타임 축): 느린 요청(저장 등)을 보내는 도중 `docker compose restart server` → 그 요청이 정상 응답으로 끝나고, 서버 로그에 "종료 시작 → 종료 완료"가 찍히고, 재시작까지 걸린 시간이 30초보다 짧은지 확인한다. 로그에 "강제 종료"가 보이면 대기 상한을 넘긴 요청이 있다는 뜻이다.
