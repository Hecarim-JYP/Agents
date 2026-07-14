# SQL 스타일 가이드 (JYP)

SQL 쿼리를 작성하는 모든 프로젝트에 적용하는 스타일 규칙.
실무에서 검증된 패턴을 범용화한 것으로, 코드 내 쿼리 함수(`*Query.ts` 등)와 마이그레이션 스크립트 모두에 적용한다.

## 1. 공통 원칙

- SQL 키워드(`SELECT`, `FROM`, `LEFT JOIN`, `WHERE`, `ORDER BY`, `INSERT INTO`, `UPDATE`, `SET` 등)는 **대문자**, 각 절은 **독립 줄**로 쓴다.
- 쿼리 첫 줄에 인라인 주석을 단다: `/* 함수명 : 한 줄 설명 */`
- 바인딩 파라미터는 컬럼명과 동일한 이름을 쓴다 (예: `:column_name` — 드라이버의 플레이스홀더 형식이 다르면 그 형식을 따르되 이름 일치 원칙은 유지).
- 테이블에는 항상 별칭(`AS t`)을 부여하고, 컬럼 접근은 별칭을 통해서만 한다.

## 2. SELECT 패턴

```sql
/* functionName : 한 줄 설명 */
SELECT
    t.column_one            AS column_one,
    t.column_two            AS column_two,
    o.other_column          AS other_column
FROM
    main_table AS t
LEFT JOIN
    other_table AS o
    ON t.join_key = o.join_key
    AND t.scope_key = o.scope_key
WHERE
    t.scope_key = :scope_key
    AND t.is_active = 1
ORDER BY
    t.sort_order
    , t.id;
```

- 컬럼 목록: `t.column_name` + **공백 정렬** + `AS column_name` (**별칭 필수** — 짧은 컬럼도 생략하지 않는다).
- JOIN: `LEFT JOIN table AS alias` 다음 줄에 `ON`, 추가 조건은 `AND`로 들여쓰기.
- WHERE 조건: 각 줄 `AND`를 앞에 붙인다 (**leading AND**).
- ORDER BY 다중 컬럼: 두 번째부터 `, column` (**leading comma**).

## 3. INSERT 패턴

```sql
/* functionName : 한 줄 설명 */
INSERT INTO table_name (
    column_one,
    column_two,
    created_by
) VALUES (
    :column_one,
    :column_two,
    :created_by
);
```

- 컬럼 목록과 VALUES 목록은 **1:1 대응, 같은 순서** (컬럼 추가 시 양쪽 모두 — 한쪽 누락은 저장 누락 버그의 단골 원인).
- 닫는 `)` 와 `VALUES (` 는 독립 줄.

## 4. UPDATE 패턴

```sql
/* functionName : 한 줄 설명 */
UPDATE
    table_name
SET
    column_one = :column_one,
    column_two = :column_two,
    updated_by = :updated_by
WHERE
    scope_key = :scope_key
    AND id = :id;
```

- `UPDATE`, `SET`, `WHERE` 각 절 독립 줄, 테이블명은 `UPDATE` 다음 줄 들여쓰기.
- WHERE: **스코프 조건(테넌트/소유자 구분 컬럼)을 최상단**, 이후 PK 조건. WHERE 없는 UPDATE/DELETE 금지.

## 5. 소프트삭제 패턴

삭제가 필요한 테이블은 물리 삭제 대신 `is_active` 플래그를 쓴다:

```sql
/* functionName : 소프트삭제 */
UPDATE
    table_name
SET
    is_active = 0,
    deleted_at = NOW(),
    deleted_by = :deleted_by
WHERE
    scope_key = :scope_key
    AND id = :id
    AND is_active = 1;
```

- 소프트삭제 = `is_active = 0` 마킹 + `deleted_at`/`deleted_by` 기록. `deleted_at`만 쓰지 않는다.
- 조회/수정 쿼리에도 **`is_active = 1` 필터 필수** — 누락하면 삭제된 데이터가 되살아난다.
- `is_active`를 "삭제 플래그"와 "사용자 활성 토글" 등 두 가지 의미로 동시 사용 금지. 별도 개념이 필요하면 별도 컬럼.
- 서비스 계층에서 `affectedRows === 0`이면 이미 삭제/미존재로 처리(NotFound 에러).

## 6. 쿼리 함수 작성 규칙 (코드 내 SQL)

```js
/**
 * functionName : 설명
 * --------------------------------------------
 * @param {*} conn : 데이터베이스 연결 객체
 * @param {*} params : { scope_key, ... }
 * @returns {Promise<...>}
 */
export const functionName = async (conn, params) => {
  const query = `
    /* functionName : 설명 */
    SELECT ...
  `;
  const result = await conn.query(query, params);
  return result;
};
```

- 함수 상단에 doc comment(`@param`/`@returns`) 필수 (컨벤션 general.md 5절과 동일 원칙).
- 템플릿 리터럴 내 SQL 들여쓰기: 함수 본문 기준 **4스페이스** 추가.
- **타입 정규화는 서비스 계층 책임** — 쿼리 함수는 bind 값을 pass-through 한다. 쿼리 함수 내부에서 `String(params.x ?? '')` 같은 인라인 형변환 금지 (근거: 계층 책임이 섞이면 같은 파라미터가 함수마다 다르게 변환되는 불일치 발생).
- 검색어를 LIKE 절에 쓸 때는 와일드카드/인젝션 안전 처리(sanitize 유틸)를 거친다.

## 7. 안전 규칙

- 스코프 컬럼(테넌트/회사/사용자 구분값)은 **서버가 검증한 신뢰값**으로만 바인딩한다 — 클라이언트가 보낸 값을 그대로 쓰지 않는다 (근거: 요청의 테넌트 값을 신뢰하면 타사 데이터 조회가 가능해진다).
- 문자열 연결로 쿼리를 조립하지 않는다. 값은 항상 바인딩 파라미터로.
- 다중 INSERT/UPDATE는 트랜잭션으로 묶고, 실패 시 롤백을 보장한다 (연결 획득 → begin → commit / catch 롤백 / finally release).
- 채번(일련번호 생성)은 트랜잭션 내 재산정 + UNIQUE 제약 + 중복 키 재시도로 경쟁 상태를 방어한다.

## 8. 동시성 제어 (STRICT — 2026-07-14 확정)

트랜잭션은 원자성을 보장하지만 **동시 수정을 막지는 않는다.** 두 사용자가 같은 행을 동시에 고치면 나중에 저장한 쪽이 앞사람의 변경을 조용히 덮어쓴다(잃어버린 갱신). 업무 시스템에서 가장 흔한 데이터 사고이므로 아래 세 가지를 기본 방어선으로 삼는다.

### 8-1. 잃어버린 갱신 — 낙관적 락 (수정 화면의 기본)

여러 사용자가 같은 데이터를 수정할 수 있는 테이블에는 **`version INT NOT NULL DEFAULT 0` 컬럼**을 둔다 (database.md 3절 공통 컬럼).

```sql
/* updateItem : 낙관적 락 — 조회 시점 이후 남이 고쳤으면 0행 */
UPDATE
    example_item
SET
    item_name  = :item_name,
    version    = version + 1,
    updated_by = :updated_by
WHERE
    company_id = :company_id
    AND example_item_id = :example_item_id
    AND version = :version;
```

- 조회 응답에 `version`을 포함해 클라이언트가 그대로 돌려보내고, UPDATE의 WHERE에 넣는다.
- **`affectedRows === 0`이면 충돌**이다 — NotFound가 아니라 **409 Conflict**로 응답하고 "다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 시도하세요"를 안내한다 (5절의 소프트삭제 `affectedRows === 0` = NotFound와 구분한다 — 행 존재 여부를 재조회해 판정).
- 락 대기가 없어 성능 부담이 없고, 화면을 오래 열어두는 업무 시스템에 적합하다.

### 8-2. 상태 전이 — 조건부 UPDATE (이중 실행 방어)

승인·마감·발송처럼 **한 번만 일어나야 하는 상태 전이**는 현재 상태를 WHERE에 넣어 원자적으로 바꾼다 (근거: 승인 버튼 더블클릭·동시 요청이면 상태를 조회 후 UPDATE하는 방식은 둘 다 통과해 이중 승인·이중 발송이 된다).

```sql
/* approveRequest : PENDING일 때만 APPROVED로 — 0행이면 이미 처리됨 */
UPDATE
    ct_request
SET
    status      = 'APPROVED',
    approved_by = :approved_by,
    approved_at = NOW(),
    version     = version + 1
WHERE
    company_id = :company_id
    AND ct_request_id = :ct_request_id
    AND status = 'PENDING';
```

- `affectedRows === 0` = 이미 처리됨 → 409로 응답. 상태 전이의 부수 작업(메일 발송 등)은 **이 UPDATE가 1행을 바꾼 경우에만** 수행한다.
- 서비스가 "조회 → 상태 검사 → UPDATE"로 판단하는 방식은 검사와 갱신 사이의 틈이 열려 있다 — 검사는 하되 **최종 방어는 WHERE 절**이다.

### 8-3. 비관적 락 — `SELECT ... FOR UPDATE` (재고·잔액 등)

읽은 값을 근거로 계산해서 쓰는 경우(재고 차감, 잔액 갱신, 순번 채번)는 낙관적 락으로 부족하다 — **트랜잭션 안에서 `FOR UPDATE`로 행을 잠그고** 읽는다.

```sql
/* getStockForUpdate : 트랜잭션 내에서만 사용 — 커밋/롤백까지 행 잠금 */
SELECT
    s.quantity              AS quantity
FROM
    stock AS s
WHERE
    s.item_id = :item_id
FOR UPDATE;
```

- 반드시 트랜잭션 안에서 쓰고, 잠금 구간을 짧게 유지한다(외부 API 호출·파일 IO를 잠금 구간에 넣지 않는다 — 남의 지연이 우리 DB 잠금 시간이 된다).
- 여러 행을 잠글 때는 **항상 같은 순서**(예: PK 오름차순)로 잠근다 — 순서가 엇갈리면 데드락이 난다.
- 잔액·재고처럼 "현재값 기준 증감"이면 `SET quantity = quantity - :qty WHERE quantity >= :qty`처럼 **DB에서 계산**하는 것이 더 안전하다 (읽고 계산해서 쓰는 왕복 자체를 없앤다).
