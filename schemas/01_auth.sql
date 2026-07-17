/*
 * 파일명 : 01_auth.sql
 * 용도 : 인증·권한 기초 테이블 (auth.md 4절 RBAC 모델의 표준 구현)
 * 최초등록 : 2026-07-12 [박진영]
 * 참고 : 이 DDL은 자체 로그인(auth.md 0절 a) 기준이다.
 *        위임(0절 b): password_hash 제거(신원 검증은 사내 책임) + external_user_key
 *        VARCHAR(100) 추가 + UNIQUE (사내 계정 식별자). failed_login_count / locked_at은
 *        유지 — 우리 로그인 화면이 ID/PW를 받으므로 시도 제한은 우리 책임 (auth.md 1절)
 *        SSO(0절 c): 위에 더해 failed_login_count / locked_at도 제거 (자격증명이 IdP로 직접 간다)
 *        권한(role_id)·감사는 어느 방식에서든 우리 DB가 소유한다 (auth.md 0절)
 *        멀티테넌트 프로젝트는 05_company.sql을 함께 복사하고, 각 테이블에 스코프 컬럼
 *        (company_id)을 추가해 조회 인덱스 선두에 배치한다 (database.md 3절)
 *        FK는 논리적 참조만 — FOREIGN KEY 제약 미선언, FK 컬럼 인덱스 필수 (database.md 5절)
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
    KEY idx_role_permission_permission_id (permission_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `user` (
    user_id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    login_id            VARCHAR(100) NOT NULL,
    password_hash       VARCHAR(255) NOT NULL,        -- bcrypt/argon2 해시만 (auth.md 1절)
    user_name           VARCHAR(100) NOT NULL,
    email               VARCHAR(255),
    role_id             BIGINT UNSIGNED NOT NULL,
    is_active           TINYINT(1) NOT NULL DEFAULT 1, -- 계정 활성 토글 (삭제 플래그 겸용 금지 — sql.md 5절)
    failed_login_count  INT NOT NULL DEFAULT 0,        -- 실패 제한·잠금 — 우리 로그인만 차단 (auth.md 1절)
    locked_at           DATETIME NULL,
    token_version       INT NOT NULL DEFAULT 0,        -- 서버 측 토큰 무효화 (auth.md 2절 — 증가시키면 기존 토큰 전부 무효)
    last_login_at       DATETIME NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by          BIGINT,
    updated_at          DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
    updated_by          BIGINT,
    UNIQUE KEY uq_user_login_id (login_id),
    KEY idx_user_role_id (role_id)
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
