/*
 * 파일명 : 11_async_job.sql
 * 용도 : 장시간 작업 대기열 — 요청은 즉시 접수(202)하고 워커가 처리, 화면은 상태·진행률을 조회한다
 *        (conventions/features/long-running-job.md — 선점·취소·결과 보관 규칙의 단일 출처)
 *        장시간 작업(대용량 생성·일괄 재계산 등)이 있는 프로젝트만 복사한다
 * 최초등록 : 2026-10-14 [박진영]
 * 참고 : active_key — 같은 사용자의 같은 요청이 처리 중이면 UNIQUE로 두 번째 접수를 막는다(끝나면 NULL이 되어 다시 요청 가능)
 *        생성 열(AS … STORED)로 만들지 않는다 — MariaDB 10.11이 상태 조건 식을 ERROR 1901로 거부한다 (2026-10-14 실측)
 *        선점은 outbox와 같은 방식(조건부 UPDATE + locked_until) — features/outbox.md 3-3절
 */

CREATE TABLE IF NOT EXISTS async_job (
    async_job_id     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    job_type         VARCHAR(50) NOT NULL,             -- 예: SALES_ORDER_EXPORT, PRICE_RECALC
    params           JSON NOT NULL,                    -- 검증을 마친 요청 조건
    params_hash      CHAR(64) NOT NULL,                -- sha256(job_type + 정규화한 params) — 같은 요청 판별
    status           VARCHAR(20) NOT NULL DEFAULT 'QUEUED',  -- QUEUED / RUNNING / CANCEL_REQUESTED / SUCCEEDED / FAILED / CANCELLED
    progress_done    INT NOT NULL DEFAULT 0,
    progress_total   INT NULL,
    result_file_id   BIGINT UNSIGNED NULL,             -- 결과 파일 (03_files.sql) — 논리 FK
    error_message    VARCHAR(1000) NULL,               -- 사용자에게 보여줄 실패 사유 (스택은 로그로)
    locked_by        VARCHAR(100) NULL,                -- 선점한 워커 실행 식별자
    locked_until     DATETIME NULL,                    -- 선점 만료 — 워커가 죽으면 이 시각 뒤 정리 대상
    requested_by     BIGINT NOT NULL,
    started_at       DATETIME NULL,
    finished_at      DATETIME NULL,
    expires_at       DATETIME NULL,                    -- 결과 파일 보관 만료 — 정리 배치가 파일과 함께 지운다
    active_key       VARCHAR(200) NULL,                -- 처리 중일 때만 '{requested_by}:{job_type}:{params_hash}', 끝나면 NULL (앱이 상태와 같은 UPDATE에서 관리)
    created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_async_job_active (active_key),
    KEY idx_async_job_status (status, created_at),
    KEY idx_async_job_requester (requested_by, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
