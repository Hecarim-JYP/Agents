/*
 * 파일명 : 22_webhook_inbox.sql
 * 용도 : 외부에서 받은 웹훅의 수신함 — 서명 검증 직후 저장하고 즉시 200, 처리는 워커가 나중에
 *        (conventions/features/webhook-receive.md — 검증·중복 제거·처리 규칙의 단일 출처)
 * 최초등록 : 2026-10-19 [박진영]
 * 참고 : (source, event_id) UNIQUE — 제공사가 같은 이벤트를 다시 보내도(타임아웃·재시도) 한 번만 저장·처리된다
 *        처리 상태 전이·선점은 outbox(07_outbox.sql)와 같은 방식 — 후보 조회 → locked_by·locked_until 조건부 UPDATE
 *        payload는 원본 그대로(서명 검증에 쓴 바이트) — 재처리·분쟁 조사 때 근거가 된다. 보관 기간이 지나면 배치로 삭제
 */

CREATE TABLE IF NOT EXISTS webhook_inbox (
    webhook_inbox_id  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    source            VARCHAR(30)  NOT NULL,           -- 보낸 곳 (예: TOSS_PAYMENTS, KAKAO)
    event_id          VARCHAR(100) NOT NULL,           -- 제공사의 이벤트 ID (없으면 본문 sha256)
    event_type        VARCHAR(60)  NOT NULL,
    payload           MEDIUMTEXT   NOT NULL,           -- 원본 본문
    status            VARCHAR(20)  NOT NULL DEFAULT 'RECEIVED',   -- RECEIVED / PROCESSING / DONE / FAILED
    attempt_count     INT          NOT NULL DEFAULT 0,
    locked_by         VARCHAR(100) NULL,               -- 선점한 워커의 run_id (outbox.md 3-3절)
    locked_until      DATETIME     NULL,
    last_error        VARCHAR(1000) NULL,
    received_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processed_at      DATETIME     NULL,
    UNIQUE KEY uq_webhook_inbox_source_event (source, event_id),
    KEY idx_webhook_inbox_status (status, received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
