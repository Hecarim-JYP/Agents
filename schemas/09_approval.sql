/*
 * 파일명 : 09_approval.sql
 * 용도 : 자체 결재 — 결재 요청(업무 문서 1건의 상신 1회) · 결재선(순차 결재/합의/참조) · 대결 위임
 *        (conventions/features/approval.md — 처리 규칙·동시성·스냅샷의 단일 출처)
 *        자체 결재를 쓰는 프로젝트만 복사한다 — 사내 전자결재 연동이면 쓰지 않는다 (approval.md 2절)
 * 최초등록 : 2026-10-14 [박진영]
 * 참고 : 반려 후 재상신은 새 approval_request 행이다 — 결재 1회의 기록은 끝난 뒤 바뀌지 않는다
 *        결재자·처리자의 이름·부서·직급은 스냅샷(JSON)으로 동결한다 (auth.md 5절)
 */

CREATE TABLE IF NOT EXISTS approval_request (
    approval_request_id  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    aggregate_type       VARCHAR(100) NOT NULL,          -- 결재 대상 업무 테이블명
    aggregate_id         BIGINT UNSIGNED NOT NULL,       -- 결재 대상 업무 행 PK
    title                VARCHAR(200) NOT NULL,
    status               VARCHAR(20) NOT NULL DEFAULT 'IN_PROGRESS',  -- IN_PROGRESS / APPROVED / REJECTED / WITHDRAWN
    current_seq          INT NOT NULL DEFAULT 1,         -- 지금 차례인 결재선 순서
    document_snapshot    JSON NOT NULL,                  -- 상신 시점 문서 내용 동결 — 결재한 것이 무엇이었는지
    requested_by         BIGINT NOT NULL,                -- 기안자
    requested_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at         DATETIME NULL,                  -- 최종 승인·반려·회수 시각
    version              INT NOT NULL DEFAULT 0,
    created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by           BIGINT,
    updated_at           DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
    updated_by           BIGINT,
    KEY idx_approval_request_aggregate (aggregate_type, aggregate_id),
    KEY idx_approval_request_requester (requested_by, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS approval_line (
    approval_line_id     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    approval_request_id  BIGINT UNSIGNED NOT NULL,       -- 논리 FK (database.md 5절)
    seq                  INT NOT NULL,                   -- 결재 순서 1..n — 참조(REFERENCE)는 0
    line_type            VARCHAR(20) NOT NULL,           -- APPROVE(결재) / AGREE(합의) / REFERENCE(참조 — 열람만)
    approver_id          BIGINT NOT NULL,                -- 지정 결재자
    approver_snapshot    JSON NOT NULL,                  -- 지정 당시 이름·부서·직급
    status               VARCHAR(20) NOT NULL DEFAULT 'WAITING',  -- WAITING / PENDING(내 차례) / APPROVED / REJECTED / SKIPPED
    acted_by             BIGINT NULL,                    -- 실제 처리자 — 대결이면 대리인
    acted_snapshot       JSON NULL,                      -- 처리 시점 처리자 이름·부서·직급 (+ 대결이면 원 결재자)
    comment              VARCHAR(1000) NULL,             -- 결재 의견·반려 사유
    acted_at             DATETIME NULL,
    created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_approval_line_request (approval_request_id, seq),
    KEY idx_approval_line_inbox (approver_id, status)        -- 내 결재함
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS approval_delegation (
    approval_delegation_id  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    delegator_id            BIGINT NOT NULL,             -- 위임자 (원 결재자)
    delegate_id             BIGINT NOT NULL,             -- 대리 결재자
    start_at                DATETIME NOT NULL,
    end_at                  DATETIME NOT NULL,
    reason                  VARCHAR(200) NULL,           -- 출장·휴가 등
    is_active               TINYINT(1) NOT NULL DEFAULT 1,
    deleted_at              DATETIME NULL,
    deleted_by              BIGINT,
    created_at              DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by              BIGINT,
    updated_at              DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
    updated_by              BIGINT,
    KEY idx_approval_delegation_delegator (delegator_id, is_active, start_at, end_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
