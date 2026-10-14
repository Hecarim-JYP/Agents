# 레시피: 상태 머신 (전이표) `[공통]`

> 확정: 2026-10-14 | 원칙: patterns.md 5절(상태는 명시적 이벤트로만 전이), sql.md 8-2절(조건부 UPDATE)의 구현
> 업무 문서의 상태 변경은 **전이표에 정의된 행위로만** 일어난다. 전이표가 단일 출처 — 서버 검증, 화면 버튼, 문서의 상태도가 모두 여기서 나온다.

## 1. 언제 쓰나

상태 컬럼이 있고 "이 상태에서만 할 수 있는 일"이 있는 업무 문서 — 신청서, 주문, 결재 대상 문서, 검사 의뢰 등. 상태가 2개뿐이고(사용/미사용) 규칙이 없으면 쓰지 않는다.

## 2. 결정 항목 (기본값)

| 결정 | 기본값 | 근거 |
|---|---|---|
| 상태 값 | 대문자 코드 문자열 컬럼(`status VARCHAR(30)`) + 화면 명칭은 공통코드 | database.md 4절 — 매직 넘버 금지 |
| 전이 정의 위치 | **서버 코드의 전이표 상수 하나** | DB에 두면 전이 규칙 변경이 배포 없이 바뀌어 코드와 어긋난다 |
| 전이 이력 | change_log에 행위명으로 기록 (change-history.md) | 상태 전이는 "누가 언제 왜"가 가장 자주 묻는 이력이다 |
| 화면 버튼 | 서버가 상세 응답에 **`allowed_actions`**를 내려준다 | 클라이언트에 전이표를 복제하면 반드시 어긋난다 |

## 3. 표준 설계

### 3-1. 전이표 — 상태가 아니라 "행위" 중심

```js
// salesOrderTransitions.js — 주문 상태는 여기 정의된 행위로만 바뀐다 (단일 출처)
export const SALES_ORDER_TRANSITIONS = Object.freeze({
  SUBMIT:   { from: ['DRAFT', 'REJECTED'], to: 'IN_APPROVAL', permission: 'sales_order.write' },
  APPROVE:  { from: ['IN_APPROVAL'],       to: 'APPROVED',    permission: null },  // 결재 처리 내부에서만 호출
  REJECT:   { from: ['IN_APPROVAL'],       to: 'REJECTED',    permission: null },
  WITHDRAW: { from: ['IN_APPROVAL'],       to: 'DRAFT',       permission: 'sales_order.write' },
  CANCEL:   { from: ['DRAFT', 'APPROVED'], to: 'CANCELLED',   permission: 'sales_order.cancel' },
});
```

- 행위 이름은 동사(`SUBMIT`), 상태 이름은 결과(`IN_APPROVAL`). 같은 목표 상태라도 행위가 다르면 따로 정의한다 — 이력과 권한이 행위 단위로 갈린다.
- `permission: null` = 사용자가 직접 부를 수 없고 다른 처리(결재 완료 등)가 내부에서 호출하는 전이.

### 3-2. 전이 처리 — 읽고, 판정하고, 조건부로 바꾼다

```js
/**
 * 상태 전이 — 현재 상태·버전을 조건으로 갱신해, 그 사이 다른 요청이 바꿨으면 0행(409)이 된다
 * @param {object} conn 서비스 트랜잭션의 연결 (express.md 4절)
 * @param {{ id: number, action: string, actorId: number, expectedVersion: number, reason?: string }} p 전이 요청
 * @returns {Promise<{ before: string, after: string }>} 전이 전·후 상태
 */
export async function transitionSalesOrder(conn, { id, action, actorId, expectedVersion, reason }) {
  const t = SALES_ORDER_TRANSITIONS[action];
  if (!t) throw new BadRequestError('UNKNOWN_ACTION');
  const current = await findStatusAndVersion(conn, id);                 // SELECT status, version
  if (!current) throw new NotFoundError();
  if (!t.from.includes(current.status)) throw new ConflictError('INVALID_STATE_TRANSITION');   // "현재 상태에서 할 수 없는 작업"
  const affected = await updateStatusIfUnchanged(conn, {               // WHERE id AND status = :current AND version = :expected
    id, to: t.to, current: current.status, expectedVersion, actorId,
  });
  if (affected === 0) throw new ConflictError('CONFLICT');              // 그 사이 다른 사용자가 바꿨다 — 새로고침 안내
  await insertChangeLog(conn, { aggregateType: 'sales_order', aggregateId: id, action,
    changes: { status: { before: current.status, after: t.to } }, reason, actorId });
  return { before: current.status, after: t.to };
}
```

```sql
/* updateStatusIfUnchanged : 읽은 상태·버전 그대로일 때만 전이 — 0행이면 충돌 */
UPDATE sales_order
   SET status = :to, version = version + 1, updated_by = :actor_id
 WHERE sales_order_id = :id
   AND status = :current
   AND version = :expected_version;
```

- 먼저 읽는 이유: "현재 상태에서 불가"(INVALID_STATE_TRANSITION)와 "그 사이 누가 바꿈"(CONFLICT)을 사용자에게 구분해 알려주고, 이력에 정확한 전 상태를 남기기 위해서다. **최종 방어는 WHERE 절**이다 (sql.md 8-2절).
- 전이의 부수 작업(알림·연동)은 UPDATE가 1행을 바꾼 뒤에만 — 수단은 domain-event.md 1절.
- 엔드포인트는 행위별 `POST /orders/:id/submit` (api.md 1절 — CRUD로 표현 못 하는 액션). 요청에 `version`을 받는다 (api.md 2절).

### 3-3. 화면 — 서버가 허용 행위를 알려준다

- 상세 응답에 `allowed_actions: ['SUBMIT', 'CANCEL']` — 서버가 **전이표 × 현재 상태 × 사용자 권한**으로 계산한다. 화면은 이 목록으로 버튼을 그린다.
- 화면 숨김은 편의일 뿐이다 — 서버의 3-2절 검사가 진짜 방어다 (auth.md 4-1절 — 화면 게이트는 UX).

### 3-4. 편집 잠금

- "결재 중에는 수정 불가" 같은 규칙도 전이표의 연장이다: 수정 API의 UPDATE에 **편집 가능 상태 조건**(`AND status IN ('DRAFT','REJECTED')`)을 넣는다 — 0행이면 409.
- ⚠ mysql2에서 배열 IN은 **`query`로만** 실행한다 — `execute`(prepared statement)는 배열을 펼치지 않아 **에러 없이 0건**이 된다(실측 2026-10-14: 같은 조건이 `query` 1건 / `execute` 0건). 편집 잠금이 "항상 잠김"으로 오작동한다.

## 4. 함정 (STRICT)

| 함정 | 증상 | 처방 |
|---|---|---|
| 다른 필드 저장의 부수효과로 상태 변경 | 날짜 하나 고쳤는데 상태가 바뀐다 (patterns.md 5절) | 상태는 전이 함수로만. 일반 수정 UPDATE에 `status` 컬럼을 넣지 않는다 |
| `UPDATE … SET status = :to WHERE id = :id` | 동시 요청이 둘 다 성공 — 이중 승인·이중 발송 | 현재 상태·버전 조건 (3-2절) |
| 전이표를 클라이언트에도 복제 | 서버 규칙을 바꿨는데 화면은 옛 버튼을 보여준다 | `allowed_actions` (3-3절) |
| 상태 코드 이름 변경을 코드만 수정 | 기존 데이터의 옛 코드가 어떤 전이에도 안 걸려 문서가 "고아 상태"가 된다 | 상태 코드 변경은 데이터 마이그레이션 동반 (migration.md) |
| 배열 IN을 `execute`로 | 편집 잠금·전이 조건이 조용히 0건 (실측) | `query` 사용 (3-4절) |

## 5. 스택별 구현

| 구성 | Express | Spring |
|---|---|---|
| 전이표 | `Object.freeze` 상수 모듈 | `enum Action { SUBMIT(Set.of(DRAFT, REJECTED), IN_APPROVAL) … }` — 상태도 enum |
| 전이 처리 | 3-2절 함수 (서비스 계층, 트랜잭션 `conn`) | 같은 구조 — `@Transactional` 서비스 메서드, 갱신 0행이면 `ConflictException` |
| 409 응답 | 에러 코드 `INVALID_STATE_TRANSITION` / `CONFLICT` (api.md 5절 봉투) | 동일 |

## 6. 검증 포인트

- 자동화 테스트: 전이표의 모든 행위 × 허용·불허 상태 / 같은 문서 동시 전이 2건 → 1건 성공·1건 409 / 편집 잠금 상태에서 수정 → 409.
- 실동작 검증(/live-test 동시성 축): 두 브라우저에서 같은 문서를 동시에 제출 → 한쪽만 성공, change_log 1건.
