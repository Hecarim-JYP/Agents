# 레시피: 도메인 이벤트(옵저버) — 놓쳐도 되는 후속 처리 `[공통]`

> 확정: 2026-10-14 | 짝: outbox.md(반드시 실행돼야 하는 후속 처리)
> "어떤 상태가 바뀌면, 관심 있는 다른 기능들에 알린다." 발행하는 서비스는 누가 듣는지 모른다 — 결합도가 낮아진다. 판단 규칙은 하나: **놓쳐도 되면 이벤트, 놓치면 안 되면 outbox.**

## 1. 언제 쓰나

한 업무 변경에 후속 처리가 여러 개 붙을 때, 후속 처리의 성격으로 수단을 고른다:

| 후속 처리의 성격 | 예 | 수단 |
|---|---|---|
| **본처리와 함께 성공·실패해야 한다** | 감사 로그(auth.md 5절), 재고 차감, 이력 기록 | 이벤트 쓰지 않는다 — 서비스가 같은 트랜잭션에서 직접 호출 |
| **반드시 실행돼야 하지만 나중이어도 된다** | 외부 시스템 연동, 필수 통지 메일 | outbox.md |
| **놓쳐도 업무가 깨지지 않는다** | 화면 알림 뱃지, 캐시 무효화, 통계 카운터, 비필수 안내 | **도메인 이벤트 (이 레시피)** |

- 후속 처리가 하나뿐이고 앞으로도 늘 일이 없으면 이벤트를 만들지 않는다 — 직접 호출이 더 단순하다 (patterns.md 6절 성급한 추상화 방지).

## 2. 결정 항목

| 결정 | 기본값 | 비고 |
|---|---|---|
| 리스너 실행 | **커밋 후 + 비동기** | 응답 시간에 리스너 시간이 더해지지 않는다. 가볍고 순서가 중요한 리스너만 동기 |
| 전달 범위 | **프로세스 안(인메모리)** | 단일 인스턴스 전제 — CLAUDE.md "다중화 전환 목록"에 기록한다 (patterns.md 0-3절). 인스턴스 간 전달이 필요해지면 outbox로 |

## 3. 표준 설계

- **발행 지점 = 서비스 계층**, 트랜잭션 안에서 "발행 예약"하고 **커밋이 성공한 뒤에만 실제 전달**한다.
- 이벤트 이름은 **과거형**(`OrderConfirmed`, `ApprovalRejected`) — "이미 일어난 사실"이다. 명령형(`SendMail`)이면 이벤트가 아니라 직접 호출을 감춘 것이다.
- 이벤트 객체는 **불변**이고, 업무 PK + 리스너 판단에 필요한 최소 값(행위자·시각)을 담는다. 개인정보·비밀은 담지 않는다.
- 리스너는 그 관심사를 가진 모듈에 둔다(알림 모듈, 캐시 모듈). 발행 모듈이 리스너를 import하지 않는다.
- **리스너가 또 다른 이벤트를 연쇄 발행하지 않는다** (깊이 1) — 연쇄가 생기면 흐름 추적이 불가능해진다. 연쇄가 필요하면 그 흐름은 서비스에서 명시적으로 호출한다.

## 4. 함정 (STRICT)

| 함정 | 증상 | 처방 |
|---|---|---|
| 커밋 **전에** 전달 | 저장은 롤백됐는데 알림은 나간다 | 커밋 후 전달 (5절) |
| 커밋 후 리스너의 실패를 "누군가 알겠지" | 본처리는 성공, 후속 처리만 **조용히 누락** | 놓치면 안 되는 일이면 처음부터 outbox. 리스너 실패는 반드시 error 로그 |
| **Node: async 리스너의 예외를 잡지 않음** | `EventEmitter`는 async 리스너의 reject를 처리하지 않아 unhandledRejection → **서버 프로세스 전체가 종료된다** (실측 2026-10-14: Node 22, exit 1). 알림 하나 실패로 모든 사용자의 요청이 끊긴다 | 5절 `onEvent` 래퍼로 리스너마다 격리 |
| **Spring: 커밋 후 리스너에서 기본 전파로 DB 쓰기** | 이미 커밋된 트랜잭션에 "참여"만 하고 **쓰기가 커밋되지 않는다** — 에러도 없다 | `@Transactional(propagation = REQUIRES_NEW)` (근거: spring-tx `TransactionSynchronization#afterCommit` javadoc — "Use PROPAGATION_REQUIRES_NEW for any transactional operation that is called from here", 6.2.11 소스 확인). Spring 6.1+는 이 리스너에 `REQUIRES_NEW`·`NOT_SUPPORTED` 외의 `@Transactional`을 붙이면 기동 시 `IllegalStateException`으로 막는다(`RestrictedTransactionalEventListenerFactory` — Framework 7.0.9·Boot 4.1.1에서 기동 실패 실측 2026-10-19, `REQUIRES_NEW`면 정상 기동) — 6.0 이하는 조용히 통과하므로 더 위험하다 |
| **Spring: 트랜잭션 밖에서 발행** | `@TransactionalEventListener`는 트랜잭션이 없으면 **아예 호출되지 않는다**(`fallbackExecution` 기본 false) | 발행은 `@Transactional` 서비스 안에서. 트랜잭션 없는 발행이 정상인 경우만 `fallbackExecution = true` |
| 인메모리 이벤트를 영속 수단으로 착각 | 프로세스 재시작 시 유실, 인스턴스 2개면 다른 인스턴스에 전달 안 됨 | 2절 — 다중화 전환 목록 기록, 필요하면 outbox |
| 동기 리스너에 무거운 처리 | 응답이 리스너 처리 시간만큼 늦어진다 | 비동기 기본. 동기 리스너는 가벼운 메모리 작업만 |
| 비동기 리스너에서 요청 ID 유실 | 리스너 로그가 어느 요청에서 왔는지 모른다 | Node는 AsyncLocalStorage가 이어진다, Spring `@Async`는 MDC 복사 필요 (request-id.md 5절) |

## 5. 스택별 구현

**Express** — 커밋 후 발행과 리스너 격리를 공용 모듈 하나로 (`shared/events/domainEvents.js`):

```js
/*
 * 파일명 : domainEvents.js
 * 용도 : 도메인 이벤트 — 트랜잭션 동안 모았다가 커밋 후에만 발행, 리스너 예외는 격리
 * 최초등록 : YYYY-MM-DD [박진영]
 */
import { EventEmitter } from 'node:events';
import { logger } from '../logger.js';

const bus = new EventEmitter();

/**
 * 리스너 등록 — 리스너의 동기 예외·async reject가 요청이나 프로세스로 번지지 않게 감싼다
 * @param {string} type 이벤트 이름 (과거형, 예: 'OrderConfirmed')
 * @param {(event: object) => (void|Promise<void>)} handler 후속 처리
 */
export function onEvent(type, handler) {
  bus.on(type, (event) => {
    // Promise로 감싸면 다음 마이크로태스크에서 실행되고, 동기 throw와 async reject를 모두 catch로 받는다
    Promise.resolve()
      .then(() => handler(event))
      .catch((err) => logger.error({ err, type }, '도메인 이벤트 리스너 실패'));
  });
}

/**
 * 서비스 트랜잭션 하나에 쓰는 이벤트 수집기 — 커밋 성공 후 flush, 롤백 시 clear
 * @returns {{ add: (type: string, event: object) => void, flush: () => void, clear: () => void }}
 */
export function createEventCollector() {
  const pending = [];
  return {
    add: (type, event) => pending.push({ type, event: Object.freeze(event) }),
    flush: () => pending.splice(0).forEach(({ type, event }) => bus.emit(type, event)),
    clear: () => { pending.length = 0; },
  };
}
```

```js
// 서비스에서 — express.md 4절 트랜잭션 패턴에 수집기만 얹는다
const events = createEventCollector();
let conn;
try {
  conn = await getPool().getConnection();
  await conn.beginTransaction();
  await confirmOrder(conn, orderId, actorId);
  events.add('OrderConfirmed', { orderId, actorId });   // 아직 전달하지 않는다 — 예약만
  await conn.commit();
  events.flush();                                       // 커밋 성공 후에만 전달
} catch (err) {
  if (conn) await conn.rollback();
  events.clear();                                       // 롤백이면 예약도 버린다
  throw err;
} finally {
  if (conn) conn.release();
}
```

**Spring**:

```java
// 발행 — @Transactional 서비스 안에서. 실제 전달은 커밋 후 (리스너의 phase가 결정)
publisher.publishEvent(new OrderConfirmed(orderId, actorId));

// 리스너 — 커밋 후, 비동기, DB 쓰기가 있으면 새 트랜잭션
@Async                                                        // 전용 executor로 (@EnableAsync + 풀 크기 지정)
@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
@Transactional(propagation = Propagation.REQUIRES_NEW)        // 커밋 후 시점의 쓰기가 사라지지 않게
public void onOrderConfirmed(OrderConfirmed event) { ... }
```

- `@Async` void 메서드의 예외는 호출자에게 가지 않는다 — `AsyncUncaughtExceptionHandler`를 등록해 error 로그를 남긴다.
- 이벤트는 `record`로 정의한다 (불변).

## 6. 검증 포인트

- 자동화 테스트: 롤백되면 리스너가 실행되지 않는다 / 리스너가 실패해도 본처리 결과와 응답은 그대로다 / (Node) 리스너 예외 후에도 프로세스가 살아 있다.
- 실동작 검증(/live-test): 후속 처리 결과(알림 생성 등)를 조회로 확인하고, 리스너 로그에 원 요청의 요청 ID가 찍히는지 본다.
