/*
 * 파일명 : 00_schema_migrations.sql
 * 용도 : 마이그레이션 적용 기록 테이블 (migration.md 5절 — npm run migrate 러너가 사용)
 * 최초등록 : 2026-07-12 [박진영]
 */

CREATE TABLE IF NOT EXISTS schema_migrations (
    schema_migration_id  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    file_name            VARCHAR(255) NOT NULL,
    applied_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_schema_migrations_file_name (file_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
