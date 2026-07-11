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
