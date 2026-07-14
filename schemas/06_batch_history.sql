/*
 * 파일명 : 06_batch_history.sql
 * 용도 : 배치 실행 이력 — 조용한 실패 방지 (batch.md 3절)
 *        정기 배치가 있는 프로젝트만 복사한다 (시작 결정 체크리스트)
 * 최초등록 : 2026-07-14 [박진영]
 * 참고 : 실패 시 알림 경로를 반드시 연결한다 — 이 테이블은 사후 추적용이지 알림 수단이 아니다
 */

CREATE TABLE IF NOT EXISTS batch_history (
    batch_history_id  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    batch_name        VARCHAR(100) NOT NULL,           -- 배치 식별명 (예: DAILY_AGGREGATE, HQ_USER_SYNC)
    target_date       DATE NULL,                       -- 처리 대상 기준일 (재실행 시 인자 — batch.md 4절)
    started_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at       DATETIME NULL,
    status            VARCHAR(20) NOT NULL DEFAULT 'RUNNING',  -- RUNNING / SUCCESS / FAILED
    processed_count   INT NOT NULL DEFAULT 0,
    failed_count      INT NOT NULL DEFAULT 0,
    error_message     VARCHAR(1000),                   -- 실패 사유 (스택은 로그로 — 민감정보 금지)
    created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_batch_history_name (batch_name, started_at),
    KEY idx_batch_history_status (status, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
