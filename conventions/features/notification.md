# 레시피: 알림 발송 `[공통]`

> 확정: 2026-10-14 | 테이블: `schemas/10_notification.sql`(화면 알림함) + `schemas/07_outbox.sql`(외부 채널) | 짝: outbox.md, idempotency.md
> 업무 사건(결재 요청, 반려, 마감 임박…)을 사람에게 알린다. **화면 알림은 업무와 같은 트랜잭션에 넣고, 메일·메신저는 outbox로 보낸다.** 같은 사건을 같은 사람에게 두 번 보내지 않는다.

## 1. 언제 쓰나

| 채널 | 수단 | 근거 |
|---|---|---|
| 화면 알림(종 아이콘·알림함) | `notification` 테이블에 **업무와 같은 트랜잭션**으로 INSERT | 행 하나 넣는 값싼 작업이고, 업무가 롤백되면 알림도 없어야 한다 |
| 메일·사내 메신저·SMS | **outbox 적재**(`target_system='MAIL'` 등) → relay가 발송·재시도 (outbox.md) | 외부 시스템 호출이라 트랜잭션에 묶을 수 없다 — 놓치면 안 되는 알림이면 outbox, 놓쳐도 되면 도메인 이벤트(domain-event.md 1절) |

## 2. 결정 항목 (기본값)

| 결정 | 기본값 | 대안 / 비고 |
|---|---|---|
| 채널 | 화면 알림 + 메일 | 사내 메신저가 있으면 메일 대신 또는 추가 (target_system 하나 추가) |
| 문구 템플릿 위치 | **코드**(유형별 템플릿 모듈) — 버전 관리·리뷰 대상 | 운영자가 문구를 직접 고쳐야 하면 DB 템플릿 (변수 검증 필요) |
| 다국어 | 다국어 프로젝트면 수신자 locale로 렌더링 (i18n.md 4절) | |
| 화면 갱신 | **폴링** — 안 읽은 수 60초 간격 + 창 포커스 시 즉시 | 실시간이 필요하면 SSE. 단일 인스턴스 전제라 다중화 전환 목록에 기록 (patterns.md 0-3절) |
| 수신 설정 | 화면 알림은 끌 수 없음, 메일은 기본 수신 | 유형별 수신 거부가 필요해지면 `notification_setting` 테이블 추가 |
| 보관 | 화면 알림 **90일** 후 정리 배치 | |

## 3. 표준 설계

### 3-1. 사건 키와 중복 방지

같은 사건이 두 번 처리돼도(재시도·재실행·더블클릭) 알림은 한 번이어야 한다. **사건 키**를 정해 SHA-256으로 64자 hex를 만들고 UNIQUE로 막는다 — 화면 알림 `dedupe_key`, 외부 채널은 outbox `message_key`에 같은 방식으로 쓴다.

```
사건 키 = {채널}:{알림 유형}:{원천 테이블}:{원천 PK}:{수신자 ID}:{구분자}
예) WEB:APPROVAL_REQUESTED:approval_line:57:1023:1
    MAIL:APPROVAL_REQUESTED:approval_line:57:1023:1
    MAIL:APPROVAL_REMIND:approval_line:57:1023:2026-10-15   ← 리마인드는 날짜가 구분자 — 하루 한 번
```

- 구분자는 "정당하게 다시 보내야 하는 경우"를 가른다: 결재 단계마다 다른 `approval_line_id`, 재상신은 새 요청이므로 새 키. **현재 시각·난수는 넣지 않는다** — 넣는 순간 재시도마다 새 키가 된다.
- 중복이면 INSERT가 `ER_DUP_ENTRY`로 실패한다 — **키 이름(`uq_notification_dedupe`·`uq_outbox_message_key`)으로 확인하고 건너뛴다**. MariaDB/MySQL은 실패한 문장만 되돌리므로 같은 트랜잭션의 업무 변경은 그대로 커밋된다 (실측 2026-10-14).

### 3-2. 적재

```js
/**
 * 알림 적재 — 화면 알림은 바로 INSERT, 메일은 outbox. 같은 사건·수신자의 중복은 조용히 건너뛴다
 * @param {object} conn 업무와 같은 트랜잭션의 연결
 * @param {{ type: string, recipients: Array<{ userId: number, email: string, locale?: string }>,
 *           source: { table: string, id: number }, discriminator: string|number, params: object }} n 알림 사건
 */
export async function notify(conn, n) {
  for (const r of n.recipients) {
    const { title, body, linkPath } = renderTemplate(n.type, n.params, r.locale);   // 적재 시점 문구로 동결
    const key = (ch) => sha256Hex([ch, n.type, n.source.table, n.source.id, r.userId, n.discriminator].join(':'));
    await insertIgnoringDuplicate(conn, 'uq_notification_dedupe', () => insertNotification(conn, {
      userId: r.userId, type: n.type, title, body, linkPath,
      aggregateType: n.source.table, aggregateId: n.source.id, dedupeKey: key('WEB'),
    }));
    await insertIgnoringDuplicate(conn, 'uq_outbox_message_key', () => enqueueOutbox(conn, {
      messageKey: key('MAIL'), targetSystem: 'MAIL', messageType: n.type,
      aggregateType: n.source.table, aggregateId: n.source.id,
      payload: { to: r.email, subject: title, body, linkPath },     // relay가 업무 테이블을 몰라도 보낼 수 있게 (outbox.md 3-2절)
    }));
  }
}

/** 지정한 UNIQUE 키 위반만 "이미 보냄"으로 보고 건너뛴다 — 다른 오류는 그대로 던진다 */
async function insertIgnoringDuplicate(conn, keyName, insert) {
  try { await insert(); }
  catch (err) { if (err.code !== 'ER_DUP_ENTRY' || !err.sqlMessage.includes(keyName)) throw err; }
}
```

### 3-3. 메일 렌더링·발송

- 메일 본문의 사용자 입력(문서 제목·의견)은 **HTML 이스케이프**한다 — 자동 이스케이프 템플릿 엔진을 쓰거나 직접 이스케이프.
- 링크는 `APP_BASE_URL`(환경변수, 폴백 금지 — patterns.md 4절) + `link_path`로 relay가 발송 시 조립한다. 화면 알림에는 상대 경로만 저장한다(도메인이 바뀌어도 유효).
- SMTP 주소·계정은 환경변수(`SMTP_HOST` 등). 사내 메일 서버의 분당 발송 제한이 있으면 relay의 MAIL 묶음 크기로 맞춘다.
- 외부 수신자에게 보내면 발송 도메인의 SPF·DKIM·DMARC를 갖춘다(features/mail-domain-auth.md). **광고성 정보(이벤트·쿠폰)는 이 레시피가 아니라 features/marketing-message.md** — 수신 동의·야간 제한·"(광고)" 표기·수신거부가 법정 요건이다.

### 3-4. 화면

- 안 읽은 수: `SELECT COUNT(*) FROM notification WHERE user_id = :me AND read_at IS NULL` (인덱스 `idx_notification_user`).
- 읽음 처리: `UPDATE notification SET read_at = NOW() WHERE notification_id = :id AND user_id = :me AND read_at IS NULL` — **`user_id` 조건 필수**(남의 알림을 읽음 처리하는 IDOR 방지 — auth.md 4-2절).
- 알림 클릭 → `link_path`로 이동. 이동한 화면에서 권한이 없으면 403이 정상이다(알림이 권한을 주지 않는다).

## 4. 함정 (STRICT)

| 함정 | 증상 | 처방 |
|---|---|---|
| `INSERT IGNORE`로 중복 무시 | 중복 외의 오류(길이 초과 등)도 **경고로 바뀌어 잘린 값이 저장된다** (실측: 5자 컬럼에 10자 → `"01234"` 저장, 경고 1) | 일반 INSERT + 키 이름으로 중복만 판정 (3-2절) |
| `ON DUPLICATE KEY UPDATE`의 affectedRows로 중복 판정 | mysql2 기본 설정에서 **처음 넣을 때와 중복일 때 모두 1** — 구분이 안 된다 (실측) | 3-2절 방식 |
| 사건 키에 현재 시각·난수 포함 | 재시도·재실행마다 새 키 → 중복 발송 | 구분자는 업무 값으로 (3-1절) |
| 메일을 업무 트랜잭션 안에서 직접 SMTP 발송 | 메일 서버가 느리면 업무가 느려지고, 롤백돼도 메일은 이미 나갔다 | outbox |
| 메일 본문에 사용자 입력 그대로 | 메일 클라이언트에서 스크립트·위장 링크 | HTML 이스케이프 |
| 링크에 `localhost`·IP 하드코딩 | 운영 메일의 링크가 개발 서버로 간다 | `APP_BASE_URL` |
| 읽음 처리에 `user_id` 조건 없음 | ID만 바꿔 남의 알림을 조작 | 3-4절 |
| 문구를 표시할 때마다 템플릿으로 다시 렌더링 | 템플릿이 바뀌면 과거 알림 문구도 바뀐다 | 적재 시점에 렌더링해 저장 |

## 5. 스택별 구현

| 구성 | Express | Spring |
|---|---|---|
| 해시 | `crypto.createHash('sha256').update(key).digest('hex')` | `MessageDigest.getInstance("SHA-256")` → hex |
| 중복 판정 | `err.code === 'ER_DUP_ENTRY'` + 키 이름 | `DuplicateKeyException` + 키 이름 |
| 메일 발송(relay) | nodemailer — `external/mail/` 클라이언트 (integration.md 2절) | `JavaMailSender` — `external/mail/` |
| 템플릿 | 유형별 함수 모듈 (`notificationTemplates.js`) | 유형별 메서드 또는 Thymeleaf(자동 이스케이프) |

## 6. 검증 포인트

- 자동화 테스트(테스트 DB): 같은 사건 2회 → 화면 알림 1건·outbox 1건 / 업무 롤백 → 알림 0건 / 다른 사용자 알림 읽음 처리 → 0행 / 문서 제목에 `<script>` → 메일 본문에서 이스케이프.
- 실동작 검증(/live-test 관찰자 모드): 결재 상신 → 결재자 화면에 알림(폴링 주기 안에) → 메일이 테스트 수신함에 도착, 링크가 `APP_BASE_URL` 기준인지.
