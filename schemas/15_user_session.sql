/*
 * 파일명 : 15_user_session.sql
 * 용도 : 로그인 세션 — 기기(브라우저)별 refresh 토큰 상태. 동시 로그인 정책·기기별 강제 종료·refresh 회전의 근거
 *        (conventions/features/session-control.md — 회전·유예·종료 규칙의 단일 출처)
 * 최초등록 : 2026-10-14 [박진영]
 * 참고 : 사용자의 모든 토큰 일괄 무효화는 user.token_version(01_auth.sql)이 담당한다 — 이 테이블은 기기 단위
 *        refresh 토큰 원문은 저장하지 않는다 (sha256 해시만)
 */

CREATE TABLE IF NOT EXISTS user_session (
    user_session_id     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    session_key         CHAR(36) NOT NULL,             -- 토큰에 싣는 세션 식별자(sid) — 순차 PK를 노출하지 않는다
    user_id             BIGINT UNSIGNED NOT NULL,
    refresh_token_hash  CHAR(64) NOT NULL,             -- 현재 refresh 토큰의 sha256
    prev_token_hash     CHAR(64) NULL,                 -- 직전 토큰 — 회전 직후 유예 시간 동안만 인정 (여러 탭 동시 갱신)
    rotated_at          DATETIME NULL,
    user_agent          VARCHAR(300) NULL,             -- "내 로그인 기기" 표시용
    ip_address          VARCHAR(45) NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_used_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at          DATETIME NOT NULL,             -- 절대 만료 — 회전해도 늘어나지 않는다
    revoked_at          DATETIME NULL,
    revoked_reason      VARCHAR(30) NULL,              -- LOGOUT / NEW_LOGIN / ADMIN / PASSWORD_CHANGED / REUSE_DETECTED
    UNIQUE KEY uq_user_session_key (session_key),
    KEY idx_user_session_user (user_id, revoked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
