/*
 * 파일명 : 16_account_token.sql
 * 용도 : 계정 확인용 일회성 토큰·코드 — 가입 이메일 인증, 비밀번호 재설정, 이메일·휴대폰 인증
 *        (conventions/features/account-lifecycle.md — 발급·소비·시도 제한 규칙의 단일 출처)
 * 최초등록 : 2026-10-16 [박진영]
 * 참고 : 원문은 저장하지 않는다 — 링크 토큰(32바이트 랜덤)은 sha256, 6자리 코드는 HMAC-SHA256(서버 비밀, purpose:target:code).
 *        6자리 코드는 경우의 수가 100만뿐이라 단순 해시는 DB가 새면 바로 역산된다 → 서버 비밀이 들어간 HMAC
 *        token_hash에 UNIQUE를 걸지 않는다 — 코드 방식은 같은 대상에 같은 코드가 다시 나올 수 있다(재발급)
 *        소비·시도 횟수는 조건부 UPDATE로만 바꾼다 (account-lifecycle.md 3-2·3-4절 — 동시 요청에서 한도가 무너지지 않게)
 *        자체 가입 프로젝트는 01_auth.sql의 user에 email_verified_at DATETIME NULL을 추가한다
 *        만료 후 30일 지난 행은 정기 배치로 삭제한다 (request_ip는 개인정보 — 짧게 보관)
 */

CREATE TABLE IF NOT EXISTS account_token (
    account_token_id  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    purpose           VARCHAR(30)  NOT NULL,           -- SIGNUP_EMAIL / PASSWORD_RESET / EMAIL_CHANGE / PHONE_VERIFY
    user_id           BIGINT UNSIGNED NULL,            -- 가입 전 인증(휴대폰 등)이면 NULL
    target            VARCHAR(255) NOT NULL,           -- 발송 대상 — 정규화한 이메일(trim+소문자)·휴대폰 번호(숫자만)
    token_hash        CHAR(64)     NOT NULL,           -- 링크: sha256(토큰) / 코드: HMAC-SHA256
    attempt_count     INT          NOT NULL DEFAULT 0, -- 코드 방식 시도 횟수 — 비교하기 전에 먼저 소모한다
    expires_at        DATETIME     NOT NULL,
    used_at           DATETIME     NULL,               -- 소비 — 조건부 UPDATE가 1행일 때만 성공
    revoked_at        DATETIME     NULL,               -- 재발급·비밀번호 변경으로 무효화
    request_ip        VARCHAR(45)  NULL,               -- 발급 요청 IP — 프록시 뒤 실제 IP (rate-limit.md 3-1절)
    created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_account_token_hash (token_hash),
    KEY idx_account_token_target (purpose, target, created_at),   -- 대상별 최신 코드 조회 + 재발송 빈도 계산
    KEY idx_account_token_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
