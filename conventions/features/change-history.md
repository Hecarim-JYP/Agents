# 레시피: 데이터 변경 이력 `[공통]`

> 확정: 2026-10-14 | 테이블: `schemas/08_change_log.sql` | 짝: state-machine.md(상태 전이 이력), audit_log(보안 행위)
> 업무 데이터가 바뀔 때마다 **누가·언제·무엇을(컬럼 단위 전/후)·왜** 바꿨는지 같은 트랜잭션에서 기록한다. 문서 화면의 "변경 이력" 탭이 이 테이블을 읽는다.

## 1. 언제 쓰나

"이 값 누가 바꿨어요?"라는 질문이 나올 업무 테이블 — 주문·계약·단가·재고 조정·결재 대상 문서. 모든 테이블에 걸지 않는다(로그성·코드성 테이블은 제외). 대상 테이블 목록은 CLAUDE.md에 기록한다.

| 기록할 것 | 저장소 |
|---|---|
| 업무 문서의 생성·수정·삭제·상태 전이 | **change_log (이 레시피)** |
| 로그인·계정 잠금·권한 변경 등 보안·책임 행위 | audit_log (auth.md 5절) — 열람 권한(보안 담당)과 보관 기간이 달라 섞지 않는다 |
| "그 시점의 값"으로 계산해야 하는 데이터(단가·환율·요율) | **유효기간 테이블** (`valid_from`/`valid_to`) — 이력 로그로는 시점 조회가 안 된다 (2절) |

## 2. 결정 항목 (기본값)

| 결정 | 기본값 | 대안 / 비고 |
|---|---|---|
| 기록 방식 | **앱 계층(서비스)이 같은 트랜잭션에서 기록** | DB 트리거는 행위자·요청 ID·사유를 모르고 로직이 숨는다 — 쓰지 않는다 |
| 저장 형식 | **공통 테이블 1개 + 바뀐 컬럼만 JSON** | 테이블별 이력 테이블(전체 행 스냅샷)은 시점 복원이 필요한 경우만 |
| 시점 조회가 필요한 데이터 ⚑ | 유효기간 테이블로 설계 — 시작 시 판단 (되돌리기 어렵다) | 이력에서 시점 값을 역산하는 설계 금지 |
| 값 표현 | **코드·ID 그대로 + 정규화된 문자열** — 화면에서 명칭으로 변환 | 명칭이 바뀌어도 당시 의미를 보존해야 하면 `{"before":"A","before_label":"…"}`로 명칭 동결 |
| 민감 컬럼 | 값을 남기지 않고 `"(변경됨)"`만 | 비밀번호 해시·개인정보 원문을 이력에 복제하면 유출 범위가 늘어난다 |
| 보관 기간 | 업무 문서의 보존 연한과 같게 — CLAUDE.md 기록 | |

## 3. 표준 설계

### 3-1. 흐름

```
수정 요청 (version 포함)
 → 서비스: 현재 행 조회 → 입력과 비교해 바뀐 컬럼만 diff (정규화 후 비교 — 3-2절)
 → 업무 UPDATE (낙관적 락 — sql.md 8-1절)
 → diff가 비어 있지 않으면 change_log INSERT (같은 트랜잭션)
```

- 상태 전이는 `action`에 행위명(SUBMIT·APPROVE …)과 `reason`을 남긴다 (state-machine.md 3-2절).
- `request_id`에 요청 추적 ID를 넣는다 — 이력 한 줄에서 그 요청의 서버 로그로 바로 간다 (request-id.md).
- 배치·시스템 변경은 `acted_by`에 **시스템 계정 ID**(사용자 테이블에 둔 전용 계정)를 쓴다 — NULL로 두면 "누가"가 영원히 비어 보인다.

### 3-2. diff 정규화 — 같은 값을 "바뀜"으로 기록하지 않는다

DB에서 읽은 값과 화면이 보낸 값은 **타입이 다르다** (실측 2026-10-14, mysql2 3.24 + MariaDB 10.11):

| 컬럼 타입 | DB에서 읽은 값 | 화면이 보낸 같은 값 | 그냥 비교하면 |
|---|---|---|---|
| `DECIMAL(15,2)` | 문자열 `"100.00"` | 숫자 `100` | 다름 (거짓 변경) |
| `DATE` | `Date` 객체 | `"2026-10-14"` | 다름 |
| `DATE`를 `JSON.stringify` | **서버가 Asia/Seoul이면 `"2026-10-13T15:00:00.000Z"`** | — | 이력 화면에 **하루 전 날짜**로 보인다 |
| `DATETIME` 09:30을 `JSON.stringify` | `"…T00:30:00.000Z"` | — | 9시간 어긋나 보인다 |

```js
/**
 * 변경 이력용 값 정규화 — 비교와 저장을 모두 "DB에 적힌 그대로의 문자열"로 맞춘다
 * @param {unknown} v DB에서 읽은 값 또는 입력값
 * @param {{ type: 'decimal'|'date'|'datetime'|'string', scale?: number }} col 컬럼 정의 (테이블별 컬럼 정의 상수에서)
 * @returns {string|null} 정규화된 문자열
 */
export function normalizeForHistory(v, { type, scale = 2 }) {
  if (v === null || v === undefined || v === '') return null;
  const pad = (n) => String(n).padStart(2, '0');
  switch (type) {
    case 'decimal': return Number(v).toFixed(scale);                               // 100 / "100.00" → "100.00" (2^53 넘는 금액은 decimal 라이브러리로)
    case 'date':    return v instanceof Date
      ? `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}` : String(v).slice(0, 10);   // 현지 날짜 성분 그대로
    case 'datetime': return v instanceof Date
      ? `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())} ${pad(v.getHours())}:${pad(v.getMinutes())}:${pad(v.getSeconds())}`
      : String(v).replace('T', ' ').slice(0, 19);
    default:        return String(v).trim();
  }
}
```

- 비교 대상 컬럼은 테이블별 **컬럼 정의 상수**(컬럼명 → 타입, 민감 여부)로 고정한다 — `updated_at`·`updated_by`·`version` 같은 공통 컬럼은 제외.
- 드라이버 옵션 `dateStrings: true`로 날짜를 처음부터 문자열로 받는 방법도 있다 — 앱 전체의 날짜 처리가 바뀌므로 프로젝트 시작 시 결정할 일이다(도중에 바꾸지 않는다).

## 4. 함정 (STRICT)

| 함정 | 증상 | 처방 |
|---|---|---|
| 정규화 없이 비교 | 아무것도 안 바꿔도 금액·날짜가 "변경됨"으로 쌓인다 (실측: `"100.00"` ≠ `100`) | 3-2절 (실측: `TZ=Asia/Seoul`에서 DECIMAL·DATE·DATETIME 모두 DB 값과 입력값이 같은 문자열로 정규화됨) |
| `Date`를 `JSON.stringify`로 저장 | 이력에 하루 전 날짜·9시간 어긋난 시각 (실측) | 현지 성분으로 문자열화 |
| 업무 변경과 다른 트랜잭션(또는 커밋 후 이벤트)으로 기록 | 업무는 바뀌었는데 이력이 없는(또는 반대) 행 — 이력을 믿을 수 없게 된다 | 같은 트랜잭션 (domain-event.md 1절 — "함께 성공·실패해야 하는" 후속 처리) |
| 빈 diff도 기록 | 저장 버튼만 눌러도 이력이 쌓여 진짜 변경이 묻힌다 | diff가 비면 기록하지 않는다 |
| 민감 값 원문 기록 | 이력 테이블이 개인정보 사본이 된다 | `"(변경됨)"`만 |
| 이력으로 시점 값 역산 | 단가 적용 시점 계산이 이력 재생에 의존 — 느리고 틀리기 쉽다 | 유효기간 테이블 (2절 ⚑) |

## 5. 스택별 구현

| 구성 | Express | Spring |
|---|---|---|
| diff | 3-2절 `normalizeForHistory` + 컬럼 정의 상수 | 같은 구조 — `LocalDate`/`BigDecimal`은 `toString()`이 이미 정규형이라 날짜·소수 함정이 작다(`BigDecimal`은 `stripTrailingZeros` 대신 스케일 고정 `setScale`로 비교) |
| 기록 | `insertChangeLog(conn, …)` 쿼리 함수 — 서비스 트랜잭션의 `conn` | `ChangeLogRepository.insert()` — `@Transactional` 서비스 안에서 |
| JSON 저장 | `JSON.stringify(changes)` (값은 이미 문자열) | Jackson으로 직렬화 |

## 6. 검증 포인트

- 자동화 테스트(테스트 DB): 같은 값 저장 → 이력 0건 / 금액·날짜 변경 → 정확한 전·후 문자열 / 업무 UPDATE가 충돌로 롤백되면 이력도 없다 / Asia/Seoul 환경(`TZ=Asia/Seoul`)에서 날짜가 하루 밀리지 않는다.
- 실동작 검증(/live-test DB 축): 화면에서 한 필드만 수정 → change_log에 그 컬럼만, 화면 이력 탭에 같은 날짜로 표시.
