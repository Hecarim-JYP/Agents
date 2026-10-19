/*
 * 파일명 : 21_inquiry.sql
 * 용도 : 1:1 문의 접수·답변(대화형)과 게시물·사용자 신고
 *        (conventions/features/inquiry.md — 상태 전이·담당 배정·신고 누적 규칙의 단일 출처)
 * 최초등록 : 2026-10-19 [박진영]
 * 참고 : 문의 상태 전이는 state-machine.md 방식(조건부 UPDATE)으로만 바꾼다
 *        첨부는 03_files.sql (module_type = 'inquiry', reference_id = inquiry_message_id) — 업로드 검사는 upload-security.md
 *        비회원 문의는 user_id NULL + 회신 이메일 — 문의 처리 후 보관 기간이 끝나면 파기 대상이다 (inquiry.md 2절)
 *        신고는 (신고자, 대상) UNIQUE — 같은 사람이 여러 번 눌러도 1건, 동시에 눌러도 1건
 */

CREATE TABLE IF NOT EXISTS inquiry (
    inquiry_id        BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    public_id         CHAR(21) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,   -- 문의 조회 URL용 (public-id.md)
    user_id           BIGINT UNSIGNED NULL,            -- 비회원 문의면 NULL
    guest_email       VARCHAR(255) NULL,               -- 비회원 회신 주소
    category          VARCHAR(30)  NOT NULL,           -- 공통코드 (예: ACCOUNT / PAYMENT / BUG / ETC)
    title             VARCHAR(200) NOT NULL,
    status            VARCHAR(20)  NOT NULL DEFAULT 'RECEIVED',   -- RECEIVED / IN_PROGRESS / ANSWERED / CLOSED
    assignee_id       BIGINT UNSIGNED NULL,            -- 담당 직원 (user_id)
    first_answered_at DATETIME     NULL,               -- 첫 답변 시각 — 응답 소요 시간 집계
    closed_at         DATETIME     NULL,
    version           INT          NOT NULL DEFAULT 0, -- 담당 배정·상태 변경 동시성 (sql.md 8절)
    created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME     NULL ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_inquiry_public_id (public_id),
    KEY idx_inquiry_status (status, created_at),
    KEY idx_inquiry_user (user_id, created_at),
    KEY idx_inquiry_assignee (assignee_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS inquiry_message (
    inquiry_message_id  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    inquiry_id          BIGINT UNSIGNED NOT NULL,
    author_type         VARCHAR(10) NOT NULL,          -- CUSTOMER / STAFF
    author_id           BIGINT UNSIGNED NULL,          -- 비회원 고객이면 NULL
    body                TEXT        NOT NULL,          -- 화면 표시는 이스케이프 — HTML로 저장·렌더링하지 않는다
    is_internal_note    TINYINT(1)  NOT NULL DEFAULT 0, -- 직원 내부 메모 — 고객 조회 API에서 제외
    created_at          DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_inquiry_message_inquiry (inquiry_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS content_report (
    content_report_id  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    reporter_id        BIGINT UNSIGNED NOT NULL,
    target_type        VARCHAR(20)  NOT NULL,          -- POST / COMMENT / USER 등
    target_id          BIGINT UNSIGNED NOT NULL,
    reason             VARCHAR(30)  NOT NULL,          -- 공통코드 (SPAM / ABUSE / ILLEGAL / PRIVACY / ETC)
    detail             VARCHAR(1000) NULL,
    status             VARCHAR(20)  NOT NULL DEFAULT 'RECEIVED',  -- RECEIVED / ACCEPTED / REJECTED
    handled_by         BIGINT UNSIGNED NULL,
    handled_at         DATETIME     NULL,
    created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_content_report_reporter_target (reporter_id, target_type, target_id),
    KEY idx_content_report_target (target_type, target_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
