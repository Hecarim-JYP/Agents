/*
 * 파일명 : 12_error_event.sql
 * 용도 : 서버 에러 집계 — 같은 원인(지문)의 에러를 한 행으로 모아 횟수를 세고, 알림을 시간당 한 번으로 묶는다
 *        (conventions/features/error-alert.md — 지문 규칙·알림 억제의 단일 출처)
 * 최초등록 : 2026-10-14 [박진영]
 * 참고 : 집계 테이블이라 version·소프트삭제 컬럼이 없다. 메시지·경로에 개인정보·실제 ID를 넣지 않는다
 */

CREATE TABLE IF NOT EXISTS error_event (
    error_event_id    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    fingerprint       CHAR(64) NOT NULL,               -- sha256(에러 종류 + 에러 코드 + 라우트 템플릿 + 첫 스택 프레임)
    error_name        VARCHAR(200) NOT NULL,           -- 예: TypeError, DataAccessException
    error_code        VARCHAR(100) NULL,               -- 드라이버·앱 에러 코드 (예: ER_LOCK_WAIT_TIMEOUT)
    route             VARCHAR(300) NULL,               -- 라우트 템플릿 (/orders/:id) — 실제 값 금지
    sample_message    VARCHAR(1000) NULL,              -- 최근 메시지 1건 (개인정보 금지)
    occurrence_count  INT NOT NULL DEFAULT 1,
    first_seen_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_request_id   VARCHAR(64) NULL,                -- 최근 발생 요청 ID — 로그 검색 (features/request-id.md)
    last_alerted_at   DATETIME NULL,                   -- 알림 억제 기준 시각
    resolved_at       DATETIME NULL,                   -- 처리 완료 표시 — 다시 발생하면 NULL로 되돌려 재발 알림
    UNIQUE KEY uq_error_event_fingerprint (fingerprint),
    KEY idx_error_event_last_seen (last_seen_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
