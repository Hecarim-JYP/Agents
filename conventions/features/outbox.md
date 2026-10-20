# 레시피: Outbox — 반드시 전달해야 하는 비동기 작업 `[공통]`

> 확정: 2026-10-14 | 테이블: `schemas/07_outbox.sql` | 짝: domain-event.md(놓쳐도 되는 후속 처리)
> 업무 변경과 **같은 트랜잭션**에 "보낼 메시지"를 저장하고, 별도 relay 워커가 선점 → 발송 → 결과 기록한다. 수신 측은 멱등 키로 중복을 거부한다.

## 1. 언제 쓰나

DB 커밋과 외부 호출은 하나로 묶을 수 없다(이중 쓰기 문제). 순서를 어떻게 해도 구멍이 남는다:

| 순서 | 실패 지점 | 결과 |
|---|---|---|
| 커밋 → API 호출 | 호출 실패·서버 다운 | 우리 DB엔 있고 상대엔 없음 (**누락**) |
| API 호출 → 커밋 | 커밋 실패 | 상대엔 있고 우리엔 없음 (**유령 데이터**) |
| 호출 → 응답 유실 → 재시도 | 상대는 이미 처리함 | **중복 처리** (이중 출고 등) |

| 이런 작업이면 | 수단 |
|---|---|
| **외부 시스템에 쓰는 연동**(사내 ERP·타 시스템 인터페이스) | **outbox (기본 — 2026-10-14 확정)** |
| 우리 시스템 안이라도 **반드시 실행돼야 하는 비동기 작업**(필수 통지 메일 등) | outbox (`target_system='MAIL'` 등) |
| 응답이 즉시 필요한 쓰기(결제 승인처럼 결과를 화면에 바로 보여야 함) | 동기 호출 — integration.md 4절 (재시도 금지 + 멱등 키) |
| 조회 연동 | 동기 호출 — integration.md |
| 놓쳐도 되는 후속 처리(화면 알림 뱃지·캐시 무효화) | domain-event.md |

## 2. 결정 항목 (기본값 — 2026-10-14 확정)

| 결정 | 기본값 | 대안 / 비고 |
|---|---|---|
| relay 실행 방식 | **상주 워커 컨테이너** — 서버와 같은 이미지, 진입점만 다르게. 연동 지연 수 초 | 1분 지연이 허용되면 배치 컨테이너 + cron(batch.md 1절 b) |
| 순서 보장 | **같은 업무 건(aggregate) 안에서만** — 앞 메시지가 SENT/CANCELLED가 되기 전엔 다음을 보내지 않는다 | 순서 무보장 + 수신 측이 시각·버전으로 오래된 것 무시 |
| 재시도 | **재시도 8회** — 3-4절 간격표, 약 16시간 뒤 FAILED + 알림 | 연동 대상별 개별 지정 |
| 보관 | SENT·CANCELLED **90일** 후 정리 배치로 삭제 | 감사 요건에 따라 연장 |
| 수신 측이 멱등을 지원 못함 | 협의 필수. 불가하면 **재시도 전에 상대 조회 API로 처리 여부를 확인한 뒤 재전송**하고, 이 제약을 CLAUDE.md에 기록 | 재시도 금지(FAILED 후 수동 처리) |

프로젝트마다 CLAUDE.md에 기록: 연동 대상(`target_system`) 목록과 담당 창구, 수신 측 멱등 방식, 화면에 연동 상태를 보여줄지(3-7절).

## 3. 표준 설계

### 3-1. 흐름

```
[서비스]  BEGIN
            업무 테이블 INSERT/UPDATE
            outbox_message INSERT (status=PENDING, message_key=UUID)   ← 같은 트랜잭션
          COMMIT → 사용자에게 "저장 완료" (외부 반영을 기다리지 않는다)

[relay]   ① 후보 조회 → ② 조건부 UPDATE로 선점(PROCESSING + locked_by + locked_until)
          ③ 트랜잭션 밖에서 external/{system}으로 발송 (헤더 Idempotency-Key)
          ④ 결과 기록: SENT / PENDING(재시도 예약) / FAILED(+알림)

[수신 측] message_key를 UNIQUE로 기록 — 이미 처리한 키면 처리하지 않고 이전 결과(2xx)를 돌려준다
```

### 3-2. 적재 (서비스 계층)

- **업무 변경과 같은 트랜잭션에서, 서비스가 직접** 적재한다. 쿼리 함수는 서비스의 `conn`을 받아 쓰기만 한다 (express.md 4절·spring.md 5절과 같은 원칙).
- `message_key`는 적재 시 UUID로 생성한다. `aggregate_type`·`aggregate_id`는 원천 업무 테이블명·PK — 추적과 순서 보장의 키다.
- `payload`는 **생성 시점 스냅샷(우리 도메인 형식)**. 상대 형식으로의 변환은 발송 시 `external/{system}` 클라이언트가 한다 (integration.md 2절 — 외부 계약 변경이 서비스까지 번지지 않게). 개인정보는 연동에 필요한 최소만, 파일은 본문 대신 파일 ID로.

### 3-3. relay — 선점·발송·결과 기록

설정 기본값: 묶음 크기 10건 / 선점 유효시간(lease) 120초 / 일이 없을 때 3초 대기. **lease는 "묶음 크기 × 발송 타임아웃(5초) × 2"보다 길게** 잡는다 — 묶음을 다 보내기 전에 만료되면 다른 relay가 회수해 중복 발송된다.

```sql
-- ① 후보 조회 — 발송 시각이 된 PENDING + 선점이 만료된 PROCESSING(죽은 relay의 몫)
--    NOT EXISTS: 같은 업무 건의 앞 메시지가 아직 안 끝났으면 제외 (순서 보장)
SELECT o.outbox_message_id
  FROM outbox_message o
 WHERE ((o.status = 'PENDING' AND o.next_attempt_at <= NOW())
     OR (o.status = 'PROCESSING' AND o.locked_until < NOW()))
   AND NOT EXISTS (
       SELECT 1 FROM outbox_message p
        WHERE p.aggregate_type = o.aggregate_type
          AND p.aggregate_id = o.aggregate_id
          AND p.outbox_message_id < o.outbox_message_id
          AND p.status IN ('PENDING', 'PROCESSING', 'FAILED'))
 ORDER BY o.outbox_message_id
 LIMIT :batch_size;

-- ② 선점 — 조회와 UPDATE 사이에 다른 relay가 먼저 잡았으면 조건이 안 맞아 0행 (sql.md 8-2절과 같은 원리)
UPDATE outbox_message
   SET status = 'PROCESSING', locked_by = :run_id,
       locked_until = NOW() + INTERVAL :lease_seconds SECOND
 WHERE outbox_message_id IN (:ids)
   AND ((status = 'PENDING' AND next_attempt_at <= NOW())
     OR (status = 'PROCESSING' AND locked_until < NOW()));

SELECT * FROM outbox_message
 WHERE locked_by = :run_id AND status = 'PROCESSING'
 ORDER BY outbox_message_id;                       -- 실제로 내가 잡은 행만 발송한다

-- ④-a 성공 — locked_by 조건: lease가 만료돼 다른 relay가 회수했다면 0행 (덮어쓰지 않는다)
UPDATE outbox_message
   SET status = 'SENT', sent_at = NOW(), locked_by = NULL, locked_until = NULL, last_error = NULL
 WHERE outbox_message_id = :id AND locked_by = :run_id AND status = 'PROCESSING';

-- ④-b 재시도 예약 (재시도 횟수가 남았을 때)
UPDATE outbox_message
   SET status = 'PENDING', retry_count = retry_count + 1,
       next_attempt_at = NOW() + INTERVAL :delay_seconds SECOND,
       last_error = :error, locked_by = NULL, locked_until = NULL
 WHERE outbox_message_id = :id AND locked_by = :run_id AND status = 'PROCESSING';

-- ④-c 최종 실패 (재시도 불가 오류이거나 횟수 소진) — 이어서 알림 (3-5절)
UPDATE outbox_message
   SET status = 'FAILED', retry_count = retry_count + 1, last_error = :error,
       locked_by = NULL, locked_until = NULL
 WHERE outbox_message_id = :id AND locked_by = :run_id AND status = 'PROCESSING';
```

- `run_id`는 **선점 묶음마다 새 UUID** (호스트명을 앞에 붙이면 추적이 쉽다). ④의 affected 0행은 "회수당함"이므로 warn 로그만 남기고 넘어간다 — 중복 발송은 수신 측 멱등 키가 막는다.

### 3-4. 재시도 정책

| 오류 | 처리 | 근거 |
|---|---|---|
| 네트워크 오류·타임아웃·5xx·429 | **재시도** (429에 `Retry-After`가 있으면 그 값을 따른다) | 일시 장애. 타임아웃은 "실패"가 아니라 "결과 모름"이라 멱등 키가 반드시 함께 간다 |
| 4xx (400·401·403·404·422 등) | **즉시 FAILED** | 다시 보내도 결과가 같다 — 재시도는 적체만 만든다. 401·403은 설정 문제일 가능성이 커서 알림 후 수정 → 수동 재발송 |
| payload 변환 실패(우리 코드) | 즉시 FAILED | 코드 수정 후 수동 재발송 |

재시도 간격 (재시도 8회 — `retry_count`가 실패 횟수):

| 실패 횟수 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---|---|---|---|---|---|---|---|---|
| 다음 시도까지 | 1분 | 5분 | 15분 | 30분 | 1시간 | 2시간 | 4시간 | 8시간 | **FAILED** |

- 수신 측이 중복을 409로 응답하는 등 규약이 다르면 `external/{system}` 클라이언트가 "이미 처리됨 = 성공"으로 변환한다 — relay 로직에 상대별 분기를 넣지 않는다.

### 3-5. 감시·알림 (batch.md 3절의 2층 구조 재사용)

- **층 1 — FAILED가 되는 순간 relay가 알린다** (수단·수신자는 batch.md 3절과 같은 경로, 수신자는 개발팀).
- **층 2 — 적체 감시 엔드포인트**: 아래 둘 중 하나라도 해당하면 비200을 답하고 감시 도구에 등록한다. relay가 죽거나 멈춰도 여기서 잡힌다.
  - 발송 시각이 지났는데 **10분 넘게 처리되지 않은 PENDING**이 있다 (`next_attempt_at < NOW() - INTERVAL 10 MINUTE`)
  - FAILED가 1건 이상 남아 있다 (처리될 때까지 빨간불 — 방치를 막는다)
- ⚠ **`/health`에 넣지 않는다** — 외부 장애로 멀쩡한 앱이 재시작 루프에 빠진다 (batch.md 3절·integration.md 6절과 같은 함정).

### 3-6. 운영 조작·정리

```sql
-- 수동 재발송 (원인 해결 후): 횟수를 초기화해 정상 재시도 주기를 다시 탄다
UPDATE outbox_message
   SET status = 'PENDING', retry_count = 0, next_attempt_at = NOW(), last_error = NULL, updated_by = :admin_id
 WHERE outbox_message_id = :id AND status = 'FAILED';

-- 취소 (보내면 안 되는 메시지): 발송 중(PROCESSING)인 행은 건드리지 않는다
UPDATE outbox_message
   SET status = 'CANCELLED', updated_by = :admin_id
 WHERE outbox_message_id = :id AND status IN ('PENDING', 'FAILED');
```

- 수동 조작은 사유와 함께 changelog 또는 incident에 남긴다 (ops.md 4절).
- **FAILED는 같은 업무 건의 뒤 메시지를 막는다** (순서 보장의 의도된 동작) — 재발송하거나 취소해야 뒤가 흘러간다.
- 정리: 정기 배치(batch.md)로 `status IN ('SENT','CANCELLED') AND created_at < NOW() - INTERVAL 90 DAY`를 **1,000건 단위로 나눠** 삭제한다 (batch.md 2절 처리 단위 분할).

### 3-7. 화면 영향

사용자가 받는 "저장 완료"는 **우리 DB 저장 완료**이지 외부 반영 완료가 아니다. 외부가 장애여도 저장은 성공하고 반영은 뒤따른다. 업무상 반영 여부가 중요하면 해당 화면에 **연동 상태(대기 / 완료 / 실패)**를 보여준다 — `aggregate_type`·`aggregate_id`로 최신 outbox 행을 조회한다.

## 4. 함정 (STRICT)

| 함정 | 증상 | 처방 |
|---|---|---|
| 업무 커밋 **후에** outbox 적재 (AFTER_COMMIT 리스너에서 적재하는 경우 포함) | 그 사이 서버가 죽으면 영원히 미발송 — 이중 쓰기 문제 재발 | 같은 트랜잭션에서 적재. 이벤트 리스너로 적재하려면 **동기·같은 트랜잭션**(Spring `@EventListener` 또는 `BEFORE_COMMIT`)만 허용 |
| DB 트랜잭션 안에서 외부 호출 | 외부가 느리면 잠금이 길어져 업무 전체가 느려진다 | 선점 UPDATE는 짧게 커밋하고, 발송은 트랜잭션 밖 |
| 후보 조회와 선점을 **한 문장**(같은 테이블 서브쿼리를 포함한 UPDATE)으로 | **MySQL은 ERROR 1093으로 거부한다** (MySQL 8.4·9.7 LTS도 같음 — 2026-10-20 실측. MariaDB 10.3.2+는 허용 — 실측 2026-10-14). 한쪽 DB에서만 돌아가는 코드가 된다 | 3-3절의 2단계(후보 조회 → 조건부 UPDATE) |
| `SELECT … FOR UPDATE SKIP LOCKED`에 의존 | 지원 최소 버전 MariaDB 10.4(database.md 1절)에는 SKIP LOCKED가 없다(10.6부터) | 조건부 UPDATE 선점 — relay가 여러 개여도 안전 (실측: 동시 선점 시 뒤 세션 0행) |
| 결과 기록에 `locked_by` 조건 누락 | lease가 만료돼 다른 relay가 회수한 행을 늦게 끝난 relay가 덮어쓴다 | ④의 `locked_by = :run_id` 조건 (실측: 회수 후 늦은 기록 0행) |
| lease < 묶음 처리 시간 | 처리 중 만료 → 다른 relay가 회수해 **중복 발송** | lease > 묶음 크기 × 타임아웃 × 2 |
| 4xx까지 재시도 | 적체와 알림 폭주, 상대 시스템 부하 | 3-4절 분류 |
| 멱등 키 없이 재시도 | 응답 유실 시 상대에서 중복 처리 | 매 발송에 `Idempotency-Key: {message_key}`, 수신 측 중복 거부 협의 (2절) |
| 감시 없음 | relay가 죽어도 아무도 모른다 — 며칠 뒤 "ERP에 안 넘어갔어요"로 발견 | 3-5절 2층 감시 |
| 수동 재발송 때 `retry_count`를 안 비움 | 다음 실패에서 곧바로 FAILED | 3-6절 SQL |

## 5. 스택별 구현

| 구성 | Express | Spring |
|---|---|---|
| 적재 | `enqueueOutbox(conn, msg)` 쿼리 함수 — 서비스 트랜잭션의 `conn` 사용 | `OutboxRepository.enqueue(msg)` — `@Transactional` 서비스 안에서 호출(REQUIRED로 합류) |
| relay 진입점 | 같은 이미지의 `dist/relay/index.js` | 같은 jar + `--spring.profiles.active=relay` + `spring.main.web-application-type=none` |
| 발송 | `external/{system}` 클라이언트 재사용 (integration.md 2절 — 타임아웃·에러 변환 그대로) | 동일 |
| 종료 | graceful-shutdown.md — 루프 중단 플래그, 현재 묶음만 끝내고 종료 | 동일 (`SmartLifecycle.stop` 또는 `@PreDestroy`에서 플래그) |

relay 루프 (Express 예):

```js
// relay/index.js — 선점 → 발송 → 결과 기록을 반복하는 상주 워커
let stopping = false;
process.on('SIGTERM', () => { stopping = true; });   // 안전 종료: 지금 묶음만 끝내고 멈춘다 (graceful-shutdown.md)

while (!stopping) {
  const runId = `${os.hostname()}:${randomUUID()}`;           // 이번 선점 묶음의 식별자
  const ids = await findCandidates(BATCH_SIZE);               // ① 후보 조회 (순서 보장 조건 포함)
  const claimed = ids.length ? await claim(ids, runId) : [];  // ② 조건부 UPDATE → 내가 잡은 행만 다시 조회
  for (const msg of claimed) {
    try {
      await externalClients[msg.target_system].send(msg);     // ③ 트랜잭션 밖 HTTP (헤더 Idempotency-Key)
      await markSent(msg.outbox_message_id, runId);           // ④-a affected 0 = 회수당함 → warn 로그
    } catch (err) {
      await markRetryOrFailed(msg, runId, err);               // ④-b/c 3-4절 분류·간격표, FAILED면 알림
    }
  }
  if (claimed.length < BATCH_SIZE) await sleep(IDLE_POLL_MS); // 일이 없으면 잠깐 쉰다
}
await pool.end();                                             // DB 풀 정리 후 종료
```

compose (스캐폴드 템플릿에는 없다 — 쓰기 연동 프로젝트가 처음 도입할 때 추가): base에 `relay` 서비스를 두고 `server`와 같은 `environment`(DB·연동 키)·`depends_on`·`networks`를, deploy override에 `image`(서버 이미지)·`entrypoint`(relay 진입점)·`restart: unless-stopped`·`stop_grace_period`를 둔다 (docker.md 4-1절 base/override 원칙).

## 6. 검증 포인트

- **자동화 테스트**(테스트 DB — testing.md 0절): 업무 행과 outbox 행이 함께 커밋·롤백되는지 / 성공·재시도·4xx 즉시 FAILED 상태 전이 / 간격표 / 같은 업무 건 순서 보장 / lease 만료 회수와 늦은 기록 0행. 외부는 `external/` 계층을 목킹한다 (integration.md 7절).
- **실동작 검증**(/live-test): 연동 대상의 테스트 환경에 실제 도착하는지, 화면 연동 상태 표시. 검증 중 만든 미발송 행은 CANCELLED로 정리한다 (testing.md 6-2절).
- **2026-10-14 실측 기록** (MySQL 8.0.46 / MariaDB 10.11.14): DDL 양쪽 생성, 한 문장 선점 UPDATE가 MySQL에서 ERROR 1093·MariaDB에서 허용, 2단계 선점의 동시 실행 시 뒤 세션 0행, 같은 건 순서 보장(앞이 FAILED면 막히고 CANCELLED면 풀림), lease 만료 회수 후 늦은 기록 0행, 20만 건에서 후보 조회 13ms(인덱스 range + aggregate 인덱스), 잘못된 JSON payload 거부(MariaDB CHECK 제약).
