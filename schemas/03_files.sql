/*
 * 파일명 : 03_files.sql
 * 용도 : 파일 업로드 메타 테이블 — 파일과 DB 메타는 항상 쌍 (express.md 6절의 표준 구현)
 * 최초등록 : 2026-07-12 [박진영]
 */

CREATE TABLE IF NOT EXISTS files (
    file_id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    module_type         VARCHAR(50) NOT NULL,          -- 소속 모듈 (예: ct, external)
    module_name         VARCHAR(50) NOT NULL,          -- 첨부 유형 코드 (common_code 연동 권장, 대문자)
    reference_id        BIGINT UNSIGNED NOT NULL,      -- 소속 레코드 PK
    original_file_name  VARCHAR(255) NOT NULL,         -- 사용자가 올린 원본 이름 (표시용으로만 사용)
    stored_file_name    VARCHAR(255) NOT NULL,         -- 서버가 생성한 저장 이름 (UUID 등 — 경로 트래버설 차단)
    file_path           VARCHAR(500) NOT NULL,         -- uploads/{module}/{type}/ 기준 저장 경로
    file_size           BIGINT UNSIGNED NOT NULL,
    mime_type           VARCHAR(100),
    is_active           TINYINT(1) NOT NULL DEFAULT 1, -- 소프트삭제 (sql.md 5절)
    deleted_at          DATETIME NULL,
    deleted_by          BIGINT,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by          BIGINT,                        -- 업로더 (누락 주의 — INSERT 컬럼/VALUES 1:1 확인)
    KEY idx_files_reference (module_type, module_name, reference_id, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
