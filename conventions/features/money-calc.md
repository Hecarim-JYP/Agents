# 레시피: 금액·세액 계산 — 반올림·부가세·소수 `[공통]`

> 확정: 2026-10-20 | 원칙: database.md(컬럼 타입), change-history.md 3-2절(DECIMAL 값 정규화), api.md 5절(응답 봉투) | 짝: payment.md(결제 금액 대조), excel-download.md(숫자 셀)
> 원 단위 금액은 **정수**로 계산·저장하고, 소수가 필요한 값(단가·환율·원가)은 **DECIMAL + 십진 연산**(Java `BigDecimal`, JS `decimal.js`)으로만 다룬다. `0.1 + 0.2`·`v / 1.1` 같은 **부동소수점 계산을 금액에 쓰지 않는다**. 원 미만을 어떻게 처리할지와 세액을 **줄마다 낼지 합계에서 낼지**는 법이 정하지 않는다 — 회계팀과 정해 CLAUDE.md에 기록하고 한 함수로만 계산한다.

## 1. 언제 쓰나

주문·견적·거래명세서·세금계산서 금액, 단가 × 수량, 할인·포인트 배분, 원가·환율 환산, 정산 합계. 화면 표시용 포맷도 포함한다.

### 1-1. 법정 요건 (원문 확인 2026-10-20 — legalize-kr: 법제처 데이터를 옮긴 공개 저장소, 부가가치세법 2026-01-01 시행본)

| 항목 | 내용 | 근거 |
|---|---|---|
| 세율 | **10퍼센트** | 부가가치세법 제30조 |
| 포함 여부가 분명하지 않은 대가 | 받은 금액에 **110분의 100을 곱한 금액**을 공급가액으로 | 같은 법 제29조 ⑦ |
| 세금계산서 기재 | 공급하는 사업자 등록번호·성명(명칭), 공급받는 자 등록번호, **공급가액과 부가가치세액**, 작성 연월일 등 | 같은 법 제32조 ① |
| 원 미만 끝수 | 부가가치세법·시행령·시행규칙에 **원 미만 처리 규정이 없다**(원문 검색 2026-10-20: "끝수"·"원 미만"·"절사"·"반올림" 해당 조문 없음) | → 회사 회계 정책으로 정한다 (2절) |

- 세율·기재 사항은 개정될 수 있다 — 세금계산서 기능 착수 시 현행 원문과 국세청 전자세금계산서 규격을 확인한다 (MANDATORY).

## 2. 결정 항목 (기본값)

| 결정 | 기본값 | 대안 / 비고 |
|---|---|---|
| 원 단위 금액 컬럼 | **`BIGINT`**(원) | 소수가 있는 금액(외화·원가)만 `DECIMAL(p, s)` — `DOUBLE`·`FLOAT` 금지 |
| 소수 값 연산 | Java **`BigDecimal`**(문자열·`valueOf`로 생성) / JS **`decimal.js`**(문자열로 생성) | JS에서 원 단위 정수만 다루면 `Number` 정수 연산으로 충분 (2^53 미만) |
| 원 미만 처리 | 회계팀 결정 — **기본 제안: 세액 원 미만 절사** | 반올림을 쓰면 `HALF_UP`/`ROUND_HALF_UP`으로 명시 — 기본 반올림 방식이 언어·DB 타입마다 다르다(3-3절) |
| 세액 계산 단위 | **합계 공급가액에서 한 번** | 줄별 세액이 필요한 문서(거래명세서 줄별 표기)는 줄별 절사 후 **마지막 줄에서 차액 조정** — 줄 합과 합계가 어긋나지 않게 |
| 부가세 포함가 → 공급가액 | **정수 연산** `floor(대가 × 10 / 11)`, 세액 = **대가 − 공급가액** | 소수 `대가 / 1.1` 금지 (4절) |
| 배분(할인·포인트를 줄에 나눔) | 비율대로 절사 배분 후 **나머지를 마지막(또는 가장 큰) 줄에** | 합계가 원래 금액과 같은지 단언 |
| 화면 표시 | `Intl.NumberFormat('ko-KR')` — **계산이 끝난 정수만** 넘긴다 | 통화 포맷은 소수를 반올림해 보여준다(3-3절) — 저장값과 다른 숫자가 화면에 나온다 |

## 3. 표준 설계

### 3-1. 부가세 계산 — 한 모듈에서만

```js
/*
 * 파일명 : vat.js
 * 용도 : 부가세 계산 — 공급가액·세액·합계를 정수(원)로만 계산한다 (회계 정책: 세액 원 미만 절사 — CLAUDE.md)
 * 최초등록 : YYYY-MM-DD [박진영]
 */

/** 공급가액(원) → 세액·합계 — 세율 10% (부가가치세법 제30조) */
export function vatFromSupply(supply) {
  if (!Number.isSafeInteger(supply)) throw new TypeError('공급가액은 원 단위 정수');
  const vat = Math.floor(supply / 10);            // 정수 ÷ 10 — 소수 곱셈(× 0.1)을 쓰지 않는다
  return { supply, vat, total: supply + vat };
}

/** 부가세 포함 금액(원) → 공급가액·세액 — 110분의 100 (같은 법 제29조 ⑦), 세액은 차액이라 합이 항상 맞다 */
export function vatFromTotal(total) {
  if (!Number.isSafeInteger(total)) throw new TypeError('합계는 원 단위 정수');
  const supply = Math.floor((total * 10) / 11);   // v / 1.1 금지 — 5% 넘게 1원씩 틀린다 (3-2절)
  return { supply, vat: total - supply, total };
}

/** 줄별 세액 — 줄마다 절사하고 차액은 마지막 줄에서 맞춘다 (줄 합 = 합계 세액) */
export function vatByLines(lineSupplies) {
  const totalVat = Math.floor(lineSupplies.reduce((s, v) => s + v, 0) / 10);
  const vats = lineSupplies.map((v) => Math.floor(v / 10));
  vats[vats.length - 1] += totalVat - vats.reduce((s, v) => s + v, 0);
  return vats;
}
```

- 실측 2026-10-20 (위 코드 그대로, Node 24.22): `vatFromTotal(33)` = 공급가액 30·세액 3 / 1~1,000,000원 전 구간 `supply + vat === total` / 무작위 주문 10만 건 모두 `vatByLines` 합 = 합계 세액 / 소수 입력은 `TypeError`.
- 소수 단가가 있으면 같은 구조를 `decimal.js`로 — 생성은 항상 문자열(`new Decimal('12.345')`), 반올림은 `toDecimalPlaces(0, Decimal.ROUND_DOWN)`처럼 방식을 적는다.
- DB에서 읽은 `DECIMAL`은 문자열로 온다(3-3절) — 저장소 계층에서 `Number()`(원 정수 컬럼) 또는 `new Decimal()`(소수 컬럼)로 바꾼 뒤 서비스로 올린다.

### 3-2. 실측 — 계산 (2026-10-20, Node 24.22 · Java 25)

| 계산 | 결과 |
|---|---|
| `0.1 + 0.2` | `0.30000000000000004` |
| `(1.005).toFixed(2)` · `(1.255).toFixed(2)` | **`1.00`** · **`1.25`** (반올림이 아니다 — 이진수 오차) |
| `19.99 * 100` | `1998.9999999999998` |
| `Math.round(2.5)` · `Math.round(-2.5)` | `3` · **`-2`** (음수는 0 쪽으로) |
| 부가세 포함 1~1,000,000원 → 공급가액: `Math.floor(v / 1.1)` vs 정수 `floor(v × 10 / 11)` | **51,587건(5.2%) 다르다** — 예: 33원 → `29` vs `30`. Java `double`도 같은 51,587건 |
| 무작위 주문 10만 건(1~5줄, 단가 1,000~100,000원, 수량 1~10): 줄별 세액 절사 합 vs 합계 세액 절사 | **47,947건(47.9%) 다르다**, 최대 4원 |
| `decimal.js` 10.6 `'1.005'` 소수 2자리 `ROUND_HALF_UP` · `'0.1' + '0.2'` · `10999 × 100 ÷ 110` 절사 | `1.01` · `0.3` · `9999` |
| Java `new BigDecimal(0.1)` | `0.1000000000000000055511151231257827021181583404541015625` — `BigDecimal.valueOf(0.1)`·`new BigDecimal("0.1")`은 `0.1` |
| Java `2.5` → `HALF_UP` / `HALF_EVEN` / `DOWN` · `-2.5` → `HALF_UP` / `FLOOR` / `DOWN` | `3` / **`2`** / `2` · `-3` / `-3` / `-2` |
| Java `new BigDecimal("1.0").equals(new BigDecimal("1.00"))` · `compareTo` | **`false`** · `0` |
| Java `BigDecimal("10").divide(BigDecimal("3"))` (자릿수 미지정) | **`ArithmeticException`** — Non-terminating decimal expansion |

### 3-3. 실측 — 저장·전달·표시 (MariaDB 11.4.13 · MySQL 8.4.11 같은 결과, mysql2 3.24.6, Jackson 3)

| 대상 | 결과 |
|---|---|
| mysql2 기본: `DECIMAL(15,2)` 100.00 | **문자열 `"100.00"`** → `rows.reduce((s, r) => s + r.amount, 0)` = **`"0100.00200.50"`**(문자열 이어 붙이기) |
| mysql2 `decimalNumbers: true` | 숫자 `100` — 단 `DECIMAL(20,0)` 9007199254740993 → **9007199254740992**(정밀도 손실) |
| mysql2 `BIGINT` 12000 / 9007199254740993 | 숫자 `12000` / **9007199254740992** — `supportBigNumbers: true`면 큰 값만 문자열 `"9007199254740993"` |
| DB `ROUND(2.5)` · `ROUND(-2.5)` (정확값 DECIMAL) | `3` · `-3` (0에서 먼 쪽) |
| DB `ROUND(2.5e0)` · `ROUND(3.5e0)` (근사값 DOUBLE) | **`2`** · `4` (짝수 쪽) — 같은 `ROUND`가 타입에 따라 다르다 |
| DB `ROUND(1.005, 2)` vs `ROUND(1.005e0, 2)` · `TRUNCATE(1.009, 2)` | `1.01` vs **`1`** · `1.00` |
| DB `10999 * 100 / 110` | `9999.0909` (DECIMAL 나눗셈은 소수 4자리) |
| Jackson 3 `BigDecimal("1000").stripTrailingZeros()` 직렬화 | **`1E+3`** — `StreamWriteFeature.WRITE_BIGDECIMAL_AS_PLAIN`을 켜면 `1000` |
| Jackson 3 JSON `1000.50`을 `Map`으로 | **`Double`** — DTO의 `BigDecimal` 필드나 `USE_BIG_DECIMAL_FOR_FLOATS`면 `1000.50` 그대로 |
| `Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW' })` 12000.5 | **`₩12,001`** — 표시가 반올림된다 |

## 4. 함정 (STRICT)

| 함정 | 증상 | 처방 |
|---|---|---|
| **부가세 포함가를 `/ 1.1`로 역산** | 공급가액이 1원씩 틀린다 — **5.2%** (실측: 33원 → 29) | 정수 `× 10 / 11` (3-1절) |
| 줄별 세액 합과 합계 세액을 각각 계산 | 거래명세서 줄 합계와 세금계산서 세액이 **절반 가까이 1~4원 어긋난다** (실측 47.9%) | 계산 단위 하나 + 차액 조정 (3-1절 `vatByLines`) |
| `toFixed`로 반올림 | `1.005` → `1.00` (실측) | 정수 원 계산, 소수는 `decimal.js` |
| mysql2 `DECIMAL`을 숫자로 가정 | 합계가 **문자열 이어 붙이기**가 된다 (실측) | 저장소에서 변환 — 원 정수 컬럼은 `BIGINT` |
| `decimalNumbers`·`BIGINT`로 큰 값 | 2^53 넘으면 조용히 값이 바뀐다 (실측) | 원 금액은 범위 안이라 안전 — 그 밖의 큰 식별자·수량은 `supportBigNumbers` |
| `new BigDecimal(double)` | 이진 오차가 그대로 들어온다 (실측) | `BigDecimal.valueOf` 또는 문자열 |
| `BigDecimal.equals` 비교 | `1.0`과 `1.00`이 다르다 (실측) — 금액 대조가 틀린다 | `compareTo == 0` |
| 자릿수 없이 `divide` | 나누어떨어지지 않으면 **예외** (실측) | `divide(x, scale, RoundingMode)` |
| 반올림 방식을 기본값에 맡김 | `Math.round(-2.5) = -2`, `HALF_EVEN`·DB DOUBLE `ROUND`는 짝수 쪽 (실측) — 스택마다 결과가 다르다 | 방식을 코드에 명시, 한 함수에서만 |
| 금액 컬럼 `DOUBLE`·`FLOAT` | DB `ROUND`가 짝수 쪽으로, `ROUND(1.005e0, 2) = 1` (실측) | `BIGINT`·`DECIMAL` |
| 응답 JSON에 `stripTrailingZeros()` 값 | 화면이 `1E+3`을 받는다 (실측) | 쓰지 않거나 `WRITE_BIGDECIMAL_AS_PLAIN` |
| 요청 금액을 `Map`으로 받기 | `Double`로 바뀐다 (실측) | DTO + `BigDecimal` 필드 |
| 표시 포맷에 계산 전 값 | 화면 `₩12,001`, 저장 12000.5 (실측) | 계산·반올림을 끝낸 정수만 포맷 |
| 화면(프론트)에서 금액 계산 | 서버와 반올림이 달라 결제·대조 금액 불일치 | 금액은 서버가 계산해 내려준다 (payment.md — 결제창 금액 대조) |

## 5. 스택별 구현

| 구성 | Express | Spring |
|---|---|---|
| 원 단위 | `Number` 정수 + `Number.isSafeInteger` 검사 (3-1절) | `long` 또는 `BigDecimal`(scale 0) |
| 소수 | `decimal.js` (문자열 생성, 반올림 방식 명시) | `BigDecimal.valueOf`/문자열, `setScale(n, RoundingMode.DOWN)` 등 명시 |
| 부가세 | `vat.js` 한 모듈 (3-1절) | `VatCalculator` 한 클래스 — 3-2절 표의 값을 테스트로 |
| DB 값 변환 | 저장소에서 `Number(row.amount)`(BIGINT는 이미 숫자) / `new Decimal(row.unit_price)` | `ResultSet.getBigDecimal` / JPA `BigDecimal` 필드 |
| JSON | 숫자(원 정수) | DTO `BigDecimal` 필드, `stripTrailingZeros` 금지 또는 `WRITE_BIGDECIMAL_AS_PLAIN` |
| 표시 | `Intl.NumberFormat('ko-KR')` | 프론트에서 동일 |

## 6. 검증 포인트

- 자동화 테스트: `vatFromTotal(33)` = 공급가액 30·세액 3 / 1~1,000,000 전 구간에서 `supply + vat === total` / `vatByLines` 합 = 합계 세액 / 배분 합 = 원래 금액 / DB 왕복(저장 → 조회 → 합계)이 숫자 합계다.
- 회계팀 확인: 원 미만 처리·세액 계산 단위·배분 규칙을 CLAUDE.md에 기록하고, 세금계산서 발행 화면 금액이 회계 시스템과 같은지 샘플 10건 대조.
