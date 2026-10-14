/*
 * 파일명 : 08_change_log.sql
 * 용도 : 업무 데이터 변경 이력 — 누가·언제·무엇을(컬럼 단위 전/후)·왜 바꿨는지 (상태 전이 포함)
 *        서비스가 업무 변경과 같은 트랜잭션에서 기록한다
 *        (conventions/features/change-history.md — 기록 규칙·diff 정규화의 단일 출처)
 *        변경 이력을 보여줘야 하는 업무 테이블이 있는 프로젝트만 복사한다
 * 최초등록 : 2026-10-14 [박진영]
 * 참고 : 권한·계정·보안 행위는 audit_log(04)가 담당한다 — 접근 권한과 보관 기간이 달라 섞지 않는다
 *        로그성 테이블이라 version·소프트삭제 컬럼이 없다 (database.md 3절 제외 조건)
 */

CREATE TABLE IF NOT EXISTS change_log (
    change_log_id   BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    aggregate_type  VARCHAR(100) NOT NULL,      -- 업무 테이블명 (예: sales_order)
    aggregate_id    BIGINT UNSIGNED NOT NULL,   -- 업무 행의 PK
    action          VARCHAR(50)  NOT NULL,      -- CREATE / UPDATE / DELETE(소프트삭제) / 상태 전이 행위(SUBMIT, APPROVE …)
    changes         JSON NULL,                  -- {"컬럼": {"before": 값, "after": 값}} — 바뀐 컬럼만, 정규화된 문자열 값
    reason          VARCHAR(500) NULL,          -- 행위 사유 (반려 사유, 취소 사유 등)
    request_id      VARCHAR(64) NULL,           -- 요청 추적 ID (features/request-id.md) — 로그와 연결
    acted_by        BIGINT NOT NULL,            -- 행위자 (서버 신뢰값). 배치·시스템 변경은 시스템 계정 ID
    acted_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_change_log_aggregate (aggregate_type, aggregate_id, change_log_id),
    KEY idx_change_log_actor (acted_by, acted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
