/*
 * 파일명 : 25_privacy_request.sql
 * 용도 : 정보주체의 열람·정정·삭제·처리정지·동의 철회 요구(열람등요구)의 접수·기한·처리 결과
 *        (conventions/features/privacy-rights.md — 기한 계산·처리·통지 규칙의 단일 출처)
 * 최초등록 : 2026-10-19 [박진영]
 * 참고 : 처리 기한은 받은 날부터 10일(개인정보 보호법 시행령 제41조·제43조·제44조) — 초일 불산입, 말일이 토요일·공휴일이면
 *        다음 날 (민법 제157·161조). due_date는 접수 시 계산해 저장하고, 기한 임박·초과는 배치가 알린다
 *        연기·거절은 사유를 정보주체에게 알려야 한다 — 그 통지도 이 행에 남긴다 (privacy-rights.md 3절)
 */

CREATE TABLE IF NOT EXISTS privacy_request (
    privacy_request_id  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    public_id           CHAR(21) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,   -- 정보주체 조회용 (public-id.md)
    user_id             BIGINT UNSIGNED NULL,           -- 회원이면 본인 확인은 로그인으로 — 비회원 요구면 NULL
    requester_name      VARCHAR(100) NULL,              -- 대리인 요구 시 대리인 (법 제38조 ①)
    request_type        VARCHAR(20)  NOT NULL,          -- ACCESS / CORRECTION / DELETION / SUSPENSION / WITHDRAW_CONSENT
    detail              TEXT         NULL,              -- 요구 내용 (정정할 항목 등)
    identity_method     VARCHAR(30)  NOT NULL,          -- LOGIN / EMAIL_VERIFIED / AGENT_DOCUMENT
    received_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    due_date            DATE         NOT NULL,          -- 처리 기한 (접수 시 계산)
    status              VARCHAR(20)  NOT NULL DEFAULT 'RECEIVED',  -- RECEIVED / IN_PROGRESS / DONE / REJECTED / DEFERRED
    result_summary      VARCHAR(1000) NULL,             -- 처리 결과 (열람 제공 범위, 정정·삭제한 항목)
    reason              VARCHAR(1000) NULL,             -- 거절·연기·일부 제한 사유 (정보주체에게 알린 문구)
    handled_by          BIGINT UNSIGNED NULL,
    completed_at        DATETIME     NULL,
    notified_at         DATETIME     NULL,              -- 결과 통지 시각 — 기한 판정 기준
    version             INT          NOT NULL DEFAULT 0,
    UNIQUE KEY uq_privacy_request_public_id (public_id),
    KEY idx_privacy_request_due (status, due_date),
    KEY idx_privacy_request_user (user_id, received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
