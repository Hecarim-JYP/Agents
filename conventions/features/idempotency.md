# 레시피: 중복 제출 방지 (멱등 키) `[공통]`

> 확정: 2026-10-14 | 관련: sql.md 8-2절(상태 전이 중복), outbox.md(우리가 보내는 쪽의 멱등 키)
> 같은 "생성" 요청이 두 번 들어와도 한 건만 만들어지게 한다. 클라이언트가 요청마다 멱등 키를 붙이고, 서버는 그 키를 UNIQUE로 저장해 두 번째 요청에는 **처음 결과를 돌려준다**.

## 1. 언제 쓰나

- 생성 요청(POST)은 생각보다 자주 두 번 들어온다: 더블클릭, 응답이 늦어 다시 누름, 네트워크 재전송, 새로고침으로 폼 재제출, 두 탭에서 동시 제출.
- **상태 전이**(승인·마감·발송)의 이중 실행은 이미 조건부 UPDATE가 막는다 (sql.md 8-2절) — 이 레시피는 **새 행을 만드는 요청**의 중복을 다룬다.
- 외부 시스템이 우리 API로 쓰기를 보내는 경우(우리가 수신 측)도 같은 구조로 받는다 — outbox.md의 `message_key`가 상대 쪽에서 오는 것이다.

## 2. 결정 항목 (기본값)

방어는 세 층이고, 생성 요청의 중요도로 어디까지 쓸지 정한다:

| 층 | 수단 | 적용 |
|---|---|---|
| (a) 화면 | 제출 중 버튼 잠금 | **모든 제출 버튼** — 단, UX일 뿐 방어가 아니다 (재전송·두 탭·새로고침은 못 막는다) |
| (b) 업무 자연키 | 업무상 유일해야 하는 값에 UNIQUE (예: 같은 거래처의 같은 발주번호) | 자연키가 있으면 이것으로 충분 (database.md 5절) |
| (c) 멱등 키 | `Idempotency-Key` 헤더 + 업무 테이블 UNIQUE 컬럼 | **자연키가 없는 중요 생성** — 금액·재고를 움직이거나, 외부 발송·결재를 일으키는 생성 |

- (c)를 적용할 테이블과 엔드포인트는 CLAUDE.md에 기록한다.
- 대외 공개 API처럼 응답 원문 재생·요청 내용 일치 검사까지 필요하면 별도 멱등 기록 테이블 방식이 맞다 — 대외 카탈로그 항목(공개 API)에서 다룬다.

## 3. 표준 설계

### 3-1. 스키마 — 업무 테이블에 컬럼 하나

```sql
-- (c)를 적용하는 업무 테이블에만 추가한다
idempotency_key  VARCHAR(64) COLLATE utf8mb4_bin NULL,   -- 대소문자 구분 (database.md 1절 — 외부 키는 bin)
UNIQUE KEY uq_{테이블}_idempotency_key (idempotency_key)
```

- NULL은 UNIQUE에서 중복이 허용된다(실측) — 키 없이 만든 기존 행·배치 생성 행과 공존한다.
- 업무 행과 키가 **같은 INSERT**에 들어가므로 별도 테이블 없이 원자성이 보장된다.

### 3-2. 계약 (api.md 보강)

| 상황 | 응답 |
|---|---|
| 처음 받은 키 | 정상 처리 → **201** + `{ data }` |
| 이미 처리된 키, 같은 사용자 | 새로 만들지 않고 기존 행을 **200** + `{ data }` — 클라이언트는 성공으로 처리 |
| 이미 처리된 키, 다른 사용자 | **409** `IDEMPOTENCY_KEY_CONFLICT` — 남의 키로 남의 데이터를 조회하는 것을 막는다 |
| 키 형식 위반 (영숫자·하이픈 64자 초과 등) | 400 |

- 검증 실패(400) 등으로 롤백된 요청은 키가 저장되지 않는다 — 사용자가 입력을 고쳐 **같은 키로 다시 제출해도 정상 처리**된다.

### 3-3. 클라이언트

- 키는 **폼을 열 때 한 번** 만든다. 같은 폼의 재시도는 같은 키를 보낸다. 성공 후 폼을 닫으면 다음 폼은 새 키다.
- ⚠ `crypto.randomUUID()`는 **HTTPS·localhost에서만 존재한다** — 사내망 HTTP 주소(`http://10.x.x.x`)에서는 `undefined`다(실측: Chromium, `isSecureContext=false`). 사내 표준이 HTTP 전제이므로(프로필 — 도메인 미확보) 아래 유틸을 쓴다.

```js
/**
 * 멱등 키 생성 — HTTPS면 randomUUID, HTTP 사내망이면 getRandomValues로 같은 형식(UUID v4)을 만든다
 * @returns {string} UUID v4 문자열
 */
export function newIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();       // 보안 컨텍스트에서만 존재
  const b = crypto.getRandomValues(new Uint8Array(16));                 // 비보안 컨텍스트에서도 동작
  b[6] = (b[6] & 0x0f) | 0x40;                                          // 버전 4
  b[8] = (b[8] & 0x3f) | 0x80;                                          // RFC 4122 변형
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
```

```jsx
// 폼 컴포넌트 — 키는 렌더링마다가 아니라 폼 수명 동안 하나 (useRef)
const idemKeyRef = useRef(newIdempotencyKey());
const [submitting, setSubmitting] = useState(false);

async function handleSubmit(values) {
  if (submitting) return;                     // (a) 화면 잠금 — 더블클릭 1차 방어
  setSubmitting(true);
  try {
    await api.post('/orders', values, { headers: { 'Idempotency-Key': idemKeyRef.current } });
    onClose();                                // 성공(201이든 200 재생이든) → 폼 종료
  } finally {
    setSubmitting(false);
  }
}
```

### 3-4. 서버

```js
/**
 * 주문 생성 — 같은 멱등 키의 재요청이면 새로 만들지 않고 처음 결과를 돌려준다
 * @param {object} input 검증된 입력 (zod — express.md 3절)
 * @param {{ userId: number }} actor 서버 신뢰값 (express.md 5절)
 * @param {string|null} idemKey Idempotency-Key 헤더 값 (형식 검증 완료)
 * @returns {Promise<{ created: boolean, order: object }>} 컨트롤러가 created ? 201 : 200
 */
async function createOrder(input, actor, idemKey) {
  try {
    const order = await insertOrderInTransaction(input, actor, idemKey);   // 업무 INSERT에 idempotency_key 포함
    return { created: true, order };
  } catch (err) {
    // 멱등 키 위반만 재생으로 처리한다 — 채번 등 다른 UNIQUE 위반도 같은 ER_DUP_ENTRY라 키 이름으로 가른다
    if (!idemKey || err.code !== 'ER_DUP_ENTRY' || !err.sqlMessage.includes('uq_sales_order_idempotency_key')) throw err;
    const existing = await findOrderByIdempotencyKey(idemKey);             // 롤백 후 새 조회
    if (existing.created_by !== actor.userId) throw new ConflictError('IDEMPOTENCY_KEY_CONFLICT');
    return { created: false, order: existing };
  }
}
```

- 중복 판정은 **INSERT의 UNIQUE 위반으로** 한다. "먼저 SELECT로 있는지 보고 INSERT"는 동시 요청 둘 다 통과한다 (database.md 5절).

## 4. 함정 (STRICT)

| 함정 | 증상 | 처방 |
|---|---|---|
| 버튼 잠금만 믿음 | 새로고침 재제출·두 탭·네트워크 재전송으로 중복 생성 | 중요 생성은 (b) 또는 (c) |
| 키를 **제출할 때마다** 새로 생성 | 재시도마다 키가 달라 아무것도 막지 못한다 | 폼 수명 동안 하나 (`useRef`) |
| HTTP 사내망에서 `crypto.randomUUID()` 직접 호출 | `TypeError: crypto.randomUUID is not a function` — **운영(HTTP)에서만** 제출이 전부 실패한다(개발은 localhost라 통과) | 3-3절 유틸 |
| SELECT 후 INSERT로 중복 검사 | 동시 요청 경쟁에서 둘 다 통과 | UNIQUE 위반으로 판정 |
| 모든 `ER_DUP_ENTRY`를 재생으로 처리 | 채번 충돌 같은 다른 UNIQUE 위반이 "성공"으로 둔갑한다 (실측: 둘 다 `ER_DUP_ENTRY`, 메시지의 키 이름만 다르다) | 키 이름으로 구분 (MySQL 8은 `테이블.키이름`, MariaDB는 `키이름` — `includes`로 양쪽 대응) |
| 재생 시 소유자 확인 생략 | 남의 키를 알면 남의 데이터를 받아본다 | 다른 사용자면 409 |
| 키 값을 검증 없이 저장·로깅 | 로그 인젝션, 컬럼 길이 초과 500 | 형식 검증(영숫자·하이픈, 64자) 후 사용 |

## 5. 스택별 구현

| 구성 | Express | Spring |
|---|---|---|
| 헤더 읽기·형식 검증 | 컨트롤러에서 `req.get('Idempotency-Key')` → zod 스키마 | `@RequestHeader(value = "Idempotency-Key", required = false)` + `@Pattern` |
| 중복 감지 | `err.code === 'ER_DUP_ENTRY'` + 키 이름 | `DuplicateKeyException` + 메시지의 키 이름 |
| 재생 응답 | `res.status(created ? 201 : 200).json({ data })` | `ResponseEntity.status(created ? CREATED : OK)` |
| 클라이언트 | 3-3절 (React 공용) | 동일 |

## 6. 검증 포인트

- 자동화 테스트(테스트 DB): 같은 키 동시 2요청 → 행 1개, 응답 201 + 200 / 다른 사용자의 같은 키 → 409 / 400으로 실패한 키의 재제출 → 201 / 채번 충돌은 재생이 아니라 에러.
- 실동작 검증(/live-test 동시성 축): 실제 화면 더블클릭·두 탭 동시 제출 → DB 행 1개. **HTTP 주소(운영과 같은 조건)로 접속해서** 제출이 되는지 확인한다.
