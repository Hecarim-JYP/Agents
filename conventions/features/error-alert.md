# 레시피: 서버 에러 알림 `[공통]`

> 확정: 2026-10-14 | 테이블: `schemas/12_error_event.sql` | 짝: request-id.md, ops.md 7절(가동 감시) | 알림 전달: outbox.md
> 예상하지 못한 서버 에러(5xx)를 **원인(지문)별로 묶어 세고, 같은 원인의 알림은 10분에 한 번만** 개발팀에 보낸다. 사용자 제보 전에 개발팀이 먼저 안다.

## 1. 언제 쓰나

| 감시 대상 | 수단 |
|---|---|
| 서버·앱이 살아 있나 | 가동 감시 (ops.md 7절) |
| 정기 배치가 돌았나 | 배치 이력·감시 엔드포인트 (batch.md 3절) |
| outbox 적체·실패 | outbox.md 3-5절 |
| **살아 있는 앱이 요청 처리 중 예상 못 한 에러를 낸다** | **이 레시피** |

- 대상은 **5xx(예상하지 못한 에러)**뿐이다. 4xx(검증 실패·권한 없음·충돌)는 정상 동작이므로 알리지 않는다.

## 2. 결정 항목 (기본값)

| 결정 | 기본값 | 대안 |
|---|---|---|
| 수단 | **자체 경량 집계**(error_event + outbox 알림) | 사내 로그 수집·알림 시스템이 있으면 그쪽. 외부 SaaS(에러 추적 서비스)는 에러 내용(요청·데이터)이 회사 밖으로 나가므로 보안 검토 후에만 |
| 알림 채널·수신자 | 개발팀 채널(사내 메신저 또는 메일) — 개인이 아니라 팀 | batch.md 3절과 같은 원칙 |
| 억제 간격 | 같은 지문 **10분에 1회** | |
| 재발 | 개발자가 "처리 완료"로 표시한 지문이 다시 나면 즉시 알린다 | |

## 3. 표준 설계

### 3-1. 지문 — 같은 원인을 같은 행으로

```
fingerprint = sha256( 에러 종류 | 에러 코드 | 라우트 템플릿 | 우리 코드의 첫 스택 위치(파일:줄) )
```

- **에러 메시지는 지문에 넣지 않는다** — 메시지에 ID·값이 섞여(`Duplicate entry 'A-1023'…`) 발생할 때마다 새 지문이 되고 알림이 폭주한다.
- 라우트는 **템플릿**(`/:id`)만 — 실제 URL(`/orders/1023`)을 넣지 않는다. 실측(Express 4): ID가 다른 두 요청이 같은 지문으로 묶인다.
- ⚠ Express 앱 단 에러 핸들러에서는 `req.baseUrl`이 **비어 있다** — 라우트 템플릿이 `/api/orders/:id`가 아니라 `/:id`만 남는다(실측). 그래서 **스택 위치(파일:줄)를 지문에 반드시 포함**해 라우터 간 구분을 보장한다.
- 스택 위치는 `node_modules`·Node 내부(`node:`)를 건너뛴 첫 줄 — 우리 코드에서 터진 지점이다.

### 3-2. 기록과 알림 억제 — 중앙 에러 핸들러에서

```sql
-- ① 집계 — 처음이면 INSERT, 있으면 횟수 증가. 해결 표시된 지문이 재발하면 알림 시각을 비워 즉시 다시 알린다
--    ⚠ 대입 순서: last_alerted_at을 resolved_at보다 먼저 쓴다 (3-3절)
INSERT INTO error_event (fingerprint, error_name, error_code, route, sample_message, last_request_id)
VALUES (:fp, :name, :code, :route, :message, :request_id)
ON DUPLICATE KEY UPDATE
    occurrence_count = occurrence_count + 1,
    last_seen_at     = NOW(),
    last_request_id  = VALUES(last_request_id),
    sample_message   = VALUES(sample_message),
    last_alerted_at  = IF(resolved_at IS NULL, last_alerted_at, NULL),
    resolved_at      = NULL;

-- ② 알림 담당 정하기 — 이 UPDATE가 1행을 바꾼 요청만 알림을 보낸다 (동시에 수십 건 나도 1건)
UPDATE error_event SET last_alerted_at = NOW()
 WHERE fingerprint = :fp
   AND (last_alerted_at IS NULL OR last_alerted_at < NOW() - INTERVAL 10 MINUTE);
```

- ②가 1행이면 outbox에 알림 적재(`target_system='ALERT'` — outbox.md). 내용: 에러 종류·코드·라우트·스택 위치·**지난 알림 이후 발생 수**·최근 요청 ID(request-id.md — 이 ID로 로그 전체를 찾는다).
- 알림에 **에러 메시지·요청 본문을 넣지 않는다** — DB 에러 메시지에는 입력값(개인정보)이 그대로 들어 있다. `sample_message`는 개발자만 보는 DB에만.
- 에러 기록 자체가 실패해도(DB 장애) **원래 에러 응답을 망치지 않는다** — 기록은 try/catch로 감싸 로그만 남긴다. DB 장애 자체는 가동 감시(ops.md 7절)가 잡는다.

### 3-3. 프로세스 수준 에러

- Node의 `uncaughtException`·`unhandledRejection`은 **로그(요청 ID 포함) 후 프로세스를 종료**한다 — 상태를 알 수 없는 프로세스를 계속 쓰지 않는다. 컨테이너 `restart: unless-stopped`가 다시 띄우고, 반복 재시작은 가동 감시가 잡는다. 이 시점에 DB 기록·알림을 시도하지 않는다(종료 중이라 끝나지 않는다).
- Express 4의 async 핸들러 예외는 `asyncHandler` 없이는 중앙 핸들러로 오지 않고 unhandledRejection이 된다 (express.md 2절). **Express 5(현재 `npm i express` 기본)는 async 예외를 중앙 핸들러로 자동 전달한다**(실측 2026-10-19, Express 5.3: `asyncHandler` 없이 throw → errorHandler 500 응답, 프로세스 유지). 지문 규칙(3-1절의 라우트 템플릿 `/:id`·빈 `req.baseUrl`)도 Express 5에서 같다(실측).

## 4. 함정 (STRICT)

| 함정 | 증상 | 처방 |
|---|---|---|
| 클라이언트 오류(깨진 JSON·용량 초과)를 500으로 응답 | 외부에서 잘못된 요청만 보내도 알림이 울린다 (실측: 흔한 errorHandler는 전부 500) | 4xx로 먼저 거른다 (error-pages.md 3-1절) |
| 메시지·실제 URL을 지문에 포함 | 발생마다 새 지문 → **알림 폭주**, 묶음 집계 불가 | 3-1절 규칙 |
| 라우트 템플릿만으로 지문 | `/:id` 같은 흔한 경로가 서로 다른 라우터끼리 합쳐진다 (실측: 앱 단 핸들러에서 `req.baseUrl` 비어 있음) | 스택 위치 포함 |
| 알림 억제를 앱 메모리로 | 재시작마다 초기화, 인스턴스마다 따로 알림 | DB 조건부 UPDATE (실측: 같은 지문 동시 20건 → 집계 20, 알림 1) |
| **ON DUPLICATE KEY UPDATE 대입 순서** | `resolved_at = NULL`을 먼저 쓰면 뒤의 `IF(resolved_at IS NULL, …)`이 **이미 바뀐 값**을 보고 재발 알림이 안 나간다 (실측: MariaDB 10.11 — 왼쪽부터 순서대로 대입) | 3-2절 순서 |
| 알림에 에러 메시지 원문 | 메신저·메일에 고객 정보가 퍼진다 | 종류·코드·위치·요청 ID만 |
| 에러 기록이 원래 응답을 깨뜨림 | DB 장애 때 모든 요청이 기록 실패로 다른 에러를 낸다 | try/catch + 로그만 |
| 4xx까지 알림 | 검증 실패마다 알림 — 아무도 안 본다 | 5xx만 |
| 수신자가 개인 | 휴가·퇴사로 알림이 사라진다 | 팀 채널 |

## 5. 스택별 구현

| 구성 | Express | Spring |
|---|---|---|
| 중앙 핸들러 | 에러 미들웨어(맨 마지막)에서 5xx면 3-2절 실행 | `@RestControllerAdvice`의 미처리 예외 핸들러(spring.md 4절)에서 |
| 라우트 템플릿 | `req.route?.path` (+ 스택 위치) | `HandlerMapping.BEST_MATCHING_PATTERN_ATTRIBUTE` 요청 속성 |
| 스택 위치 | `err.stack`에서 `node_modules`·`node:` 아닌 첫 줄 | `getStackTrace()`에서 우리 패키지로 시작하는 첫 요소 |
| 알림 전달 | outbox `ALERT` → relay → `external/messenger` | 동일 |

## 6. 검증 포인트

- 자동화 테스트(테스트 DB): 같은 지점 에러 N건 → error_event 1행·횟수 N·알림 1 / 10분 후 재발 → 알림 1 추가 / 해결 표시 후 재발 → 즉시 알림 / error_event 기록이 실패해도 원래 500 응답은 그대로.
- 실동작 검증(/live-test 런타임 축): 테스트용으로 일부러 500을 내고 → 개발팀 채널에 알림이 오는지 → 알림의 요청 ID로 서버 로그를 찾을 수 있는지.
