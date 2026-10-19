/*
 * 파일명 : 20_retained_personal_data.sql
 * 용도 : 탈퇴 후 다른 법령에 따라 보존해야 하는 개인정보의 분리 보관 — 보존 근거·파기 예정일과 함께
 *        (conventions/features/account-withdrawal.md — 익명화·분리 보관·파기 규칙의 단일 출처)
 * 최초등록 : 2026-10-19 [박진영]
 * 참고 : 업무 DB가 아니라 별도 DB에 둔다 — 개인정보 접속기록(14_personal_data_access_log.sql)과 같은 방식.
 *        앱 계정은 INSERT만, 조회는 권한 있는 담당자 화면(사유 기록)만, 파기 배치 계정만 DELETE
 *        업무 테이블(주문 등)의 개인 식별 컬럼은 탈퇴 시 여기로 옮기고 원래 자리는 비운다 — 금액·일자 같은 비식별 거래 정보는 업무 DB에 남는다
 *        destroy_after가 지난 행은 매일 파기 배치가 삭제한다 (batch.md — 실행 이력·실패 알림 필수)
 */

CREATE TABLE IF NOT EXISTS retained_personal_data (
    retained_personal_data_id  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id          BIGINT UNSIGNED NOT NULL,         -- 익명화된 user 행 (업무 DB) — 조회 시 원 주체 확인용
    source_table     VARCHAR(64)  NOT NULL,            -- 옮겨 온 업무 테이블 (예: orders)
    source_id        BIGINT UNSIGNED NOT NULL,         -- 그 테이블의 PK
    legal_basis      VARCHAR(100) NOT NULL,            -- 보존 근거 (예: 전자상거래법 — 계약·청약철회 기록)
    payload          JSON         NOT NULL,            -- 옮긴 개인 식별 값 (수령인·연락처·주소 등)
    retained_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    destroy_after    DATE         NOT NULL,            -- 이 날짜가 지나면 파기
    KEY idx_retained_destroy (destroy_after),
    KEY idx_retained_source (source_table, source_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
