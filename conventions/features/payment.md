# 레시피: 결제(PG 연동) — 금액 검증·승인·취소·대사 `[대외]` ⚑

> 확정: 2026-10-19 | 테이블: `schemas/24_payment.sql` | 원칙: state-machine.md(조건부 전이), integration.md 4절(동기 쓰기·멱등 키), idempotency.md | 짝: webhook-receive.md(PG 상태 알림), outbox.md(결제 후 후속 연동), account-withdrawal.md(거래기록 5년 보존), error-alert.md(대사 불일치)
> 결제 금액은 **서버가 주문에서 계산해 저장한 값**만 믿는다 — 결제창·리다이렉트로 돌아온 금액은 대조용이다. 승인·취소 호출에는 **시도마다 고정된 멱등 키**를 붙이고, 응답이 유실되면 실패로 처리하지 말고 **PG에 상태를 물어** 확정한다. 상태 전이는 조건부 UPDATE로 한 번만.

## 1. 언제 쓰나

PG(결제대행사)의 결제창으로 카드·계좌이체·간편결제를 받는 서비스. 정기결제(빌링 키)·에스크로·정산 대행(오픈마켓)은 이 레시피의 확장 — 각 PG 문서를 따른다.

⚑ 되돌리기 어려운 이유: 결제 시도와 주문을 1:1로 묶거나(재시도 불가), 금액을 클라이언트 값으로 받는 구조로 시작하면 이미 쌓인 결제 데이터와 정산 대사를 함께 고쳐야 한다. PG 계약(수수료·정산 주기·지원 수단)도 바꾸기 어렵다.

### 1-1. 법정 요건 (원문 확인 2026-10-19 — legalize-kr: 법제처 데이터를 옮긴 공개 저장소)

전자상거래법 2026-07-21 시행본, 같은 법 시행령 2026-07-21 시행본.

| 항목 | 내용 | 근거 |
|---|---|---|
| 청약철회 기간 | 계약내용 서면을 받은 날부터 **7일**(공급이 더 늦으면 공급받은 날부터 7일), 더 긴 약정이 있으면 그 기간 | 전자상거래법 제17조 ① |
| 철회 제한 | 소비자 책임 멸실·훼손(포장 확인 목적 훼손 제외), 사용·시간 경과로 가치 현저 감소, 복제 가능 재화 포장 훼손, 용역·디지털콘텐츠 제공 개시 등 — **제한 사실을 쉽게 알 수 있게 표시하지 않으면 제한할 수 없다** | 같은 조 ②⑥, 시행령 제21조 |
| 표시·광고와 다른 이행 | 공급받은 날부터 **3개월**, 안 날부터 **30일** 이내 철회 가능, 반환 비용은 사업자 부담 | 같은 조 ③, 제18조 ⑩ |
| 환급 기한 | **3영업일** 이내 — 재화는 반환받은 날부터, 용역·디지털콘텐츠·미공급은 철회한 날부터. 지연하면 지연배상금 **연 15%** | 제18조 ②, 시행령 제21조의3 |
| 카드 등 결제 | 환급 시 **지체 없이 결제업자에게 청구 정지·취소 요청**(이미 대금을 받았으면 결제업자에게 환급하고 소비자에게 알림) | 제18조 ③ |
| 비용 | 단순 철회의 반환 비용은 소비자 부담, **위약금·손해배상 청구 금지** | 제18조 ⑨ |
| 거래기록 보존 | 계약·청약철회 기록 5년, 대금결제·재화 공급 기록 5년 | 시행령 제6조 ① — account-withdrawal.md 1-1절 |
| 카드번호 | 정보통신서비스 이용자의 신용카드번호를 저장하면 암호화 의무 | 「개인정보의 안전성 확보조치 기준」 제7조 ② — **저장하지 않는다**(PG 결제창이 받는다) |

- "영업일"은 법에 정의가 없다 — 이 레시피는 토·일·공휴일(holiday.md — 회사 휴무일 제외)을 뺀 날로 계산한다(3-5절). 착수 시 법무가 해석을 확정해 CLAUDE.md에 기록한다 (MANDATORY).

### 1-2. PG 사실 (2026-10-19 — 토스페이먼츠 개발자 문서 검색 요약, 2차 출처)

- 승인 API 필수 값 `paymentKey`·`orderId`·`amount` / `orderId`는 6~64자 영문 대소문자·숫자·`-`·`_` / `paymentKey` 최대 200자 / 멱등 키 유효 15일.
- **미확인**: 결제창 인증 후 승인 가능 시간 제한, 웹훅 이벤트 목록·서명 여부 — 착수 시 계약한 PG 문서로 확인한다 (MANDATORY). PG마다 이름만 다르고 흐름(결제창 → 리다이렉트 → 서버 승인 → 웹훅)은 같다.

## 2. 결정 항목 (기본값)

| 결정 | 기본값 | 대안 / 비고 |
|---|---|---|
| 결제 수단 입력 | **PG 결제창** — 카드번호를 우리 서버가 받지 않는다 | 직접 입력(비인증 결제)은 카드사 심사·보안 인증 부담 |
| 결제 시도 | **시도마다 `payment` 행 + 새 `pg_order_id`** (주문 1 : 결제 N) | 주문 ID를 그대로 PG 주문번호로 — 실패 후 재시도에서 중복 주문번호 거절 |
| `pg_order_id` | 21자 랜덤(public-id.md 방식) — 추측 불가 | 순번 — 남의 주문번호로 성공 URL 호출 시도 |
| 금액 | **서버 계산 후 저장**, 승인 전 리다이렉트 금액과 대조 | 클라이언트 금액 신뢰 — 4절 |
| 승인 호출 | **동기**(사용자가 결과를 기다린다) + 멱등 키 `confirm:{pg_order_id}` | outbox 경유 예외 — integration.md 4절 "응답이 즉시 필요한 쓰기" |
| 응답 유실 | **PG 조회로 확정** → 그래도 모르면 `READY` 유지 + 대사 배치 | 실패 처리 — 4절 |
| 취소 | `payment_cancel` 행(멱등 키) 먼저 → PG 호출 → 실패·유실이면 **같은 키로** 재시도 | |
| 대사 | 10분마다 오래된 `READY` 조회·확정, 매일 PG 거래 내역과 합계 대조 | |
| 키 | `PG_SECRET_KEY`(서버 전용) — `.env.example`(빈 값)·compose server `environment:`에 함께 추가(ops.md 1절), 테스트·운영 키 분리 | 클라이언트 키는 공개 값이라 프론트 빌드 변수 |

## 3. 표준 설계

### 3-1. 흐름

```
① 주문 확정  → payment INSERT (status READY, pg_order_id 새로, amount = 서버 계산)
② 화면      → PG 결제창 호출 (orderId = pg_order_id, amount)
③ PG        → successUrl?paymentKey=…&orderId=…&amount=…   (실패면 failUrl — READY 그대로, 재시도는 새 시도)
④ 서버 승인 → 3-2절 confirm — PAID 전이와 주문 처리를 한 트랜잭션, 후속 연동(재고·배송·알림)은 outbox
⑤ 웹훅      → 가상계좌 입금·취소 등 비동기 상태 변화 (webhook-receive.md) — 같은 조건부 전이 함수를 쓴다
⑥ 대사      → 3-4절
```

### 3-2. 승인

```js
/**
 * 결제 승인 — 성공 리다이렉트를 받은 서버가 호출. 같은 요청이 여러 번 와도(새로고침·동시 요청) 결과는 하나
 * ① 저장된 금액과 대조 ② 시도마다 고정된 멱등 키 ③ 응답 유실이면 PG 조회 ④ 전이는 조건부 UPDATE
 */
export async function confirmPayment({ paymentKey, orderId, amount }) {
  const p = await paymentRepo.findByPgOrderId(orderId);
  if (!p) throw new NotFoundError('PAYMENT_NOT_FOUND');
  if (p.status === 'PAID') return p;                                       // 이미 확정 — PG를 다시 부르지 않는다
  if (Number(amount) !== p.amount) throw new BadRequestError('AMOUNT_MISMATCH');   // 결제창 금액 조작 — 승인하지 않는다

  try {
    const res = await pgClient.confirm({ paymentKey, orderId, amount: p.amount }, { idempotencyKey: `confirm:${orderId}` });
    return await markPaid(p, res);
  } catch (e) {
    if (e.code === 'ALREADY_PROCESSED_PAYMENT') return paymentRepo.findByPgOrderId(orderId);   // 다른 요청이 먼저 확정
    if (!e.isTimeout) { await markFailed(p, e.code); throw e; }
    const st = await pgClient.getByOrderId(orderId);                       // 응답 유실 — 실제로 승인됐는지 PG에 묻는다
    if (st.status === 'DONE' && st.totalAmount === p.amount) return await markPaid(p, st);
    throw new PaymentPendingError();                                       // READY 유지 — 화면은 "확인 중", 대사 배치가 확정
  }
}

// markPaid: UPDATE payment SET status='PAID', pg_payment_key=:k, approved_at=NOW(), version=version+1
//            WHERE pg_order_id=:o AND status='READY'   ← 0행이면 이미 다른 경로(웹훅·대사)가 확정 — 주문 처리를 반복하지 않는다
```

- 실측 2026-10-19 (Node 22 + MariaDB 10.11, 모의 PG — 결제창 금액과 승인 금액이 다르면 거절하는 실제 PG 동작을 재현):

| 상황 | 흔한 구현(리다이렉트 값을 그대로 승인, 타임아웃 = 실패) | 표준(3-2절) |
|---|---|---|
| 5만 원 주문을 결제창에서 100원으로 조작 | **100원 결제로 PAID** | `AMOUNT_MISMATCH` — 승인 안 함, READY |
| 승인은 됐는데 응답이 타임아웃보다 늦음 | **우리 FAILED / PG 실제 DONE** — 돈은 빠져나갔는데 주문 실패 | PG 조회로 PAID 확정 |
| 성공 화면 새로고침(동시 2회) | 한쪽 `ALREADY_PROCESSED` 오류 화면 | 둘 다 PAID(같은 멱등 키 → 같은 응답) |

### 3-3. 취소(환불)

```sql
-- ① 한도 선점 + 요청 기록 — 한 트랜잭션
UPDATE payment SET cancelled_amount = cancelled_amount + :amount, version = version + 1
 WHERE payment_id = :id AND status IN ('PAID', 'PARTIAL_CANCELLED')
   AND cancelled_amount + :amount <= amount;                        -- 0행이면 남은 금액 초과 (동시 취소 포함)
INSERT INTO payment_cancel (payment_id, amount, reason, idempotency_key, requested_by) VALUES (:id, :amount, :reason, UUID(), :userId);

-- ② PG 취소 API — 헤더에 payment_cancel.idempotency_key. 타임아웃이면 같은 키로 재시도(배치가 REQUESTED 행을 다시 집는다)
-- ③ 성공: payment_cancel DONE, payment.status = IF(cancelled_amount = amount, 'CANCELLED', 'PARTIAL_CANCELLED')
--    PG가 거절(재시도해도 같은 결과): payment_cancel FAILED + cancelled_amount 되돌림 + 담당자 알림
```

- 실측 2026-10-19 (모의 PG, 첫 응답이 타임아웃보다 늦은 상황): 재시도마다 새 키 → **3만 원 결제에 6만 원 환불** / 같은 키 → 3만 원 / 3만 원 부분 취소 동시 2건(결제 5만 원) → 선점 1건, 누적 3만 원.

### 3-4. 대사(reconciliation)

| 주기 | 대상 | 처리 |
|---|---|---|
| 10분 | `status = 'READY' AND created_at < NOW() - INTERVAL 30 MINUTE` | PG 조회 → DONE이고 금액 일치면 `markPaid`, 결제 없음·만료면 `EXPIRED` |
| 10분 | `payment_cancel.status = 'REQUESTED'`이고 오래된 것 | 같은 멱등 키로 재호출 |
| 매일 | 전날 PG 거래 내역(조회 API 또는 정산 파일) ↔ 우리 PAID·취소 합계 | 불일치 건 목록을 담당자에게(error-alert.md) — **자동 수정하지 않는다** |

- 실행 이력·실패 알림은 batch.md 3절.

### 3-5. 환급 기한

```js
/** n영업일 뒤 — 토·일·공휴일을 건너뛰며 센다 (전자상거래법 제18조 ② 3영업일, 영업일 해석은 1-1절) */
export const addBusinessDays = (isoDate, n, holidays) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  for (let c = 0; c < n; ) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d.getUTCDay() % 6 !== 0 && !holidays.has(d.toISOString().slice(0, 10))) c++;   // 0 = 일, 6 = 토
  }
  return d.toISOString().slice(0, 10);
};
```

- 실측: 반환받은 날 10-19(월) → 10-22 / 10-08(목) → 10-14(10-09 공휴일·주말 건너뜀) / 10-02(금) → 10-08(10-05 대체공휴일).
- 열람등요구(privacy-rights.md)는 **달력일**, 환급은 **영업일** — 같은 "기한"이라도 세는 법이 다르다. 함수를 섞어 쓰지 않는다.

## 4. 함정 (STRICT)

| 함정 | 증상 | 처방 |
|---|---|---|
| 리다이렉트 금액을 그대로 승인 | **5만 원 주문이 100원 결제로 완료** (실측) | 저장 금액과 대조 후 저장 금액으로 승인 |
| 승인 타임아웃 = 실패 | **돈은 나갔는데 주문 실패** (실측) | PG 조회 → 확정, 모르면 READY + 대사 |
| 취소 재시도마다 새 멱등 키 | **이중 환불** (실측: 3만 원 → 6만 원) | 요청 행의 키로만 재시도 |
| 누적 취소를 읽고 계산한 뒤 UPDATE | 동시 부분 취소가 결제 금액을 넘는다 | 조건부 UPDATE로 한도 선점 (실측: 1건만) |
| 주문 ID = PG 주문번호 | 실패 후 재결제가 중복 주문번호로 거절 | 시도마다 새 `pg_order_id` |
| 무조건 UPDATE로 PAID 전이 | 성공 화면·웹훅·대사가 겹치면 주문 처리(재고 차감 등)가 두 번 | `WHERE status = 'READY'` + 0행이면 후속 생략 |
| 웹훅 본문만 믿고 PAID | 위조 요청으로 결제 완료 | 서명 검증, 서명이 없는 PG면 PG 조회 API로 재확인 (webhook-receive.md) |
| 승인 안에서 재고·배송 연동을 동기 호출 | 외부 장애가 결제 승인 실패로 번진다 — 돈은 나갔는데 롤백 | PAID 트랜잭션에서 outbox 적재 |
| 대사 불일치 자동 수정 | 원인 모르는 금액 변경이 장부에 남는다 | 목록 알림 → 사람이 확인 |
| 테스트 키로 운영 배포 | 실제 결제가 안 되는데 화면은 성공 | PG 키에 테스트·운영 구분 표시(접두어 등)가 있으면 기동 시 확인해 운영 설정에 테스트 키면 기동 실패 — 구분 방법은 PG 문서로 확인 |

## 5. 스택별 구현

| 구성 | Express | Spring |
|---|---|---|
| PG 클라이언트 | `external/pg/` — `fetch` + `AbortSignal.timeout`, 응답은 zod 검증 (integration.md 2·5절) | `external/pg/` — `RestClient` + 타임아웃 |
| 승인·취소 | 3-2·3-3절 (실측) | 같은 순서 — `@Transactional`은 DB 전이에만, PG 호출은 트랜잭션 밖 |
| 대사 | batch.md 방식 | `@Scheduled` + 실행 이력 |
| 성공·실패 URL | 프론트 라우트 → 서버 confirm API 호출 → 결과 화면 | 동일 |

## 6. 검증 포인트

- 자동화 테스트(모의 PG): 3-2절 표의 세 상황 + 3-3절 취소 재시도·동시 부분 취소 / 이미 PAID인 결제에 승인 재요청 → PG 호출 없음 / `markPaid` 0행이면 주문 처리 생략.
- PG 테스트 환경: 카드·간편결제·가상계좌 각 1건 결제 → 전액·부분 취소 → 웹훅 수신 → 다음 날 대사에서 불일치 0건.
- 운영 전: 테스트 키가 아닌지, 청약철회 제한 상품에 제한 표시가 있는지(1-1절), 환급 기한 계산이 법무 해석과 같은지.
