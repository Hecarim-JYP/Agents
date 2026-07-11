/*
 * 파일명 : 02_common_code.sql
 * 용도 : 공통코드 테이블 — 드롭다운 옵션, 상태값, 구분값 등을 하드코딩 대신 데이터로 관리
 *        (database.md 4절 "매직 넘버 금지"의 표준 구현. 코드 추가 = INSERT만으로 화면 자동 확장)
 * 최초등록 : 2026-07-12 [박진영]
 */

CREATE TABLE IF NOT EXISTS common_code_group (
    common_code_group_id  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    group_code            VARCHAR(50)  NOT NULL,       -- 예: REQUEST_STATUS, ATTACH_TYPE
    group_name            VARCHAR(100) NOT NULL,
    is_active             TINYINT(1)   NOT NULL DEFAULT 1,
    created_at            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by            BIGINT,
    updated_at            DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
    updated_by            BIGINT,
    UNIQUE KEY uq_common_code_group_group_code (group_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS common_code (
    common_code_id  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    group_code      VARCHAR(50)  NOT NULL,
    code            VARCHAR(50)  NOT NULL,             -- 대문자 영문 코드 (예: PENDING, DONE)
    code_name       VARCHAR(100) NOT NULL,             -- 화면 표시명
    sort_order      INT NOT NULL DEFAULT 0,
    remark          VARCHAR(255),
    is_active       TINYINT(1) NOT NULL DEFAULT 1,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by      BIGINT,
    updated_at      DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
    updated_by      BIGINT,
    UNIQUE KEY uq_common_code_group_code (group_code, code),
    KEY idx_common_code_group_code (group_code, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
