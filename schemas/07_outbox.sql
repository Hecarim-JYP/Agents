/*
 * 파일명 : 07_outbox.sql
 * 용도 : 반드시 전달해야 하는 비동기 작업(외부 쓰기 연동·필수 알림)의 발송 대기열
 *        업무 변경과 같은 트랜잭션에 INSERT하고, relay 워커가 선점 → 발송 → 결과 기록한다
 *        (conventions/features/outbox.md — 규칙·선점 쿼리·재시도 정책의 단일 출처)
 *        쓰기 연동이 있는 프로젝트만 복사한다 (시작 결정 체크리스트 18)
 * 최초등록 : 2026-10-14 [박진영]
 * 참고 : 로그성 테이블이라 version·소프트삭제 컬럼이 없다 (database.md 3절 제외 조건)
 *        상태 변경은 항상 조건부 UPDATE로 — 선점한 relay(locked_by)만 결과를 기록한다
 */

CREATE TABLE IF NOT EXISTS outbox_message (
    outbox_message_id  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    message_key        VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,  -- 멱등 키(UUID) — 매 발송에 실어 수신 측이 중복을 거부한다
    target_system      VARCHAR(50)  NOT NULL,           -- 연동 대상 = external/{system} 클라이언트 (예: ERP, MAIL)
    message_type       VARCHAR(100) NOT NULL,           -- 업무 이벤트 유형 (예: SHIPMENT_REQUESTED)
    aggregate_type     VARCHAR(100) NOT NULL,           -- 원천 업무 테이블명 — 추적과 순서 보장의 키
    aggregate_id       BIGINT UNSIGNED NOT NULL,        -- 원천 업무 행의 PK
    payload            JSON NOT NULL,                   -- 생성 시점 스냅샷(우리 도메인 형식) — 상대 형식 변환은 발송 시 external 계층이
    status             VARCHAR(20) NOT NULL DEFAULT 'PENDING',  -- PENDING / PROCESSING / SENT / FAILED / CANCELLED
    retry_count        INT NOT NULL DEFAULT 0,          -- 실패한 발송 횟수
    next_attempt_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,  -- 이 시각 이후에만 선점 대상 (재시도 백오프)
    locked_by          VARCHAR(100) NULL,               -- 선점한 relay 실행 식별자
    locked_until       DATETIME NULL,                   -- 선점 만료 — relay가 죽으면 이 시각 뒤 다른 relay가 회수
    last_error         VARCHAR(1000) NULL,              -- 마지막 실패 사유 (민감정보·응답 본문 전체 금지)
    sent_at            DATETIME NULL,
    created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by         BIGINT,
    updated_at         DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
    updated_by         BIGINT,
    UNIQUE KEY uq_outbox_message_key (message_key),
    KEY idx_outbox_message_status_next (status, next_attempt_at),
    KEY idx_outbox_message_status_lock (status, locked_until),
    KEY idx_outbox_message_aggregate (aggregate_type, aggregate_id, outbox_message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
