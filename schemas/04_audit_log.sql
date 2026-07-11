/*
 * 파일명 : 04_audit_log.sql
 * 용도 : 감사 로그 — 권한 변경, 계정 잠금, 중요 데이터 변경 등 책임 추적이 필요한 행위 기록 (auth.md 5절)
 * 최초등록 : 2026-07-12 [박진영]
 * 참고 : 로그인 이력은 01_auth.sql의 login_history가 별도 담당
 */

CREATE TABLE IF NOT EXISTS audit_log (
    audit_log_id  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id       BIGINT UNSIGNED NOT NULL,            -- 행위자 (req.user 신뢰값)
    action        VARCHAR(100) NOT NULL,               -- 행위 코드 (예: role.assign_permission, user.lock)
    target_type   VARCHAR(50),                         -- 대상 유형 (예: user, role)
    target_id     BIGINT UNSIGNED,                     -- 대상 PK
    detail        TEXT,                                -- 변경 전/후 등 상세 (JSON 문자열)
    ip_address    VARCHAR(45),
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_audit_log_user (user_id, created_at),
    KEY idx_audit_log_target (target_type, target_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
