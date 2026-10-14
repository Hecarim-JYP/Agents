/*
 * 파일명 : 14_personal_data_access_log.sql
 * 용도 : 개인정보 접속기록 — 누가(계정)·언제·어디서(IP)·누구의(정보주체)·무엇을(항목)·어떻게(조회·원문 열람·다운로드·수정) 처리했는지
 *        (conventions/features/personal-data.md — 기록 범위·마스킹·보관 규칙의 단일 출처)
 *        개인정보를 처리하는 화면이 있는 프로젝트만 복사한다
 * 최초등록 : 2026-10-14 [박진영]
 * 참고 : 위·변조 방지 — 앱 DB 계정에는 이 테이블에 SELECT·INSERT만 부여한다 (UPDATE·DELETE 불가, personal-data.md 3-4절)
 *        보관 기간이 지난 행 삭제는 별도 관리 계정으로만
 */

CREATE TABLE IF NOT EXISTS personal_data_access_log (
    personal_data_access_log_id  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id         BIGINT NOT NULL,                   -- 처리한 계정 (서버 신뢰값)
    accessed_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ip_address      VARCHAR(45) NOT NULL,              -- 접속지 (프록시 뒤 실제 IP — docker.md 7절 trust proxy)
    action          VARCHAR(20) NOT NULL,              -- VIEW / UNMASK / DOWNLOAD / CREATE / UPDATE / DELETE / PRINT
    subject_type    VARCHAR(50) NOT NULL,              -- 정보주체 유형 (예: CUSTOMER, EMPLOYEE)
    subject_ids     JSON NULL,                         -- 처리한 정보주체 식별자 목록 (목록 조회는 그 화면에 나간 행들)
    subject_count   INT NOT NULL DEFAULT 1,
    target          VARCHAR(300) NULL,                 -- 화면·API (라우트 템플릿)
    fields          VARCHAR(500) NULL,                 -- 처리한 항목 (예: 연락처,주소)
    reason          VARCHAR(500) NULL,                 -- 원문 열람·다운로드 사유
    request_id      VARCHAR(64) NULL,                  -- 요청 추적 ID (features/request-id.md)
    KEY idx_personal_data_access_log_user (user_id, accessed_at),
    KEY idx_personal_data_access_log_time (accessed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
