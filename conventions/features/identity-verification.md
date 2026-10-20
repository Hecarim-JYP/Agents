# 레시피: 본인확인 — 본인확인기관 연동·중복 가입 차단·만 14세 확인 `[대외]` ⚑

> 확정: 2026-10-20 | 테이블: `schemas/27_identity_verification.sql` | 원칙: field-encryption.md 3-1절(AES-GCM·블라인드 인덱스), state-machine.md(조건부 전이) | 짝: account-lifecycle.md(가입·휴대폰 인증 코드), consent.md(법정대리인 동의 이력), privacy-rights.md(대리인 요구), sms-message.md
> 이름·생년월일·휴대폰·연계정보(CI)는 **본인확인기관이 서버로 돌려준 결과만** 믿는다. 요청은 서버가 1회용 번호로 시작하고, 결과는 그 번호·세션·기한이 맞을 때 **한 번만** 쓴다. 중복 가입은 **CI 블라인드 인덱스의 UNIQUE**로 DB가 막고, 만 14세는 **한국 날짜 기준 연·월·일 비교**로 판정한다.

## 1. 언제 쓰나

실명이 필요한 서비스 — 1인 1계정, 성인 확인, 결제·포인트 한도, 법정대리인 동의 확인. **휴대폰 번호를 가진 사람인지만 알면 되면 이 레시피가 아니다** — account-lifecycle.md 3-4절 6자리 코드로 충분하다(본인확인은 건당 비용이 들고, 평생 바뀌지 않는 CI를 보관하게 된다).

⚑ 되돌리기 어려운 이유: 중복 판정 키(CI·DI)와 "가입할 때 본인확인을 하는가"는 기존 회원에게 소급할 수 없다 — 나중에 도입하면 기존 회원은 다시 확인할 때까지 중복 판정 밖에 남는다. 시작 결정 체크리스트(scaffolds/default.md)에서 정한다.

### 1-1. 법정 요건 (원문 확인 2026-10-20 — legalize-kr: 법제처 데이터를 옮긴 공개 저장소)

| 항목 | 내용 | 근거 |
|---|---|---|
| 주민등록번호 | 정보통신서비스 제공자는 본인확인기관으로 지정받은 경우 등을 빼고 **이용자의 주민등록번호를 수집·이용할 수 없다** | 정보통신망법 제23조의2 ① (2026-10-02 시행본) |
| 본인확인기관 | 주민등록번호 없이 본인을 확인하는 수단(대체수단)을 제공하는 기관은 지정을 받는다 — 우리는 지정 기관(이동통신사 등)의 서비스를 대행사를 통해 연동한다 | 같은 법 제23조의2 ②·제23조의3 |
| 연계정보(CI) | 본인확인기관이 주민등록번호를 **비가역적으로 암호화**한 정보. 받은 자(연계정보 이용기관)는 **제공받은 목적 범위에서만** 처리 — 별도 동의를 받으면 그 목적 범위 | 같은 법 제23조의5 ①④ |
| CI 안전조치 | 이용기관은 개인정보 보호법 제29조의 조치에 더해 **주민등록번호와 분리해 보관·관리**하고 분실·도난·유출·위조·변조·훼손 방지 조치 | 같은 법 제23조의6 ② |
| 만 14세 미만 | 동의를 받아야 할 때 **법정대리인의 동의**를 받고 동의했는지 확인. 동의를 받는 데 필요한 **법정대리인의 성명·연락처**만 아동에게서 직접 받을 수 있다 | 개인정보 보호법 제22조의2 ①②, 시행령 제17조의2 ② |
| 동의 확인 방법 | 동의 표시 + ① 처리자가 확인했음을 법정대리인 휴대전화 문자로 알림 ② 카드정보 ③ **법정대리인 휴대전화 본인인증** ④ 서명날인 서면 ⑤ 전자우편 회신 ⑥ 전화 ⑦ 이에 준하는 방법 중 하나 | 시행령 제17조의2 ① (2026-09-11 시행본) |
| 나이 | 출생일을 산입해 **만 나이**로 계산 / 성년은 19세 | 민법 제158조·제4조 (2026-03-17 시행본) |
| 2월 29일생 | 연으로 정한 기간에서 최종 연에 해당일이 없으면 그 월의 말일로 만료(제160조 ③) — 2월 28일에 만료되면 **3월 1일부터 한 살**이 오른다 | 민법 제160조 ②③ — 나이에 적용하는 해석은 법무 확인. 3-3절 방식은 하루 늦은 쪽(안전한 쪽)으로 판정한다 |
| CI와 DI | CI = 국민 한 사람당 하나(기관이 달라도 같은 사람을 식별), DI(중복가입확인정보) = **온라인 사이트마다** 한 사람당 하나 | KISA 본인확인 포털 자료 — 2차 출처, 2026-10-20 |

- 결과 항목(이름·생년월일·성별·내외국인·통신사·휴대폰·CI·DI)과 요청·결과 암호화 방식은 **대행사 연동 규격**이 정한다 — 계약한 대행사 문서 버전을 CLAUDE.md에 기록한다 (MANDATORY).

## 2. 결정 항목 (기본값)

| 결정 | 기본값 | 대안 / 비고 |
|---|---|---|
| 수단 | **휴대폰 본인확인**(대행사 연동) | 아이핀·인증서는 요구가 있을 때 추가 — 같은 테이블, `provider`만 다르다 |
| 결과 수신 | **결과를 받는 주소(returnUrl)가 서버 엔드포인트** — 서버가 복호화하고, 브라우저에는 "확인 완료"만 | 화면 스크립트가 받은 값을 폼에 채워 보내는 방식 금지 (4절) |
| 중복 판정 키 | **CI 블라인드 인덱스** `HMAC-SHA256(FIELD_BIDX_KEY, CI)` + UNIQUE | DI만 쓰기 — 사이트별 값이라 대행사·사이트 코드가 바뀌면 기존 회원과 비교할 수 없다(1-1절 정의에서 나오는 결론 — 대행사 문서로 확인) |
| CI 원문 | AES-GCM 암호문으로 보관(`ci_enc`) — 블라인드 인덱스 키를 교체할 때 다시 계산할 원본 | 저장하지 않으면 수집이 더 적지만 `FIELD_BIDX_KEY`를 영영 바꿀 수 없다 — 택일해 CLAUDE.md에 |
| 요청 기한 | 본인확인 창 **10분**, 확인 후 결과 사용(가입 완료) **30분** | |
| 결과 사용 | **1회, 요청을 시작한 세션에서만** | |
| 만 14세 판정 | 본인확인 결과의 생년월일 + **한국 날짜** + 연·월·일 비교 (3-3절) | 자기 신고 생년월일은 본인확인이 없는 서비스에서만 — 그때도 같은 함수 |
| 14세 미만 | **가입을 받지 않는다**(이용 대상 아님을 약관·가입 화면에) | 받는다면 3-4절 법정대리인 동의 — 동의 전에는 법정대리인 연락처 외에 아무것도 처리하지 않는다 |
| 이미 가입된 CI | 본인확인을 마친 사람에게만 "이미 가입된 계정이 있습니다" + 마스킹한 로그인 ID | 본인확인을 통과해야 보이므로 계정 열거가 아니다(account-lifecycle.md 2절과 다른 점) |
| 재확인 | 휴대폰 번호 변경(`CHANGE_PHONE`)·계정 찾기 — 결과의 CI가 회원의 CI와 같아야 진행 | |

## 3. 표준 설계

### 3-1. 흐름

```
① POST /identity/requests { purpose }               ← 로그인 또는 가입 진행 세션
   request_no = randomBytes(16).toString('hex')      (32자, 결과에 그대로 돌아온다)
   INSERT identity_verification (request_no, purpose, session_hash = sha256(세션 ID), provider, expires_at = NOW() + 10분)
   세션에 request_no 보관 → 대행사 모듈로 요청 데이터 암호화(request_no·returnUrl 포함) → 본인확인 창을 여는 값 응답
② 사용자 — 대행사 본인확인 창에서 통신사 인증
③ 대행사 → (브라우저) → POST returnUrl  (서버 엔드포인트)
   대행사 키로 복호화 → 결과의 request_no로 행 조회
   UPDATE identity_verification SET status = 'VERIFIED', verified_at = NOW(), expires_at = NOW() + 30분,
          name_enc = ?, phone_enc = ?, birth_date = ?, ci_enc = ?, ci_bidx = ?
    WHERE request_no = ? AND status = 'REQUESTED' AND expires_at > NOW()        ← 0행이면 FAILED (우리가 발급한 미사용 요청이 아니다)
   응답 = "확인 완료" 페이지 (창을 닫고 원래 창에 완료 신호만 — 값은 보내지 않는다)
④ POST /signup (가입 폼 — 이름·생년월일·휴대폰 입력란 없음)
   UPDATE identity_verification SET status = 'CONSUMED', consumed_at = NOW()
    WHERE request_no = :세션의 request_no AND session_hash = :현재 세션 AND status = 'VERIFIED'
      AND consumed_at IS NULL AND expires_at > NOW()                              ← 1행이면 이 결과의 사용권을 얻었다
   만 14세 판정(3-3절) → user INSERT(이름·휴대폰은 결과 값) → user_verified_identity INSERT(ci_bidx UNIQUE)
   → 같은 트랜잭션에서 결과 원문 컬럼을 비운다(name_enc·phone_enc·ci_enc = NULL)
```

- 실측 2026-10-20 (Node 24.22 + MariaDB 11.4.13 · MySQL 8.4.11 — 결과 동일): 같은 결과로 동시 2회 가입 → **affectedRows 1·0**(한 번만) / 다른 세션 해시로 사용 → 0행 / 만료된 결과 → 0행(**DB 세션 시간대가 통일됐을 때만** — 4절).
- 결과를 버리는 경로: 만료된 `REQUESTED`·`VERIFIED` 행은 정리 배치가 원문 컬럼을 비우고 하루 뒤 삭제한다(batch.md).
- `/identity/requests`는 비용이 드는 호출이다 — rate-limit.md 3-2절처럼 세션·IP 단위 빈도 제한.

### 3-2. 저장과 중복 판정

```js
import { createHmac } from 'node:crypto';
import { encryptField } from '../shared/fieldCrypto.js';     // field-encryption.md 3-1절

const BIDX_KEY = Buffer.from(process.env.FIELD_BIDX_KEY, 'base64');

/** CI 블라인드 인덱스 — 값 그대로(앞뒤 공백만 제거) HMAC. field-encryption.md의 blindIndex(숫자만 남김)를 쓰지 않는다 */
export const ciIndex = (ci) => createHmac('sha256', BIDX_KEY).update(ci.trim()).digest('hex');

// ③ 결과 저장: ci_enc = encryptField(ci), ci_bidx = ciIndex(ci)
// ④ 가입: INSERT INTO user_verified_identity (user_id, ci_bidx, ci_enc, birth_date, provider, verified_at) …
//    ER_DUP_ENTRY(uq_user_verified_identity_ci) → 트랜잭션 롤백 → 409 "이미 가입된 계정이 있습니다"
```

- 실측 2026-10-20 (MariaDB 11.4.13 · MySQL 8.4.11): CI(64바이트 → base64 88자) 암호문 **117바이트** / 같은 CI를 두 번 가입시키면 **암호문 UNIQUE는 2행 모두 저장**(행마다 IV가 달라 다른 값) / **`ci_bidx` UNIQUE는 두 번째를 `ER_DUP_ENTRY`로 거부**.
- 결과 수신 즉시(③) `ci_bidx`로 기존 회원을 찾아 화면을 "이미 가입" 안내로 바꿔도 되지만, **최종 판정은 ④의 UNIQUE**다 — 조회 후 INSERT 사이에 같은 사람의 두 번째 가입이 끼어들 수 있다.
- CI는 화면·API 응답·로그에 내보내지 않는다. 연계(제휴 서비스·그룹사)는 **받은 목적 안에서만**(1-1절) — 마케팅 대상 추출·외부 제공에 쓰려면 별도 동의가 먼저다.

### 3-3. 만 14세 판정

```js
/** 한국 날짜 YYYY-MM-DD — sv-SE 로캘이 이 형식을 준다 (privacy-rights.md 3-2절과 같은 함수) */
export const kstDate = (at) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(at);

/**
 * 만 나이 — 올해 생일(월·일)이 지나지 않았으면 한 살 뺀다. 2월 29일생은 3월 1일에 나이가 오른다(1-1절)
 * @param {string} birthDate 생년월일 YYYY-MM-DD (본인확인 결과)
 * @param {string} today 기준일 YYYY-MM-DD — 반드시 kstDate(new Date())
 */
export function ageOn(birthDate, today) {
  const [by, bm, bd] = birthDate.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

// 판정: ageOn(birth, kstDate(new Date())) >= 14
```

- 실측 2026-10-20 (Node 24.22 `TZ=UTC`, Java 21 `Period.between` — 같은 결과):

| 생년월일 | 기준 | `ageOn` · `Period.between` | 다른 계산 |
|---|---|---|---|
| 2012-02-29 | 2026-02-28 | **13** | Java `!birth.plusYears(14).isAfter(today)` → **14로 판정**(`plusYears`가 2-28로 당긴다 — 하루 이르다) |
| 2012-02-29 | 2026-03-01 | 14 | |
| 2012-10-21 | 한국 2026-10-21 01:30 (UTC 10-20 16:30) | 한국 날짜로 14 | **UTC 날짜로 자르면 13** — 생일 0~9시에 가입이 막힌다 |
| 2012-10-21 | 2026-10-21 | 14 | 밀리초 차 ÷ 365.25일 → **13**(생일 당일에 한 살 적다) |
| 2012-12-31 | 2026-01-01 | 13 | **출생연도만 빼면(연 나이) 14** — 만 13세가 법정대리인 동의 없이 가입한다 |

### 3-4. 14세 미만을 받는 경우 — 법정대리인 동의

```
아동 가입 신청: 아동에게서는 법정대리인 성명·연락처만 받는다(시행령 제17조의2 ②) — 아동 계정은 PENDING, 다른 정보는 아직 받지 않는다
→ 법정대리인에게 동의 안내(sms-message.md) → 법정대리인이 동의 화면에서 동의 표시 + 본인확인(purpose = GUARDIAN_CONSENT)
→ 법정대리인 결과가 성년(ageOn ≥ 19, 민법 제4조)인지 확인 → consent.md 이력에 동의 + 법정대리인 확인 요청 번호
→ 아동 계정 ACTIVE, 이후 수집 시작
동의를 받지 못하면: 정해진 기한(처리방침에 공개) 뒤 법정대리인 연락처를 파기 — 받은 목적(동의 요청)이 끝났다
```

- 법정대리인 본인확인 결과의 CI는 **아동 회원의 CI로 저장하지 않는다** — 법정대리인 동의 이력에만 남긴다(다른 목적의 연계정보다).
- 아동에게 보이는 고지는 이해하기 쉬운 표현으로 따로 쓴다(법 제22조의2 ③).

## 4. 함정 (STRICT)

| 함정 | 증상 | 처방 |
|---|---|---|
| 브라우저가 보낸 이름·생년월일·휴대폰을 저장 | 본인확인은 성인이 하고 폼에서 생년월일·번호만 바꾼다 — 14세 미만이 성인으로, 남의 번호로 가입 | 가입 폼에 그 입력란을 두지 않고 서버 결과 값만 쓴다 (3-1절 ④) |
| 복호화만 하고 요청 번호를 확인하지 않음 | 기관 결과 자체는 진짜라 복호화가 성공한다 — 다른 사람이 받은 결과를 다시 제출하면 그대로 통과 | 우리가 발급한 미사용·기한 내 `request_no`와 일치할 때만 (3-1절 ③) |
| 결과를 여러 번 사용 | 한 번의 본인확인으로 계정 여러 개 | 조건부 UPDATE로 1회 (실측: 동시 2회 → 1회) |
| 결과를 다른 세션에서 사용 | 남이 확인을 마친 결과를 가로채 가입 | `session_hash` 조건 (실측: 0행) |
| **암호문 컬럼에 UNIQUE** | 같은 사람이 계속 가입된다 — 에러가 없어 모른다 (실측: 2행 저장) | 블라인드 인덱스에 UNIQUE (3-2절) |
| **CI에 숫자만 남기는 블라인드 인덱스 재사용** | field-encryption.md의 `blindIndex`는 숫자 외를 지운다 — base64인 CI에 쓰면 **다른 사람이 같은 값**이 되어 "이미 가입"으로 막힌다 (실측: 서로 다른 CI 20만 개 중 17쌍 충돌, 숫자만 남긴 길이가 2자인 CI도 있었다) | CI 전용 `ciIndex` (값 그대로) |
| 연 나이(출생연도만 빼기) | 만 13세를 최대 1년 가까이 14세로 판정 — **법정대리인 동의 없이 아동 정보 수집** (실측: 2012-12-31생 → 2026-01-01에 14) | 연·월·일 비교 (3-3절) |
| Java `birth.plusYears(14)`로 비교 | 2월 29일생을 2월 28일에 14세로 — 하루 이르다 (실측) | `Period.between(birth, today).getYears()` |
| UTC 날짜로 "오늘" 판정 | 한국 생일 0~9시에 한 살 적게 — 14세 생일 아침에 가입 거부 (실측) | `kstDate` / `LocalDate.now(ZoneId.of("Asia/Seoul"))` |
| **DB 세션 시간대가 섞임** | 쓴 세션은 한국 시각, 비교하는 세션은 UTC면 `expires_at > NOW()`가 **9시간 동안 만료된 결과를 통과**시킨다 (실측: MariaDB 11.4·MySQL 8.4 모두 — 시간대를 통일하면 0행) | DB 서버·앱 커넥션 시간대 통일(database.md, 스캐폴드 compose `TZ: Asia/Seoul`) — 외부 관리형 DB면 커넥션마다 `SET time_zone` |
| CI를 로그·응답·화면에 | 주민등록번호에서 만든 값이라 **유출돼도 바꿀 수 없다** | 암호문·블라인드 인덱스로만, 로그 금지 (ops.md 3절) |
| CI로 마케팅 대상 추출·제휴사 제공 | 받은 목적 밖 처리 (정보통신망법 제23조의5 ④) | 별도 동의 후에만 |
| 주민등록번호 뒷자리 입력란 | 수집 자체가 금지 (같은 법 제23조의2) | 본인확인 결과의 생년월일·성별만 |

## 5. 스택별 구현

| 구성 | Express | Spring |
|---|---|---|
| 요청 번호 | `randomBytes(16).toString('hex')` | `HexFormat.of().formatHex(SecureRandom 16바이트)` |
| 결과 복호화 | 대행사가 주는 모듈·규격 그대로 (`external/identity` 모듈 하나 — integration.md) | 동일 |
| CI 인덱스 | `ciIndex` (3-2절) | `Mac.getInstance("HmacSHA256")` + 값 그대로 |
| 암호화 | field-encryption.md 3-1절 `encryptField` | 같은 형식(키 버전 + IV + 태그 + 암호문 — field-encryption.md 5절) |
| 만 나이 | `ageOn` + `kstDate` | `Period.between(birth, LocalDate.now(ZoneId.of("Asia/Seoul"))).getYears()` (실측 — Node와 같은 결과) |
| 1회 사용 | 조건부 UPDATE `affectedRows === 1` | `jdbcClient.sql(...).update() == 1` |
| 중복 | `ER_DUP_ENTRY` → 409 | `DuplicateKeyException` → 409 |

## 6. 검증 포인트

- 자동화 테스트: 3-3절 표의 다섯 날짜 / 같은 결과로 동시 가입 2건 → 1건만 성공 / 다른 세션·만료 결과 → 거부 / 같은 CI로 두 번째 가입 → 409 / 가입 요청 본문에 생년월일·휴대폰을 넣어도 저장값은 결과 값 / 가입 완료 후 `identity_verification`의 원문 컬럼이 비었다.
- 연동(대행사 개발 환경): 결과 데이터를 다시 제출 → 거부, 창을 닫고 10분 뒤 결과 → 거부, 로그·응답에 CI가 없다.
- 운영 전: DB 서버와 앱 커넥션의 시간대(`SELECT @@system_time_zone, @@session.time_zone`)가 한국 시각으로 같은지.
