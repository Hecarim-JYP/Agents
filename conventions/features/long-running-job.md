# 레시피: 장시간 작업 (비동기 처리·진행률) `[공통]`

> 확정: 2026-10-14 | 테이블: `schemas/11_async_job.sql` | 짝: outbox.md(선점 방식), excel-download.md(동기 상한), notification.md(완료 알림)
> 수십 초 이상 걸리는 처리는 HTTP 요청 안에서 하지 않는다. **요청은 즉시 접수(202)하고, 워커가 처리하고, 화면은 상태·진행률을 조회한다.** 결과는 파일로 보관했다가 만료되면 지운다.

## 1. 언제 쓰나

| 처리 시간 | 방식 |
|---|---|
| 수 초 이내 | 일반 요청 |
| 수 초 ~ 프록시 타임아웃(nginx 기본 `proxy_read_timeout` 60초) 안쪽, 데이터가 계속 흐르는 스트리밍 | 일반 요청 + 스트리밍 (excel-download.md) |
| 그 이상이거나 예측 불가 — 동기 상한을 넘는 엑셀 추출, 일괄 재계산, 대량 발송, 보고서 생성 | **장시간 작업 (이 레시피)** |
| 정해진 시각에 도는 일 | 정기 배치 (batch.md) |

## 2. 결정 항목 (기본값)

| 결정 | 기본값 | 근거 |
|---|---|---|
| 실행 주체 | **상주 워커**(outbox relay와 같은 워커 컨테이너에 작업 루프를 하나 더) | 컨테이너를 늘리지 않는다. 작업이 무거워지면 별도 워커로 분리 |
| 동시 실행 | 워커당 1건, 사용자당 진행 중 2건까지 | 무거운 작업이 몰려 DB를 붙잡지 않게 |
| 같은 요청 중복 | 같은 사용자·같은 유형·같은 조건이 진행 중이면 **기존 작업을 돌려준다** | 기다리다 지쳐 다시 누르는 것이 기본 사용자 행동이다 |
| 자동 재시도 | **하지 않는다** — 실패하면 FAILED + 사유, 사용자가 다시 요청 | 무거운 작업의 자동 재시도는 부하를 키운다. 멱등이 보장된 작업만 예외 |
| 워커 중단 시 | 선점이 만료된 RUNNING은 **FAILED("서버 재시작으로 중단 — 다시 요청")** | 중간부터 이어하기는 작업마다 설계가 달라 기본으로 두지 않는다 |
| 결과 보관 | 결과 파일 **7일** 후 정리 배치가 파일·행 함께 삭제 | 디스크가 결과 파일로 차는 것 방지 (ops.md 8절) |

## 3. 표준 설계

### 3-1. API

| 단계 | 요청 | 응답 |
|---|---|---|
| 접수 | `POST /jobs` `{ job_type, params }` (또는 기능별 `POST /orders/export-jobs`) | **202** `{ data: { async_job_id, status } }` — 같은 요청이 진행 중이면 그 작업 |
| 상태 | `GET /jobs/:id` | `{ status, progress_done, progress_total, error_message }` |
| 결과 | `GET /jobs/:id/result` | 파일 (excel-download.md 3-3·3-4절과 같은 응답·클라이언트 처리) |
| 취소 | `POST /jobs/:id/cancel` | QUEUED면 즉시 CANCELLED, RUNNING이면 CANCEL_REQUESTED |

- 상태·결과 조회는 **요청자 본인만**(관리자 제외) — `requested_by` 조건 (auth.md 4-2절).
- 화면은 2~5초 간격으로 상태를 조회하고, 완료되면 화면 알림도 받는다 (notification.md — 창을 닫았어도 알 수 있게).

### 3-2. 접수 — 중복 방지

- `params`는 **검증을 마친 값**만 저장하고(express.md 3절 — 워커가 다시 검증하지 않아도 되게), `params_hash = sha256(job_type + 키 정렬한 params JSON)`.
- `active_key = '{requested_by}:{job_type}:{params_hash}'`를 함께 INSERT — UNIQUE 위반(`uq_async_job_active`)이면 그 키로 기존 작업을 조회해 반환한다 (실측 2026-10-14: 동시 2요청 → 새 작업 1개 + 같은 작업 반환, 완료 후 재요청은 새 작업).
- 작업이 끝나는 UPDATE(SUCCEEDED·FAILED·CANCELLED)에서 **`active_key = NULL`을 같이 설정**한다 — 그래야 같은 조건으로 다시 요청할 수 있다.

### 3-3. 워커

- 선점은 outbox와 같다 — 조건부 UPDATE로 `QUEUED → RUNNING` + `locked_by` + `locked_until` (outbox.md 3-3절). lease는 **진행률을 갱신할 때마다 연장**한다(작업이 lease보다 길어도 살아 있으면 회수되지 않게).
- 처리는 **청크 단위**(예: 1,000건)로 하고, 청크마다: 진행률 UPDATE(+lease 연장) → `CANCEL_REQUESTED`인지 확인 → 맞으면 정리하고 CANCELLED.
- 결과 파일은 `files`(03_files.sql)에 저장하고 `result_file_id`·`expires_at` 기록 → SUCCEEDED → 요청자에게 화면 알림.
- 실패: 사용자에게 보일 사유는 `error_message`, 스택은 로그(요청 ID — 작업 실행 ID로 대체, request-id.md 3-3절).
- 정리: 선점이 만료된 RUNNING → FAILED(중단). 만료된 결과 → 파일 삭제 + 행 정리. 둘 다 워커 루프 또는 정기 배치에서.
- 안전 종료(graceful-shutdown.md): SIGTERM을 받으면 지금 청크까지만 하고 멈춘다 — 남은 작업은 lease 만료 후 FAILED로 정리된다.

## 4. 함정 (STRICT)

| 함정 | 증상 | 처방 |
|---|---|---|
| **HTTP 요청 안에서 오래 처리** | 프록시가 504를 돌려줘도 **앱은 끝까지 처리한다** — 사용자는 실패로 알고 다시 눌러 **이중 처리** (실측: nginx `proxy_read_timeout` 2초로 재현 — 사용자 504 두 번, 앱은 두 요청 모두 처리 완료) | 202 접수 + 워커 |
| 앱 프로세스 메모리에 작업 큐(배열·`setTimeout`) | 재시작·배포 때 진행 중 작업이 사라지고, 인스턴스가 2개면 상태 조회가 엉뚱한 인스턴스로 간다 (patterns.md 0-3절) | DB 작업 테이블 |
| 같은 요청 중복 접수 | 같은 무거운 작업이 여러 개 돌아 DB를 붙잡는다 | `active_key` UNIQUE (3-2절) |
| **처리 중 키를 생성 열(`AS … STORED`)로** | MariaDB 10.11이 상태 조건 식을 **ERROR 1901로 거부**한다 (실측 — 콜레이션을 바꿔도 동일) | 앱이 상태와 같은 UPDATE에서 직접 설정·해제 |
| 행마다 진행률 UPDATE | 작업보다 진행률 기록이 DB를 더 쓴다 | 청크마다 |
| lease 연장 없음 | 오래 걸리는 정상 작업이 "죽은 워커"로 오인돼 FAILED 처리된다 | 진행률 갱신 시 연장 |
| 결과 파일 무한 보관 | 서버 디스크가 결과 파일로 찬다 | `expires_at` + 정리 |
| 결과 조회에 소유자 조건 없음 | 작업 ID만 바꿔 남의 추출 파일을 받는다 | `requested_by` 조건 |

## 5. 스택별 구현

| 구성 | Express | Spring |
|---|---|---|
| 접수 | 컨트롤러 → 서비스 INSERT → 202 | `ResponseEntity.accepted()` |
| 워커 | relay와 같은 진입점에서 작업 루프 추가 (outbox.md 5절 루프 구조) | 같은 jar의 `relay` 프로필에 작업 루프 Bean |
| 결과 파일 | ExcelJS 스트리밍 쓰기를 파일 스트림으로 (excel-download.md) | SXSSF → 파일 |
| 진행률 | 청크 루프마다 UPDATE (`progress_done`, `locked_until`) | 동일 |

## 6. 검증 포인트

- 자동화 테스트(테스트 DB): 같은 요청 동시 접수 → 작업 1개 / 완료 후 재요청 → 새 작업 / 취소 요청 → 다음 청크에서 CANCELLED / lease 만료 RUNNING → FAILED / 남의 작업 결과 → 403·404.
- 실동작 검증(/live-test 관찰자 모드): 큰 추출을 요청하고 진행률이 오르는지, 창을 닫았다가 알림으로 결과를 받는지, 처리 도중 `docker compose restart`하면 FAILED("다시 요청")로 정리되는지.
