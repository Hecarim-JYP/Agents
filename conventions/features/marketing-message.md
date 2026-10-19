# 레시피: 광고성 정보 발송 — 수신 동의·야간 제한·수신거부 `[대외]`

> 확정: 2026-10-19 | 테이블: `schemas/19_terms_consent.sql`(동의 이력) + `schemas/07_outbox.sql`(발송) | 원칙: consent.md(동의는 이력), notification.md(사건 키·outbox 발송) | 짝: mail-domain-auth.md(원클릭 수신거부 헤더·DKIM), privacy-rights.md(처리정지·동의 철회)
> 광고는 **채널별 사전 동의가 있는 사람에게만, 보내기 직전에 다시 확인하고** 보낸다. 앱 푸시·문자는 **한국 시각 21시~08시에 별도 동의 없이 보내지 않고 08시로 미룬다**. 수신거부는 로그인 없이 한 번에 되고, 동의·거부를 하면 14일 안에 결과를 알리며, 동의는 2년마다 확인 안내를 보낸다.

## 1. 언제 쓰나

이벤트·쿠폰·신상품·할인 안내처럼 **영리 목적의 광고성 정보**를 메일·문자·앱 푸시·메신저로 보낼 때. 주문·배송·결제·보안·약관 변경 안내 같은 거래·서비스 정보는 이 레시피가 아니다(notification.md) — **정보성 메시지에 광고를 섞으면 전체가 광고**로 다뤄진다(업계 안내 — 2차 출처, 판단이 애매하면 법무 확인).

### 1-1. 법정 요건 (원문 확인 2026-10-19 — legalize-kr: 법제처 데이터를 옮긴 공개 저장소)

정보통신망법 2026-10-02 시행본, 같은 법 시행령 2026-10-01 시행본.

| 항목 | 내용 | 근거 |
|---|---|---|
| 사전 동의 | 전자적 전송매체로 광고성 정보를 보내려면 **수신자의 명시적 사전 동의**. 예외: 거래관계로 직접 연락처를 받은 자가 **거래 종료일부터 6개월 이내** 같은 종류 재화등을 광고하는 경우 등 | 정보통신망법 제50조 ①, 시행령 제61조 ① |
| 거부·철회 | 수신거부·동의 철회 후에는 전송 금지 | 법 제50조 ② |
| 야간 | **오후 9시~다음 날 오전 8시**에 보내려면 **별도 사전 동의**. 단 **전자우편은 제외** | 법 제50조 ③, 시행령 제61조 ② |
| 명시 사항 | 광고성 정보에 **전송자 명칭·연락처**, **수신거부·동의 철회를 쉽게 하는 방법** 등을 밝힌다 — 구체적 사항·방법은 시행령 **별표 6** | 법 제50조 ④, 시행령 제61조 ③ |
| 금지 행위 | 수신거부·철회를 **회피·방해**, 연락처 자동 생성·자동 등록, 전송자 신원·출처 은폐, 기망으로 회신 유도 | 법 제50조 ⑤ |
| 비용 | 수신거부·철회 때 전화요금 등 비용을 수신자가 부담하지 않게(무료전화 등, 별표 6) | 법 제50조 ⑥, 시행령 제62조 |
| 처리 결과 통지 | 수신자가 **동의·거부·철회 의사를 표시한 날부터 14일 이내**에 전송자 명칭 / 동의·거부·철회 사실과 날짜 / 처리 결과를 알린다 | 법 제50조 ⑦, 시행령 제62조의2 |
| 정기 확인 | 동의를 받은 날부터 **2년마다**(매 2년이 되는 해의 동의 받은 날과 같은 날 **전까지**) 전송자 명칭 / 동의 사실과 날짜 / 유지·철회 방법을 밝혀 확인 | 법 제50조 ⑧, 시행령 제62조의3 |

- **별표 6(명시 방법)은 이 레시피에서 원문을 확인하지 못했다.** 업계 안내(문자 발송 대행사 가이드 — 2차 출처)는 **제목·본문 시작에 "(광고)"**, 본문에 전송자 명칭·연락처, 무료 수신거부 방법을 표기하라고 안내한다. 착수 시 별표 6 원문과 KISA 「불법 스팸 방지를 위한 정보통신망법 안내서」 최신판으로 표기 문구·위치를 확인해 CLAUDE.md에 기록한다 (MANDATORY).
- 기간·대상은 개정이 잦다 — 착수 시 현행 원문을 다시 확인한다 (MANDATORY).

## 2. 결정 항목 (기본값)

| 결정 | 기본값 | 대안 / 비고 |
|---|---|---|
| 동의 단위 | **채널별** — `terms_type` = `MARKETING_EMAIL` / `MARKETING_SMS` / `MARKETING_PUSH` + 야간 `MARKETING_NIGHT` (consent.md 이력 그대로) | 채널 통합 동의 하나 — 채널 하나만 끄고 싶은 사용자가 전부 끄게 된다 |
| 거래관계 예외(6개월) | **쓰지 않는다** — 항상 동의를 받는다 | 쓰려면 "같은 종류 재화"·"거래 종료일" 판정을 법무와 정하고 코드로 고정 |
| 야간 발송 | 푸시·문자는 **08:00(한국 시각)으로 미룬다** — outbox `next_attempt_at` | 야간 동의자에게만 즉시 발송. 메일은 법상 제외지만 서비스 정책으로 같이 미뤄도 된다 |
| 광고 표기 | 제목·본문 시작 "(광고)" + 본문 끝 전송자 명칭·연락처·수신거부 방법 — **템플릿이 강제**(작성자가 빼지 못하게) | 문구는 별표 6 확인 후 확정 (1-1절) |
| 수신거부 | 메일 = 본문 링크 + **원클릭 헤더**(RFC 8058, mail-domain-auth.md 3-3절) / 푸시·문자 = 앱 설정 + 링크 또는 무료 번호 | 로그인 요구 금지 (4절) |
| 토큰 서명 키 | 환경변수 `UNSUBSCRIBE_KEY`(32바이트 base64) — `.env.example`·compose server `environment:`에 함께 추가(ops.md 1절) | 바꾸면 이미 보낸 메일의 링크가 모두 무효 — 교체는 옛 키 병행 검증 기간을 둔다 |
| 처리 결과 통지 | 동의·거부 직후 **즉시** 발송(outbox) — 14일 기한을 배치에 맡기지 않는다 | |
| 2년 확인 | 매일 배치 — **기한 30일 전** 안내 발송, 사건 키로 주기당 1회 | |

## 3. 표준 설계

### 3-1. 발송 경로 — 대상 선정과 발송 판정을 나눈다

```
캠페인 등록 → 대상 선정 배치: 동의자 목록으로 outbox 적재 (payload에 isAd: true, channel, campaignId)
            → relay가 발송 직전에 canSendAd(userId, channel, now)  ── false면 CANCELLED(사유 기록)
                                                                ── 'DEFER'면 next_attempt_at = 다음 08:00
                                                                ── true면 "(광고)"·수신거부가 들어간 템플릿으로 발송
```

- 대상 선정 시점의 동의만 보면 **그사이 철회한 사람에게 보낸다** — 판정은 relay가 보내기 직전에 한 번 더(consent.md 3-3절).
- 사건 키 `{채널}:AD:{campaignId}:{userId}` — 대상 선정 배치를 다시 돌려도 한 사람에게 한 번(notification.md 3-1절).

### 3-2. 발송 판정

```js
/** 한국 시각 시(0~23) — 서버·컨테이너 시간대와 무관 (getHours()는 서버 시간대) */
const kstHour = (d) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', hourCycle: 'h23' }).format(d));
export const isNightKst = (d) => { const h = kstHour(d); return h >= 21 || h < 8; };   // 법 제50조 ③: 21시~다음 날 8시

/** 다음 한국 08:00 — 한국은 일광절약시간이 없어 UTC+9 고정으로 계산한다 */
export const nextMorningKst = (d) => {
  const kst = new Date(d.getTime() + 9 * 3600e3);                                     // 한국 벽시계를 UTC 필드로 옮겨 날짜를 얻는다
  const m = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(), 8) - 9 * 3600e3);
  return m > d ? m : new Date(m.getTime() + 24 * 3600e3);                              // 21시 이후면 내일 08시
};

/**
 * 광고 발송 가능 여부 — relay가 보내기 직전에 호출
 * @returns {true | false | 'DEFER'} DEFER = 야간이라 08시로 미룬다
 */
export async function canSendAd(consentRepo, userId, channel, now = new Date()) {
  const latest = await consentRepo.findLatest(userId, [`MARKETING_${channel}`, 'MARKETING_NIGHT']);  // terms_type별 최신 1행
  if (latest[`MARKETING_${channel}`]?.agreed !== 1) return false;                    // 동의 없음·철회
  if (channel !== 'EMAIL' && isNightKst(now) && latest.MARKETING_NIGHT?.agreed !== 1) return 'DEFER';   // 전자우편은 야간 제한 제외(시행령 제61조 ②)
  return true;
}
```

- 실측 2026-10-19 (Node 22, `TZ=UTC`): 한국 22:30 → `getHours()` 13 → **야간 아님으로 오판** / `isNightKst` → 야간. 경계값 20:59 아님 · 21:00 야간 · 07:59 야간 · 08:00 아님, 야간이면 `nextMorningKst`가 다음 날 08:00.

### 3-3. 수신거부 — 로그인 없이, 한 번에

```js
import { createHmac, timingSafeEqual } from 'node:crypto';
const UNSUB_KEY = Buffer.from(process.env.UNSUBSCRIBE_KEY, 'base64');                // 폴백 금지 (patterns.md 4절)
const sig = (p) => createHmac('sha256', UNSUB_KEY).update(p).digest('base64url').slice(0, 32);

/** 수신거부 링크 토큰 — 만료 없음(옛 메일의 링크도 동작해야 한다), 사용자·채널을 바꾸면 서명이 깨진다 */
export const unsubToken = (userId, channel) => `${userId}.${channel}.${sig(`${userId}.${channel}`)}`;
export function verifyUnsub(token) {
  const [userId, channel, s] = String(token).split('.');
  if (!userId || !channel || !s) return null;
  const a = Buffer.from(s), b = Buffer.from(sig(`${userId}.${channel}`));
  return a.length === b.length && timingSafeEqual(a, b) ? { userId: Number(userId), channel } : null;
}
```

- `GET /unsubscribe/:token` = 확인 화면(버튼 하나), `POST /unsubscribe/:token` = 처리 — 메일 보안 스캐너가 링크를 미리 열어도(GET) 철회되지 않게. 원클릭 헤더의 POST도 같은 처리(mail-domain-auth.md 3-3절).
- 처리 = `user_consent`에 `agreed = 0, channel = 'UNSUBSCRIBE'` 행 INSERT → 처리 결과 통지(3-4절). 이미 거부 상태여도 성공 화면(멱등).
- 실측: 토큰 검증 성공 / 사용자 ID 변조 → null / 채널 변조 → null.

### 3-4. 처리 결과 통지와 2년 확인

- 동의·거부·철회를 저장한 **같은 트랜잭션에서 outbox 적재** — 내용: 전송자 명칭, 무엇에 동의·거부했는지와 그 날짜, 처리 결과(시행령 제62조의2). 거부 통지는 광고가 아니므로 거부한 채널로 보내도 된다.
- 2년 확인 배치(매일):

```sql
-- 채널별 최신 동의가 '동의'이고, 다음 확인 기한(동의일 + 2n년)이 30일 안에 오는 사용자
SELECT c.user_id, c.terms_type, DATE(c.created_at) AS agreed_date,
       DATE_ADD(DATE(c.created_at), INTERVAL (FLOOR(TIMESTAMPDIFF(YEAR, DATE(c.created_at), CURDATE()) / 2) + 1) * 2 YEAR) AS due
  FROM user_consent c
 WHERE c.user_consent_id IN (SELECT MAX(user_consent_id) FROM user_consent
                              WHERE terms_type IN ('MARKETING_EMAIL', 'MARKETING_SMS', 'MARKETING_PUSH', 'MARKETING_NIGHT')
                              GROUP BY user_id, terms_type)
   AND c.agreed = 1
HAVING due <= CURDATE() + INTERVAL 30 DAY;
-- → 사건 키 '{채널}:AD_RECHECK:{user_consent_id}:{due}'로 outbox 적재 — 같은 주기에 두 번 보내지 않는다
```

- 다시 동의하면 새 동의 행의 날짜부터 다시 센다. 안내는 응답을 요구하지 않는다 — 유지·철회 방법을 알리는 것(시행령 제62조의3 ②).
- 실측 2026-10-19 (MariaDB 10.11·MySQL 8.0.46 동일): 2024-11-05 동의 → 기한 2026-11-05로 선정 / 2022-10-01 동의 → 다음 기한 2028(이번 주기 지남) / 철회한 사용자 제외 / **2024-02-29 동의 → 2026-02-28**.

## 4. 함정 (STRICT)

| 함정 | 증상 | 처방 |
|---|---|---|
| `getHours()`로 야간 판정 | 컨테이너가 UTC면 **한국 22:30을 13시로 보고 발송** (실측) | `Intl` `timeZone: 'Asia/Seoul'` (3-2절) |
| 대상 선정 시점에만 동의 확인 | 그사이 철회한 사람에게 발송 | relay가 발송 직전 확인 |
| 수신거부에 로그인 요구 | 거부를 **방해**하는 행위 (법 제50조 ⑤1호) | 서명 토큰 링크 (3-3절) |
| 수신거부 링크에 만료 | 옛 메일에서 거부가 안 된다 | 만료 없는 서명 토큰 |
| GET 한 번에 철회 | 메일 보안 스캐너가 링크를 열어 **본인 모르게 철회** | GET = 확인 화면, POST = 처리 |
| 광고 표기를 작성자에게 맡김 | 캠페인마다 "(광고)"·수신거부 문구 누락 | 광고 템플릿이 강제 삽입 |
| 정보성 알림에 쿠폰·이벤트 끼워 넣기 | 메시지 전체가 광고 — 미동의자에게 보낸 광고가 된다 | 광고는 광고 경로로만 |
| JS로 "2년 뒤 같은 날" 계산 | 2024-02-29 + 2년 → `setUTCFullYear`는 **2026-03-01**(하루 늦음), DB `DATE_ADD`는 02-28 (실측) | 기한은 SQL `DATE_ADD` 또는 말일 보정 함수로 |
| 동의·거부 결과 통지를 배치로 몰아서 | 배치 장애가 길어지면 14일 초과 | 저장 트랜잭션에서 outbox 적재 |
| 채널 통합 동의 | 문자만 끄려는 사용자가 전부 끈다 / 채널별 증명 불가 | 채널별 `terms_type` |

## 5. 스택별 구현

| 구성 | Express | Spring |
|---|---|---|
| 야간 판정 | `isNightKst` (3-2절, 실측) | `ZonedDateTime.now(ZoneId.of("Asia/Seoul")).getHour()` — 서버 기본 시간대(`LocalDateTime.now()`)를 쓰지 않는다 (이 레시피에서 미검증) |
| 08시 보류 | outbox `next_attempt_at` 갱신 | 동일 |
| 수신거부 토큰 | `createHmac` + `timingSafeEqual` | `Mac`(HmacSHA256) + `MessageDigest.isEqual` |
| 2년 확인 | 3-4절 SQL (실측) | 동일 SQL |

## 6. 검증 포인트

- 자동화 테스트: `TZ=UTC`로 한국 20:59·21:00·07:59·08:00 판정 / 야간 + 야간 미동의 → DEFER, 메일은 야간에도 true / 철회 직후 relay 판정 false / 토큰 변조 → 거부 / 2년 확인 배치를 같은 날 두 번 돌려도 안내 1건.
- 수동: 실제 발송한 광고 메일·문자·푸시의 제목·본문에 "(광고)"·전송자·수신거부 방법이 있는지, 수신거부 링크를 로그아웃 상태에서 눌러 처리되는지, 처리 결과 메일이 오는지.
