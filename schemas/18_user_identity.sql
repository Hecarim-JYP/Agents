/*
 * 파일명 : 18_user_identity.sql
 * 용도 : 소셜 로그인 계정 연결 — 우리 user 1명에 외부 제공사 계정 여러 개(카카오·네이버·구글 등)
 *        (conventions/features/social-login.md — 연결·해제·자동 연결 규칙의 단일 출처)
 * 최초등록 : 2026-10-19 [박진영]
 * 참고 : 식별 키는 (provider, provider_user_id)다 — 이메일로 식별하지 않는다 (제공사 이메일은 바뀌고, 없을 수도 있다)
 *        provider_user_id는 제공사가 주는 앱 단위 고유값(OIDC sub, 카카오 회원번호 등) — 같은 사람도 앱이 바뀌면 값이 다를 수 있다
 *        제공사 토큰은 저장하지 않는다(로그인 직후 우리 세션 발급 — auth.md 0절). 제공사 API를 계속 불러야 하면 암호화 컬럼을 따로 둔다
 *        소셜 전용 가입자는 user.password_hash가 없다 — 01_auth.sql의 password_hash를 NULL 허용으로 바꾼다 (social-login.md 3-3절)
 */

CREATE TABLE IF NOT EXISTS user_identity (
    user_identity_id   BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id            BIGINT UNSIGNED NOT NULL,
    provider           VARCHAR(20)  NOT NULL,          -- KAKAO / NAVER / GOOGLE / APPLE
    provider_user_id   VARCHAR(255) NOT NULL,          -- 제공사의 앱 단위 사용자 식별자 (OIDC sub)
    email_at_link      VARCHAR(255) NULL,              -- 연결 시점 제공사 이메일 (표시·조사용 — 식별에 쓰지 않는다)
    email_verified     TINYINT(1)   NOT NULL DEFAULT 0, -- 연결 시점 제공사가 인증했다고 알려준 이메일인지
    linked_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at      DATETIME     NULL,
    UNIQUE KEY uq_user_identity_provider_user (provider, provider_user_id),
    KEY idx_user_identity_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
