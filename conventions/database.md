# 데이터베이스 컨벤션 (JYP)

스키마 설계와 DB 운영 표준. 쿼리 작성 스타일은 `sql.md`, 변경 관리는 `migration.md`, 컨테이너 운영은 `docker.md`를 따른다.

## 1. 기본

- 표준 DB: **MariaDB/MySQL**. 다른 DB를 채택할 경우 프로젝트 시작 시 결정하고 CLAUDE.md에 기록한다 (이 문서의 원칙은 동일 적용).
- **기초 테이블은 표준 스키마(`~/.claude/jyp/schemas/`)로 시작한다**: schema_migrations, 인증·권한(user/role/permission/login_history), 공통코드, 파일 메타, 감사 로그 — 새로 설계하지 말고 이 DDL을 프로젝트 첫 마이그레이션으로 복사·조정한다.
- 운영은 Docker 컨테이너 + named volume (docker.md 4절), 백업·복구 절차는 ops.md 6절.
- 문자셋·정렬: **`utf8mb4` / `utf8mb4_unicode_ci` 고정** (근거: utf8은 이모지·일부 한자에서 깨진다).
- 시간대: 서버·DB·앱의 시간대를 하나로 통일하고(기본 `Asia/Seoul`) CLAUDE.md에 기록 — 저장은 `DATETIME`, 변환은 앱 계층에서.

## 2. 네이밍

| 대상 | 규칙 | 예시 |
|---|---|---|
| 테이블 | snake_case 단수형, 도메인 접두사 허용 | `ct_request`, `user_custom_setting` |
| 컬럼 | snake_case | `request_no`, `created_at` |
| PK | **`{테이블명}_id`** (전체 테이블명 + `_id`) | `ct_request_id`, `preservative_test_item_id` |
| FK 컬럼 | 참조 테이블의 PK 컬럼명 그대로 | 자식 테이블에 `ct_request_id` |
| 인덱스 | `idx_{테이블}_{컬럼}`, 유니크는 `uq_` 접두사 | `idx_ct_request_status`, `uq_ct_request_no` |
| FK 제약 | `fk_{테이블}_{참조테이블}` | `fk_user_role`, `fk_role_permission_role` |

## 3. 공통 컬럼 (모든 업무 테이블 필수)

```sql
created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
created_by   BIGINT,
updated_at   DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
updated_by   BIGINT,
```

- 소프트삭제 대상 테이블은 추가로: `is_active TINYINT(1) NOT NULL DEFAULT 1`, `deleted_at`, `deleted_by` (규칙: sql.md 5절).
- 멀티테넌트 프로젝트는 스코프 컬럼(`company_id` 등)을 모든 업무 테이블에 두고, 조회 인덱스의 선두 컬럼으로 삼는다.

## 4. 타입 규칙

- **금액·정밀 수치는 `DECIMAL`** — `FLOAT`/`DOUBLE` 금지 (근거: 부동소수점 오차로 합계가 안 맞는 버그).
- 불리언: `TINYINT(1)` 0/1.
- ID: `BIGINT UNSIGNED AUTO_INCREMENT` (드라이버 BigInt 직렬화 주의: express.md 7절).
- 상태·구분값: 매직 넘버 금지 — 코드 문자열 또는 공통코드 테이블 FK로. 의미는 스키마나 CLAUDE.md에 문서화.
- 날짜만 필요하면 `DATE`, 시각 포함은 `DATETIME`. 문자열로 날짜 저장 금지.

## 5. 인덱스·제약 (STRICT)

- WHERE/JOIN에 반복 사용되는 컬럼에 인덱스를 건다. 멀티테넌트는 `(scope_key, ...)` 복합 인덱스의 선두에 스코프 컬럼.
- **유일성은 DB의 UNIQUE 제약으로 보장한다** — 앱 검증만으로는 동시 요청 경쟁에서 뚫린다 (채번 규칙과 연계: sql.md 7절).
- FK 제약은 걸되 `ON DELETE`는 **RESTRICT 기본**. CASCADE는 소프트삭제 체계와 충돌하므로 금지에 가깝게 신중히.
- 대량 테이블의 인덱스 추가·컬럼 변경 마이그레이션은 테이블 잠금 시간을 확인하고 배포 시간대를 조정한다.

## 6. 커넥션·운영

- 커넥션은 **풀(pool)로만** 사용하고, 풀 크기·타임아웃은 설정값으로 분리한다.
- 트랜잭션 커넥션 관리는 express.md 4절 (서비스 소유, 쿼리 함수는 conn pass-through).
- 운영 DB는 슬로우 쿼리 로그를 활성화하고, 배포 후 정기적으로 확인한다 (성능 문제의 조기 발견).
- canonical DDL 파일(테이블 원본 정의)을 저장소에 유지하고 마이그레이션과 동기화한다 (migration.md 5절).
- 운영 DB에 수동 쿼리로 데이터를 직접 수정하지 않는다 — 불가피하면 실행 전 백업 + 실행 쿼리를 changelog에 기록.

## 7. 테이블 생성 규칙 (DDL, STRICT)

- 테이블 생성·변경은 **반드시 마이그레이션 파일로** 한다 (migration.md) — DB 툴에서 즉석 CREATE 금지. 기초 테이블은 표준 스키마(1절) 복사로 시작.
- **모든 CREATE TABLE에 명시**: `IF NOT EXISTS`(멱등) + `ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`.
- **PK 없는 테이블 금지** — `{테이블명}_id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY`.
- 코드값·구분값 컬럼에는 인라인 주석으로 의미를 남긴다 (예: `-- '{module}.{action}' 형식`).

```sql
CREATE TABLE IF NOT EXISTS example_item (
    example_item_id  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    example_id       BIGINT UNSIGNED NOT NULL,        -- 부모 FK
    item_name        VARCHAR(100) NOT NULL,
    status           VARCHAR(20)  NOT NULL DEFAULT 'PENDING',  -- common_code: ITEM_STATUS
    sort_order       INT NOT NULL DEFAULT 0,
    is_active        TINYINT(1) NOT NULL DEFAULT 1,
    created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by       BIGINT,
    updated_at       DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
    updated_by       BIGINT,
    UNIQUE KEY uq_example_item_name (example_id, item_name),
    KEY idx_example_item_example_id (example_id, is_active),
    CONSTRAINT fk_example_item_example FOREIGN KEY (example_id) REFERENCES example (example_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- 포맷: 컬럼명 + **공백 정렬** + 타입 (sql.md SELECT 컬럼 정렬과 동일 원칙). 순서 = PK → FK → 업무 컬럼 → 상태/플래그 → 공통 컬럼(3절), 제약(UNIQUE/KEY/CONSTRAINT)은 컬럼 뒤에 모아서.
- 작성 스타일의 살아있는 레퍼런스 = 표준 스키마(`~/.claude/jyp/schemas/*.sql`).
