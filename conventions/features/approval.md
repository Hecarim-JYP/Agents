# 레시피: 결재·승인 워크플로 `[사내]`

> 확정: 2026-10-14 | 테이블: `schemas/09_approval.sql` | 원칙: auth.md 5절(결재 시점 스냅샷 동결) | 짝: state-machine.md, notification.md
> 업무 문서를 상신하면 결재선 순서대로 승인·반려하고, 최종 승인되면 문서 상태가 바뀐다. **결재 중 원문은 잠기고, 결재한 내용과 결재자 정보는 그 시점 그대로 동결된다.**

## 1. 언제 쓰나

업무 문서가 한 사람 이상의 승인을 거쳐야 효력이 생길 때 — 구매 요청, 지출, 계약, 단가 변경 등. 단일 관리자의 "승인" 버튼 하나면 결재선 없이 상태 머신(state-machine.md)만으로 충분하다.

## 2. 결정 항목 (기본값)

| 결정 | 기본값 | 대안 / 비고 |
|---|---|---|
| 결재 엔진 ⚑ | **사내 전자결재(그룹웨어)가 있으면 연동이 우선** — 상신은 outbox로 보내고(outbox.md), 결과는 수신 API로 받아 문서 상태를 전이한다(수신 측 멱등 — idempotency.md) | 사내 결재가 없거나 연동이 불가하면 **자체 결재** — 이 레시피의 3절 이하 |
| 결재선 구성 | 순차 결재(APPROVE) + 합의(AGREE, 순서에 끼워 넣음) + 참조(REFERENCE, 열람만) | 병렬 합의(같은 순서 여럿)는 필요할 때 seq 중복 허용으로 확장 |
| 결재선 결정 | 기안자가 지정, 기본 결재선은 조직도에서 제안 | 상신 후 결재선 변경 금지 — 바꾸려면 회수 후 재상신 |
| 반려 | 기안자에게 돌아가고 문서는 수정 가능 상태로. **재상신은 새 결재 요청** | 반려 시점부터 이어서 결재하는 방식은 쓰지 않는다 (앞 결재자가 바뀐 내용을 못 봤다) |
| 회수 | **첫 결재 전까지만** 기안자가 회수 | |
| 대결(위임) | 위임 기간 안에서 대리인이 결재 — 처리자와 원 결재자를 **둘 다** 기록 | |

자체 결재 채택 여부와 결재 대상 문서 목록은 CLAUDE.md에 기록한다 (시작 결정 체크리스트 26).

## 3. 표준 설계 (자체 결재)

### 3-1. 상태

| 대상 | 상태 흐름 |
|---|---|
| 결재 요청 `approval_request` | `IN_PROGRESS` → `APPROVED` / `REJECTED` / `WITHDRAWN` |
| 결재선 한 줄 `approval_line` | `WAITING` → `PENDING`(내 차례) → `APPROVED` / `REJECTED`, 반려·회수로 끝나면 남은 줄은 `SKIPPED` |
| 업무 문서 | state-machine.md 전이표: `SUBMIT`(→ 결재 중) · 최종 승인 시 `APPROVE` · 반려 시 `REJECT` · 회수 시 `WITHDRAW` |

### 3-2. 처리 — 모든 결재 행위는 결재 요청 행을 먼저 잠근다

상신·승인·반려·회수는 **한 트랜잭션에서 `approval_request`를 `SELECT … FOR UPDATE`로 잠그고 시작한다** (sql.md 8-3절). 같은 문서에 대한 결재 행위들이 차례로 처리된다.

```
승인(actor):
 BEGIN
  ① SELECT status, current_seq FROM approval_request WHERE approval_request_id = :id FOR UPDATE
     status ≠ IN_PROGRESS → 409
  ② 현재 차례 줄(seq = current_seq, status = PENDING) 조회 → actor가 결재자이거나 유효한 대리인인지 확인 (아니면 403)
  ③ UPDATE approval_line SET status='APPROVED', acted_by, acted_snapshot, comment, acted_at
       WHERE approval_line_id = :line AND status = 'PENDING'          ← 0행이면 409 (더블클릭)
  ④ 다음 차례가 있으면: 그 줄 PENDING + current_seq 이동 + 다음 결재자 알림
     없으면: 요청 APPROVED + 업무 문서 APPROVE 전이(state-machine.md) + 기안자 알림 + (필요 시) outbox 적재
  ⑤ change_log 기록 (change-history.md)
 COMMIT
```

- 반려: ③에서 `REJECTED` + 의견 필수 → 남은 `WAITING`·`PENDING` 줄 `SKIPPED` → 요청 `REJECTED` → 문서 `REJECT` 전이.
- 회수: ①의 잠금 후 **이미 처리된 줄(APPROVED·REJECTED)이 하나라도 있으면 409** → 아니면 요청 `WITHDRAWN`, 줄 `SKIPPED`, 문서 `WITHDRAW` 전이.
- 상신: 문서 `SUBMIT` 전이(편집 잠금 시작) + 요청 INSERT(**`document_snapshot`에 문서 내용 동결**) + 결재선 INSERT(**`approver_snapshot`에 이름·부서·직급 동결**) + 첫 줄 `PENDING` + 첫 결재자 알림.

### 3-3. 동결과 잠금

- **원문 잠금**: 결재 중에는 업무 문서의 수정 API가 409를 낸다 — 편집 가능 상태 조건(state-machine.md 3-4절).
- **내용 동결**: 결재 화면은 `document_snapshot`을 보여준다. 반려 후 수정·재상신하면 새 요청에 새 스냅샷 — 각 결재 라운드가 "무엇을 결재했는지" 독립적으로 남는다.
- **사람 동결**: 결재자가 나중에 부서를 옮기거나 퇴사해도 결재 기록의 이름·직급은 `*_snapshot`에서 읽는다 (auth.md 5절).

### 3-4. 대결

- `approval_delegation`에서 `delegator_id = 원 결재자 AND delegate_id = actor AND NOW() BETWEEN start_at AND end_at AND is_active = 1`이면 대리 결재 허용.
- `acted_by`는 실제 처리자, `acted_snapshot`에 처리자 정보와 `"on_behalf_of": 원 결재자`를 함께 남긴다 — 화면에 "홍길동(대결: 김부장)".

### 3-5. 조회 권한 (데이터 스코프 — auth.md 4-2절)

결재 문서 열람은 **기안자 + 결재선(참조 포함) + 그 시점 유효한 대리인 + 관리자**만. 목록 쿼리의 스코프 조건으로 걸러야 한다 — "내 결재함"이 아닌 일반 목록 API로 남의 결재 문서가 나오지 않게.

### 3-6. 예외 운영

- **결재자 퇴사·장기 부재**로 문서가 멈추면: 관리자가 해당 줄의 결재자를 재지정한다(사유와 함께 change_log·audit_log 기록). 자동으로 건너뛰지 않는다.
- 결재 대기 장기 체류는 알림 재발송 대상이다 (notification.md — 리마인드는 새 사건 키로).

## 4. 함정 (STRICT)

| 함정 | 증상 | 처방 |
|---|---|---|
| **결재 요청 행을 잠그지 않음** | 승인과 회수가 **둘 다 성공** — 요청은 회수됐는데 1단계는 승인, 2단계는 "내 차례"로 결재함에 남는다 (실측 2026-10-14: 잠금 없음 → 승인 성공·회수 성공 / 잠금 있음 → 회수 409) | 3-2절 ① `FOR UPDATE` |
| 줄 갱신에 `status = 'PENDING'` 조건 누락 | 더블클릭·두 탭으로 같은 줄이 두 번 처리되어 다음 단계가 건너뛰어진다 | ③ 조건부 UPDATE (실측: 동시 2요청 → 1건 성공·1건 409) |
| 결재 중 원문 수정 허용 | 결재자가 본 것과 최종 문서가 다르다 | 편집 잠금 + `document_snapshot` |
| 결재자 정보를 사용자 테이블에서 조인해 표시 | 인사이동 후 과거 결재 기록의 직급·부서가 바뀌어 보인다 | `*_snapshot` |
| 반려 후 같은 요청을 "이어서" 진행 | 앞 결재자가 수정된 내용을 못 본 채 승인 기록이 남는다 | 재상신 = 새 요청 |
| 퇴사자 줄 자동 건너뛰기 | 결재 없이 승인된 문서가 생긴다 | 관리자 재지정 (3-6절) |
| 사내 전자결재가 있는데 자체 결재 구현 | 결재함이 두 개가 되어 결재자가 한쪽을 놓친다 | 2절 — 연동 우선 |

## 5. 스택별 구현

| 구성 | Express | Spring |
|---|---|---|
| 행 잠금 | `SELECT … FOR UPDATE` (서비스 트랜잭션 `conn`) | JdbcClient로 같은 SQL, 또는 JPA `@Lock(PESSIMISTIC_WRITE)` |
| 트랜잭션 | express.md 4절 패턴 — 승인 ①~⑤가 한 트랜잭션 | `@Transactional` 서비스 메서드 하나 |
| 알림·연동 | 같은 트랜잭션에서 notification INSERT, 외부 채널은 outbox 적재 (notification.md) | 동일 |
| 엔드포인트 | `POST /approvals/:id/approve` · `/reject` · `/withdraw` (api.md 1절 액션 예외) | 동일 |

## 6. 검증 포인트

- 자동화 테스트(테스트 DB): 같은 줄 동시 승인 2건 → 1건 409 / 승인 vs 회수 동시 → 한쪽만 성공하고 상태 일관 / 마지막 승인 → 문서 상태 전이·기안자 알림 / 반려 → 남은 줄 SKIPPED, 문서 수정 가능 / 기간 밖 대리인 → 403.
- 실동작 검증(/live-test 관찰자 모드): 기안자·결재자·대리인 계정으로 실제 화면을 돌리며, 각 단계마다 approval_line·문서 상태·알림 행을 조회한다.
