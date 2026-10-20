# 레시피: 공휴일·대체공휴일·영업일 `[공통]`

> 확정: 2026-10-20 | 테이블: `schemas/28_holiday.sql` | 짝: privacy-rights.md 3-2절(달력일 기한), payment.md 3-5절(영업일 기한), batch.md(확정 감시)
> 공휴일은 **한 테이블**에 두고, 기한·영업일 계산은 모두 그 목록만 읽는다. 양력 공휴일·**음력 공휴일·대체공휴일은 규칙으로 생성**하고, 선거일·임시공휴일은 관리자가 등록한 뒤 **정부 발표와 대조해 연도 단위로 확정**한다. 기억이나 오래된 목록으로 하드코딩하지 않는다 — 2026년에만 노동절·제헌절이 공휴일이 되고 대체공휴일 범위가 넓어졌다.

## 1. 언제 쓰나

기한 계산(열람등요구 10일·환급 3영업일), 근태·급여(유급휴일), 배송·출고 예정일, 결재 SLA, 공휴일에 돌지 않는 배치. 사내 시스템도 해당한다 — 민간 기업의 유급휴일이 관공서 공휴일과 같다(1-1절).

### 1-1. 법정 요건 (원문 확인 2026-10-20 — legalize-kr: 법제처 데이터를 옮긴 공개 저장소)

| 항목 | 내용 | 근거 |
|---|---|---|
| 공휴일 | 국경일(3·1절·**제헌절**·광복절·개천절·한글날), 1월 1일, 설날 전날·당일·다음 날(음력 12월 말일·1월 1·2일), 부처님 오신 날(음력 4월 8일), **노동절(5월 1일)**, 어린이날, 현충일, 추석 전날·당일·다음 날(음력 8월 14~16일), 기독탄신일, 임기만료 선거일, 정부가 수시 지정하는 날 | 공휴일에 관한 법률 제2조, 관공서의 공휴일에 관한 규정 제2조(일요일 포함), 국경일에 관한 법률 제2조 |
| 2026년 변경 | 노동절 신설 **2026-05-01 시행**, "국경일 전체"(= 제헌절 7월 17일 포함) **2026-05-11 시행** | 규정 부칙 <2026.4.30>, 법률 부칙 <2026.2.10>·<2026.4.9> |
| **대체공휴일** | ① 국경일·부처님 오신 날·노동절·어린이날·기독탄신일이 **토·일요일**과 겹칠 때 ② 설날·추석 연휴가 **일요일**과 겹칠 때 ③ 국경일·설날·부처님 오신 날·노동절·어린이날·추석·기독탄신일이 **평일에 다른 공휴일과 겹칠 때** → 그 공휴일 다음의 첫 번째 비공휴일. 대체공휴일끼리 겹치면 그다음 비공휴일, 대체공휴일이 토요일이면 그다음 비공휴일. **1월 1일·현충일은 대체하지 않는다**, 설·추석은 토요일과 겹쳐도 대체하지 않는다 | 관공서의 공휴일에 관한 규정 제3조 (2026-05-01 시행본) |
| 임시공휴일 | 국무회의 심의를 거쳐 지정 — 계산할 수 없다 | 같은 규정 제2조 11호·제4조 |
| 민간 기업 | 사용자는 「관공서의 공휴일에 관한 규정」 제2조 각 호(일요일 제외)의 공휴일과 제3조의 대체공휴일을 **유급휴일로 보장** — 근로자대표와 서면 합의하면 특정 근로일로 대체 가능 | 근로기준법 제55조 ② (2026-10-02 시행본), 시행령 제30조 ② |

- 공휴일은 해마다 바뀔 수 있다 — 연도 목록 확정 시 위 원문을 다시 확인한다 (MANDATORY).

## 2. 결정 항목 (기본값)

| 결정 | 기본값 | 대안 / 비고 |
|---|---|---|
| 저장 | **`holiday` 테이블**(`schemas/28_holiday.sql`) — 날짜·이름·종류·생성 출처·확정 여부 | 공통코드에 날짜를 코드로 넣지 않는다(종류·확정 여부를 담을 곳이 없다) |
| 음력 변환 | **ICU의 한국 달력(`dangi`)** — Node `Intl.DateTimeFormat('ko-KR-u-ca-dangi')`, Java ICU4J `ko_KR@calendar=dangi` | **중국 달력(`chinese`)·중국 음력 라이브러리를 쓰지 않는다**(4절) |
| 대체공휴일 | 1-1절 규칙으로 생성 (3-2절 함수) | 외부 공휴일 라이브러리는 대조용으로만 — 버전이 늦으면 법 개정이 빠진다(4절) |
| 선거일·임시공휴일 | 관리자가 `DESIGNATED`로 등록 | 정부 발표 후 즉시 |
| 확정 | 다음 해 목록을 미리 생성 → **정부 발표(관보·인사혁신처 공지)와 대조 → 연도 확정** | 미확정 연도가 있으면 기한 계산이 경고 로그를 남기고, 감시 배치가 알린다 |
| 회사 휴무일 | `COMPANY` — 사내 일정에만 | 법정 기한·환급 영업일에는 넣지 않는다 |
| 서비스 시간대 | 날짜는 **한국 날짜**로 판정 (privacy-rights.md 3-2절 `kstDate`) | |

## 3. 표준 설계

### 3-1. 흐름

```
연 1회(다음 해):  holidaysOf(year) 생성 → holiday INSERT (source=GENERATED, confirmed_at NULL)
선거일·임시:      관리자 화면에서 DESIGNATED 등록 (그 해에 대체공휴일 재계산 — 겹침이 생길 수 있다)
확정:            담당자가 정부 발표와 대조 → 그 해 행 전부 confirmed_at 기록
사용:            SELECT DISTINCT holiday_date FROM holiday WHERE kind <> 'COMPANY' AND holiday_date BETWEEN ? AND ?
                 → Set<YYYY-MM-DD> → dueDate(privacy-rights.md) · addBusinessDays(payment.md)
감시 배치:        매년 12-01, 다음 해의 확정된 행이 없으면 담당자에게 알림 (batch.md 3절 실행 이력)
```

### 3-2. 생성 규칙

```js
/*
 * 파일명 : holidays.js
 * 용도 : 한 해의 공휴일·대체공휴일 생성 — 관공서의 공휴일에 관한 규정 제2·3조(2026-05-01 시행본)
 * 최초등록 : YYYY-MM-DD [박진영]
 */
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (isoDate, n) => { const d = new Date(`${isoDate}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const dow = (isoDate) => new Date(`${isoDate}T00:00:00Z`).getUTCDay();          // 0 = 일, 6 = 토
const DANGI = new Intl.DateTimeFormat('ko-KR-u-ca-dangi', { timeZone: 'UTC', year: 'numeric', month: 'numeric', day: 'numeric' });

/** 음력(한국 달력, 평달) → 양력 YYYY-MM-DD — 그해 1월 1일부터 하루씩 넘기며 찾는다 */
export function lunarToSolar(lunarYear, month, day) {
  const d = new Date(Date.UTC(lunarYear, 0, 1));
  for (let i = 0; i < 400; i++, d.setUTCDate(d.getUTCDate() + 1)) {
    const p = Object.fromEntries(DANGI.formatToParts(d).map((x) => [x.type, x.value]));
    const leap = /윤/.test(p.month);                                                // 윤달은 공휴일 계산에서 제외
    if (Number(p.relatedYear) === lunarYear && Number(p.month.replace(/\D/g, '')) === month && Number(p.day) === day && !leap) return iso(d);
  }
  throw new Error(`음력 변환 실패: ${lunarYear}-${month}-${day}`);
}

// 대체 대상 — 규정 제3조 ①: 토·일 겹침 / 일요일만 겹침(설·추석) / 평일 겹침
const SUB_ON_SAT = new Set(['NATIONAL', 'BUDDHA', 'LABOR', 'CHILDREN', 'CHRISTMAS']);
const SUB_ON_SUN = new Set([...SUB_ON_SAT, 'SEOL', 'CHUSEOK']);

/**
 * 한 해의 공휴일 + 대체공휴일 (일요일 자체는 넣지 않는다 — 계산 함수가 요일로 판정)
 * @param {number} year
 * @param {{date: string, name: string}[]} designated 선거일·임시공휴일(관리자 등록분) — 대체공휴일을 만들지 않지만, 대체공휴일이 이 날을 건너뛴다
 * @returns {{date: string, name: string, kind: string}[]}
 */
export function holidaysOf(year, designated = []) {
  const base = [];
  const add = (date, name, rule, kind = 'FIXED') => base.push({ date, name, rule, kind });
  add(`${year}-01-01`, '1월 1일', 'NEWYEAR');
  const seol = lunarToSolar(year, 1, 1);
  [-1, 0, 1].forEach((n, i) => add(addDays(seol, n), ['설날 전날', '설날', '설날 다음 날'][i], 'SEOL', 'LUNAR'));
  add(`${year}-03-01`, '3·1절', 'NATIONAL');
  add(lunarToSolar(year, 4, 8), '부처님 오신 날', 'BUDDHA', 'LUNAR');
  if (year >= 2026) add(`${year}-05-01`, '노동절', 'LABOR');                       // 2026-05-01 시행
  add(`${year}-05-05`, '어린이날', 'CHILDREN');
  add(`${year}-06-06`, '현충일', 'MEMORIAL');
  if (year >= 2026) add(`${year}-07-17`, '제헌절', 'NATIONAL');                     // 2026-05-11 시행
  add(`${year}-08-15`, '광복절', 'NATIONAL');
  const chuseok = lunarToSolar(year, 8, 15);
  [-1, 0, 1].forEach((n, i) => add(addDays(chuseok, n), ['추석 전날', '추석', '추석 다음 날'][i], 'CHUSEOK', 'LUNAR'));
  add(`${year}-10-03`, '개천절', 'NATIONAL');
  add(`${year}-10-09`, '한글날', 'NATIONAL');
  add(`${year}-12-25`, '기독탄신일', 'CHRISTMAS');
  designated.forEach((h) => add(h.date, h.name, 'DESIGNATED', 'DESIGNATED'));

  const taken = new Set(base.map((b) => b.date));
  const subs = [];
  const byDate = Object.groupBy(base, (b) => b.date);
  for (const date of Object.keys(byDate).sort()) {
    const list = byDate[date];
    const w = dow(date);
    const others = list.filter((b) => b.rule !== 'DESIGNATED');                     // 평일 겹침 판정은 제2~10호끼리만 (①3호)
    const qualifying = others.filter((b) => SUB_ON_SUN.has(b.rule));
    const need = w === 6 ? list.filter((b) => SUB_ON_SAT.has(b.rule))
      : w === 0 ? list.filter((b) => SUB_ON_SUN.has(b.rule))
      : others.length >= 2 ? qualifying.slice(0, others.length - 1)                // 평일 겹침 — 그날 하루는 이미 쉬므로 (겹친 수 - 1)일
      : [];
    for (const b of need) {
      let d = addDays(date, 1);
      while (dow(d) === 0 || dow(d) === 6 || taken.has(d)) d = addDays(d, 1);       // 다음 첫 비공휴일(토요일·이미 잡힌 대체공휴일 건너뜀)
      taken.add(d);
      subs.push({ date: d, name: `대체공휴일(${b.name})`, kind: 'SUBSTITUTE' });
    }
  }
  return [...base.map(({ date, name, kind }) => ({ date, name, kind })), ...subs].sort((a, b) => a.date.localeCompare(b.date));
}
```

- 실측 2026-10-20 (Node 24.22, ICU 78.3):
  - **음력 변환**: 2000~2050년 설날·부처님 오신 날·추석 153건이 한국천문연구원 데이터 기반 `korean-lunar-calendar`(0.4.0)와 **모두 같다**. Java ICU4J 78.3 `ko_KR@calendar=dangi`도 153건 모두 같다.
  - **2026년**: 위 함수 + 지방선거(06-03) 입력 → 22일, 대체공휴일 03-02(3·1절)·05-25(부처님 오신 날)·08-17(광복절)·10-05(개천절). 추석 다음 날(09-26 토)은 대체하지 않는다.
  - **2027년**: 24일, 대체공휴일 7일 — 02-09(설날)·05-03(노동절)·07-19(제헌절)·08-16(광복절)·10-04(개천절)·10-11(한글날)·12-27(기독탄신일).
  - **평일 겹침**: 2028년 추석 연휴(10-02~04)와 개천절(10-03 화)이 겹친다 → 대체공휴일 10-05 하루.
  - **지정일**: 임시공휴일을 한글날(2026-10-09)에 겹쳐 넣어도 대체공휴일이 늘지 않는다 / 대체공휴일 자리(2026-08-17)에 넣으면 광복절 대체공휴일이 08-18로 간다.
  - 대조: Python `holidays` 0.107과 2026·2027·2028년 **완전 일치**. 2024·2025년은 선거일·임시공휴일(지정일 — 이 함수의 입력)만 달랐다.

### 3-3. 확정과 감시

- 생성 결과는 **후보**다. 담당자가 정부 발표와 대조해 확정하고(`confirmed_at`), 다르면 발표를 따른다 — 규정 해석이 갈리거나 임시공휴일이 생긴다.
- 선거일·임시공휴일을 등록하면 **그 해를 다시 생성**한다 — 지정일은 대체공휴일을 만들지 않지만(①3호의 겹침 대상은 제2~10호), 대체공휴일은 지정일을 건너뛰어 다음 비공휴일로 가야 한다.
- 감시 배치: 매년 12-01에 다음 해 확정 행이 없으면 알린다. 기한 계산 함수는 미확정 연도를 만나면 warn 로그를 남긴다(계산은 생성 후보로 진행).

### 3-4. 사용 — 달력일·영업일

- 기한·영업일 계산 함수는 **날짜 집합 하나만** 인자로 받는다 — 어디서 왔는지 모르게 한다(테스트에서 바꿔 넣기 쉽다).
- 법정 기한(privacy-rights.md 달력일, payment.md 영업일)은 `kind <> 'COMPANY'`. 사내 일정(결재 SLA·출고 예정일)은 회사 휴무일까지 넣는다.
- 영업일은 법에 정의가 없는 경우가 많다(payment.md 1-1절) — 토·일·공휴일 제외를 기본으로 하고 해석은 법무가 확정한다.

## 4. 함정 (STRICT)

| 함정 | 증상 | 처방 |
|---|---|---|
| 공휴일을 기억·예전 목록으로 하드코딩 | 2026년부터 공휴일인 **노동절·제헌절이 빠진다** (근거: 1-1절 2026년 변경) | 규칙 생성 + 연도 확정 (3절) |
| 공휴일 라이브러리 버전 고정 | 법 개정 전 버전이면 개정이 빠진다 (실측: Python `holidays` 0.80은 2026년 20일 — 노동절·제헌절 없음 / 0.107은 22일) | 라이브러리는 대조용, 원천은 규칙 + 확정 |
| **중국 달력(`chinese`)으로 음력 변환** | 기준 경도가 달라 날짜가 어긋난다 — 2000~2050년 6건 (실측: 2012 부처님 오신 날 한국 05-28 / 중국 **04-28 — 한 달 차이**, 2028 설날 01-27 / 01-26, 2040 추석 09-21 / 09-20) | `dangi` (한국 달력) |
| 대체공휴일을 "토·일이면 월요일"로 단순화 | 설·추석은 토요일 겹침이면 대체하지 않는다, 1월 1일·현충일은 대체 없음, 평일 겹침도 대체 대상 (실측: 2026-09-26 추석 다음 날 토요일 → 대체 없음) | 규정 제3조 그대로 (3-2절) |
| 선거일·임시공휴일 누락 | 계산할 수 없는 날이라 생성 목록에 없다 — 그날 마감 기한이 하루 앞당겨진다 | 관리자 등록 + 재생성 + 확정 |
| 회사 휴무일을 법정 기한에 포함 | 법정 기한보다 늦게 처리하게 된다 | `COMPANY` 제외 (3-4절) |
| Java `DangiCalendar` 클래스 직접 사용 | ICU4J에서 **deprecated** (실측 78.3 컴파일 경고) | `Calendar.getInstance(..., new ULocale("ko_KR@calendar=dangi"))` — `EXTENDED_YEAR`가 양력 연도 (실측) |
| 서버 날짜(UTC)로 "오늘" 판정 | 한국 0~9시에 전날로 계산 | 한국 날짜 (privacy-rights.md 3-2절) |

## 5. 스택별 구현

| 구성 | Express | Spring |
|---|---|---|
| 음력 변환 | `Intl.DateTimeFormat('ko-KR-u-ca-dangi')` `formatToParts` (3-2절, 실측 — Node 기본 ICU 포함) | ICU4J `com.ibm.icu:icu4j` — `Calendar.getInstance(TimeZone.getTimeZone("Asia/Seoul"), new ULocale("ko_KR@calendar=dangi"))`, `EXTENDED_YEAR`·`MONTH`(0부터)·`DAY_OF_MONTH`·`IS_LEAP_MONTH` (실측 2026-10-20, 78.3 — Node와 153건 일치) |
| 대체공휴일 | `holidaysOf` (3-2절) | 같은 규칙을 `LocalDate`로 — 3-2절 실측 표를 테스트 케이스로 |
| 조회 | `SELECT DISTINCT holiday_date …` → `Set` | `Set<LocalDate>` |
| 감시 | batch.md 1절 방식 | `@Scheduled(cron = "0 0 9 1 12 *", zone = "Asia/Seoul")` + 실행 이력 |

## 6. 검증 포인트

- 자동화 테스트: 3-2절 실측의 2026·2027년 목록 전체(날짜·이름) / 2012년 부처님 오신 날 = 05-28(중국 달력 오답 방지) / 지정일이 다른 공휴일과 겹쳐도 대체공휴일이 생기지 않는다 / 대체공휴일 자리에 지정일이 있으면 그다음 평일로 간다 / `COMPANY`가 법정 기한 계산에 들어가지 않는다.
- 운영: 연도 확정 담당자·시점을 CLAUDE.md에, 다음 해 목록을 정부 발표와 대조한 기록(확정자·일시)이 남는지.
