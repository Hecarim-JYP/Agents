/*
 * 파일명 : 01_auth.sql
 * 용도 : 인증·권한 기초 테이블 (auth.md 4절 RBAC 모델의 표준 구현)
 * 최초등록 : 2026-07-12 [박진영]
 * 참고 : 멀티테넌트 프로젝트는 각 테이블에 스코프 컬럼(company_id 등)을 추가하고
 *        조회 인덱스 선두에 배치한다 (database.md 3절)
 */

CREATE TABLE IF NOT EXISTS role (
    role_id      BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    role_code    VARCHAR(50)  NOT NULL,               -- 예: ADMIN / MANAGER / MEMBER
    role_name    VARCHAR(100) NOT NULL,
    is_active    TINYINT(1)   NOT NULL DEFAULT 1,
    created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by   BIGINT,
    updated_at   DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
    updated_by   BIGINT,
    UNIQUE KEY uq_role_role_code (role_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS permission (
    permission_id    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    permission_code  VARCHAR(100) NOT NULL,           -- '{module}.{action}' 형식 (auth.md 4-1절)
    permission_name  VARCHAR(100) NOT NULL,
    is_active        TINYINT(1)   NOT NULL DEFAULT 1,
    created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by       BIGINT,
    updated_at       DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
    updated_by       BIGINT,
    UNIQUE KEY uq_permission_permission_code (permission_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS role_permission (
    role_permission_id  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    role_id             BIGINT UNSIGNED NOT NULL,
    permission_id       BIGINT UNSIGNED NOT NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by          BIGINT,
    UNIQUE KEY uq_role_permission (role_id, permission_id),
    CONSTRAINT fk_role_permission_role       FOREIGN KEY (role_id)       REFERENCES role (role_id)             ON DELETE RESTRICT,
    CONSTRAINT fk_role_permission_permission FOREIGN KEY (permission_id) REFERENCES permission (permission_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `user` (
    user_id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    login_id            VARCHAR(100) NOT NULL,
    password_hash       VARCHAR(255) NOT NULL,        -- bcrypt/argon2 해시만 (auth.md 1절)
    user_name           VARCHAR(100) NOT NULL,
    email               VARCHAR(255),
    role_id             BIGINT UNSIGNED NOT NULL,
    is_active           TINYINT(1) NOT NULL DEFAULT 1, -- 계정 활성 토글 (삭제 플래그 겸용 금지 — sql.md 5절)
    failed_login_count  INT NOT NULL DEFAULT 0,        -- 실패 제한·잠금 (auth.md 1절)
    locked_at           DATETIME NULL,
    token_version       INT NOT NULL DEFAULT 0,        -- 서버 측 토큰 무효화 (auth.md 2절 — 증가시키면 기존 토큰 전부 무효)
    last_login_at       DATETIME NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by          BIGINT,
    updated_at          DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
    updated_by          BIGINT,
    UNIQUE KEY uq_user_login_id (login_id),
    KEY idx_user_role_id (role_id),
    CONSTRAINT fk_user_role FOREIGN KEY (role_id) REFERENCES role (role_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS login_history (
    login_history_id  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id           BIGINT UNSIGNED NULL,            -- 실패(미존재 계정)면 NULL 가능
    login_id          VARCHAR(100) NOT NULL,           -- 시도된 로그인 ID (감사용)
    is_success        TINYINT(1) NOT NULL,
    ip_address        VARCHAR(45),                     -- IPv6 대응
    user_agent        VARCHAR(500),
    created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_login_history_user_id (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
