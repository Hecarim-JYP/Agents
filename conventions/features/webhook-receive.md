# 레시피: 웹훅 수신 — 서명 검증·즉시 응답·중복 제거 `[공통]`

> 확정: 2026-10-19 | 테이블: `schemas/22_webhook_inbox.sql` | 원칙: outbox.md(선점·재시도 — 같은 방식의 반대 방향), notification.md 3-2절(중복은 `ER_DUP_ENTRY` + 키 이름으로 판정), integration.md(외부 입력은 신뢰 경계 밖) | 짝: payment.md(PG 상태 알림), error-alert.md(처리 실패 알림)
> 외부 서비스가 보낸 웹훅은 **원본 바이트로 서명을 검증하고, 수신함에 저장한 뒤 바로 200**을 돌려준다. 처리는 워커가 나중에 한다. 제공사는 같은 이벤트를 여러 번 보낸다 — `(source, event_id)` UNIQUE로 한 번만 저장·처리한다.

## 1. 언제 쓰나

PG 결제 상태·가상계좌 입금, 메신저·협업 도구 이벤트, 외부 SaaS 변경 알림처럼 **상대가 우리에게 POST하는** 연동. 우리가 상대를 호출하는 연동은 integration.md, 우리가 웹훅을 보내는 쪽(공개 API의 구독)은 public-api.md 범위 밖 — 보낼 때도 같은 서명 방식을 쓰면 된다.

### 1-1. 출처 (2026-10-19)

- 서명 방식은 제공사마다 다르다 — **착수 시 제공사 문서의 서명 헤더·서명 대상·허용 시각 오차를 확인해 CLAUDE.md에 기록한다** (MANDATORY).
- 이 레시피의 예시는 Standard Webhooks 방식이다(검색 요약 — 2차 출처): 헤더 `webhook-id`·`webhook-timestamp`·`webhook-signature`, 서명 = `v1,` + base64(HMAC-SHA256(비밀, `{id}.{timestamp}.{원본 본문}`)), 키 교체 중에는 **서명 여러 개를 공백으로 구분**, 시각 오차 허용 **5분(300초)**, `webhook-id`로 중복 제거 권장. Stripe 등 주요 제공사 라이브러리도 기본 허용 오차가 300초라고 소개된다(같은 2차 출처).
- 서명을 제공하지 않는 제공사도 있다 — 그때는 웹훅을 "무언가 바뀌었다"는 신호로만 쓰고, **본문을 믿지 않고 제공사 조회 API로 현재 상태를 다시 읽는다**(3-4절).

## 2. 결정 항목 (기본값)

| 결정 | 기본값 | 대안 / 비고 |
|---|---|---|
| 경로 | `POST /api/webhooks/{source}` — 인증 미들웨어·CSRF 검사 대상에서 제외(서명이 인증) | 제공사가 고정 IP를 공개하면 프록시에서 허용 목록 추가 |
| 서명 비밀 | 환경변수 `WEBHOOK_SECRET_{SOURCE}` — `.env.example`(빈 값)·compose server `environment:`에 함께 추가(ops.md 1절) | 키 교체 중에는 옛·새 두 값을 함께 검증 |
| 응답 | **저장했으면 즉시 200**(이미 받은 이벤트도 200) / 서명·시각 실패 401 / 본문 형식 오류 400 | 처리 결과를 응답에 싣지 않는다 |
| 중복 키 | 제공사 이벤트 ID — 없으면 원본 본문의 sha256 | |
| 처리 | 워커가 수신함을 선점해 처리 — outbox relay와 같은 선점·재시도·실패 알림 | 요청 안에서 처리 — 4절 |
| 보관 | `DONE` 90일 후 삭제 배치(batch.md 3절 실행 이력) | 분쟁·정산 근거로 더 길게 — 처리방침·거래기록 보존 기간 확인 |

## 3. 표준 설계

### 3-1. 원본 바이트 확보 — 전역 파서 하나에서 웹훅 경로만 보관

```js
// app.js — 전역 JSON 파서가 웹훅 경로의 원본 바이트를 req.rawBody에 남긴다
// (라우트에만 express.json({ verify })를 달면 앞선 전역 파서가 이미 본문을 읽어 verify가 실행되지 않는다 — 4절 실측)
app.use(express.json({
  limit: '1mb',
  verify: (req, _res, buf) => { if (req.originalUrl.startsWith('/api/webhooks/')) req.rawBody = buf; },
}));
```

### 3-2. 서명 검증

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

const TOLERANCE_SEC = 300;                                              // 제공사 문서 값으로 (1-1절)

/** 서명 비밀 목록 — 키 교체 중에는 옛·새 둘 다. whsec_ 접두어 뒤는 base64 (제공사 문서로 확인) */
const secretsOf = (source) => [process.env[`WEBHOOK_SECRET_${source}`], process.env[`WEBHOOK_SECRET_${source}_OLD`]]
  .filter(Boolean).map((s) => Buffer.from(s.replace(/^whsec_/, ''), 'base64'));

/**
 * Standard Webhooks 방식 검증 — 원본 바이트로 서명을 다시 계산해 헤더의 서명 중 하나와 일치하면 통과
 * @returns {boolean} false면 401
 */
export function verifyWebhook(source, req) {
  const id = req.get('webhook-id'), ts = Number(req.get('webhook-timestamp')), header = req.get('webhook-signature') ?? '';
  if (!id || !Number.isFinite(ts) || !req.rawBody) return false;
  if (Math.abs(Date.now() / 1000 - ts) > TOLERANCE_SEC) return false;  // 오래된 요청의 재전송(재생) 차단
  const payload = `${id}.${ts}.${req.rawBody.toString('utf8')}`;
  return secretsOf(source).some((key) => {
    const expected = Buffer.from('v1,' + createHmac('sha256', key).update(payload).digest('base64'));
    return header.split(' ').some((sig) => { const got = Buffer.from(sig); return got.length === expected.length && timingSafeEqual(got, expected); });
  });
}
```

### 3-3. 저장하고 즉시 200

```js
router.post('/webhooks/:source', async (req, res) => {
  const source = req.params.source.toUpperCase();
  if (!KNOWN_SOURCES.has(source) || !verifyWebhook(source, req)) return res.status(401).json({ error: 'BAD_SIGNATURE' });
  try {
    await db.query('INSERT INTO webhook_inbox (source, event_id, event_type, payload) VALUES (?, ?, ?, ?)',
      [source, req.get('webhook-id'), String(req.body?.type ?? 'unknown'), req.rawBody.toString('utf8')]);
  } catch (err) {
    // 같은 이벤트 재전송 — 이미 저장했으므로 성공으로 응답 (중복 판정은 키 이름으로 — notification.md 3-2절)
    if (err.code !== 'ER_DUP_ENTRY' || !err.sqlMessage.includes('uq_webhook_inbox_source_event')) throw err;
  }
  res.sendStatus(200);                                                  // 처리 결과와 무관 — 처리는 워커
});
```

### 3-4. 처리 워커

- 선점: outbox.md 3-3절의 2단계를 그대로 쓴다 — ① 후보 조회(`status IN ('RECEIVED', 'FAILED') AND attempt_count < 5`, 또는 `PROCESSING`인데 `locked_until`이 지난 행) ② `locked_by = :run_id`, `locked_until`, `attempt_count + 1`을 조건부 UPDATE로 선점하고 `locked_by = :run_id`인 행만 처리. 한 문장 UPDATE(같은 테이블 서브쿼리)는 MySQL에서 ERROR 1093 (outbox.md 4절).
- 핸들러는 `event_type`별 함수. **핸들러 자체도 멱등**이어야 한다 — 상태 전이는 조건부 UPDATE(payment.md `markPaid`처럼 0행이면 생략).
- **순서를 믿지 않는다** — 제공사는 순서를 보장하지 않고 재전송은 늦게 도착한다. "취소" 뒤에 늦은 "승인"이 와도 되돌아가지 않게: 조건부 전이로 막거나, 핸들러가 **제공사 조회 API로 현재 상태를 읽어** 그 상태로 맞춘다(서명 없는 제공사는 항상 이 방식).
- 성공 `DONE` + `processed_at`, 실패 `FAILED` + `last_error`, `attempt_count` 상한 도달은 error-alert.md로 알림.

- 실측 2026-10-19 (Node 22 · Express 4.22 + MariaDB 10.11·MySQL 8.0.46):

| 상황 | 결과 |
|---|---|
| 파싱한 객체를 `JSON.stringify`해서 검증 | **401** — 원본의 공백·키 순서가 사라져 서명 불일치 |
| 원본 바이트로 검증 | 200 |
| 10분 전 서명을 그대로 재전송 | 401(허용 오차 밖) |
| 본문 금액만 바꿈(서명은 원래 것) | 401 |
| 같은 이벤트 재전송, 중복 제거 없음 | **두 번 처리** |
| 제공사 동작(3초 안에 200이 없으면 재전송, 최대 4회) + 요청 안에서 5초 처리 | **제공사 4회 전송·우리 4회 처리, 성공 응답은 한 번도 못 받음** |
| 같은 조건 + 수신함 저장 후 즉시 200 | 1회 전송, 31ms 응답, 수신함 1건 |
| 같은 이벤트 2회 INSERT | 2번째 `ER_DUP_ENTRY` — 행 1개 유지, 다른 `source`의 같은 ID는 별개 행 |
| 키 교체 중 서명 2개 헤더 | 통과, 모르는 키의 서명은 거부 |

## 4. 함정 (STRICT)

| 함정 | 증상 | 처방 |
|---|---|---|
| 파싱 후 재직렬화한 본문으로 검증 | **정상 웹훅이 전부 401** (실측) | 원본 바이트 (3-1절) |
| 전역 `express.json()` 뒤에 라우트 `express.json({ verify })` | **`rawBody`가 없다** — 앞선 파서가 본문을 이미 읽었다 (실측) | 전역 파서의 `verify`에서 웹훅 경로만 보관, 또는 웹훅 라우트를 전역 파서보다 먼저 |
| 요청 안에서 처리(정산·메일·외부 호출) | 제공사 타임아웃 → **재전송마다 다시 처리** (실측: 4회) | 저장 후 즉시 200, 워커 처리 |
| 중복 제거 없음 | 같은 이벤트 이중 처리 (실측) | `(source, event_id)` UNIQUE |
| `ON DUPLICATE KEY UPDATE`의 affectedRows로 중복 판정 | mysql2 기본 설정에서 새 행·중복 모두 1 (실측 — notification.md 4절과 같은 결과) | 일반 INSERT + `ER_DUP_ENTRY` + 키 이름 |
| 시각 검사 없음 | 가로챈 요청을 나중에 재전송해도 통과 | 허용 오차(300초) |
| `===`로 서명 비교 | 비교 시간 차이로 서명 추측 여지 | `timingSafeEqual`(길이 먼저 비교) |
| 이벤트 순서를 믿고 상태를 덮어씀 | 늦게 온 옛 이벤트가 최신 상태를 되돌린다 | 조건부 전이 또는 조회 API로 현재 상태 |
| 서명 없는 웹훅 본문을 믿음 | 위조 요청으로 결제 완료·권한 변경 | 신호로만 쓰고 조회 API로 확인 |
| 웹훅 경로에 인증·CSRF 미들웨어 | 제공사 요청이 전부 401·403 | 경로 제외 + 서명 검증 필수 |

## 5. 스택별 구현

| 구성 | Express | Spring |
|---|---|---|
| 원본 바이트 | 전역 `express.json({ verify })` 경로 한정 (3-1절, 실측) | 컨트롤러 파라미터 `@RequestBody byte[] body`(또는 `String`) — 객체로 받지 않는다 (이 레시피에서 미검증) |
| 서명 | `createHmac` + `timingSafeEqual` | `Mac`(HmacSHA256) + `MessageDigest.isEqual` |
| 중복 | `ER_DUP_ENTRY` + 키 이름 | `DuplicateKeyException` + 키 이름 |
| 워커 | outbox relay와 같은 프로세스·같은 선점 방식 | `@Scheduled` 선점 루프 |
| 보안 설정 | 인증 미들웨어 제외 목록에 `/api/webhooks/` | `SecurityFilterChain`에서 `permitAll` + CSRF 제외 |

## 6. 검증 포인트

- 자동화 테스트: 3-4절 표의 상황 — 재직렬화 검증 실패를 회귀 테스트로 남기려면 **공백이 있는 원본 본문**으로 서명한다 / 같은 이벤트 2회 → 수신함 1건·처리 1회 / 순서 뒤바뀐 이벤트(취소 → 늦은 승인) → 최종 상태 유지.
- 제공사 테스트 환경: 대시보드의 "웹훅 다시 보내기"로 재전송 → 처리 1회, 서명 비밀을 틀리게 설정 → 401이 제공사 대시보드 실패 기록으로 보이는지.
- 운영: 수신함의 `FAILED`·오래된 `RECEIVED` 건수를 상태 화면 또는 알림으로 본다.
