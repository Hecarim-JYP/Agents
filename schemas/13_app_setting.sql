/*
 * 파일명 : 13_app_setting.sql
 * 용도 : 운영 중 바꾸는 설정 — 점검 모드, 공지 배너, 기능 차단 스위치 (재배포 없이 즉시 반영)
 *        (conventions/features/maintenance-mode.md — 키 목록·캐시·기본값 규칙의 단일 출처)
 * 최초등록 : 2026-10-14 [박진영]
 * 참고 : 시크릿·접속 정보는 여기 두지 않는다 (환경변수 — ops.md 1절). 변경은 관리자 권한 + audit_log 기록
 */

CREATE TABLE IF NOT EXISTS app_setting (
    app_setting_id  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    setting_key     VARCHAR(100) NOT NULL,             -- 예: maintenance, banner, feature.excel_upload
    setting_value   JSON NOT NULL,                     -- 예: {"enabled": true, "message": "...", "until": "2026-10-15 06:00"}
    description     VARCHAR(500) NULL,                 -- 이 설정이 무엇을 막는지 (운영자용)
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by      BIGINT,
    updated_at      DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
    updated_by      BIGINT,
    UNIQUE KEY uq_app_setting_key (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
