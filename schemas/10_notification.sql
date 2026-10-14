/*
 * 파일명 : 10_notification.sql
 * 용도 : 화면 알림함 — 사용자별 알림 목록·읽음 처리. 메일·메신저 등 외부 채널은 outbox(07)로 보낸다
 *        (conventions/features/notification.md — 채널 선택·중복 방지·템플릿의 단일 출처)
 * 최초등록 : 2026-10-14 [박진영]
 * 참고 : dedupe_key = 같은 사건의 같은 수신자에게 두 번 보내지 않기 위한 키 (UNIQUE)
 *        로그성 테이블이라 version·소프트삭제 컬럼이 없다 — 보관 기간이 지나면 정리 배치가 삭제
 */

CREATE TABLE IF NOT EXISTS notification (
    notification_id    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id            BIGINT UNSIGNED NOT NULL,        -- 수신자
    notification_type  VARCHAR(50) NOT NULL,            -- 예: APPROVAL_REQUESTED, APPROVAL_REJECTED
    title              VARCHAR(200) NOT NULL,           -- 렌더링된 제목 (적재 시점 문구로 동결)
    body               VARCHAR(1000) NULL,
    link_path          VARCHAR(500) NULL,               -- 앱 내 상대 경로 (예: /approvals/123) — 절대 URL 금지
    aggregate_type     VARCHAR(100) NULL,               -- 원천 업무 테이블명
    aggregate_id       BIGINT UNSIGNED NULL,
    dedupe_key         VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,  -- sha256(사건 키) hex — 같은 사건·수신자 중복 차단
    read_at            DATETIME NULL,
    created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_notification_dedupe (dedupe_key),
    KEY idx_notification_user (user_id, read_at, notification_id)    -- 안 읽은 알림 수·목록
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
