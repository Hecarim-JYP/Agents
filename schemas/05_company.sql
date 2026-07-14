/*
 * 파일명 : 05_company.sql
 * 용도 : 멀티테넌트(다중 법인) 기준 테이블 — 테넌트 스코프의 원점
 *        멀티테넌트 프로젝트에서만 복사한다 (database.md 3절, 시작 결정 체크리스트)
 * 최초등록 : 2026-07-13 [박진영]
 * 참고 : 이 테이블을 복사하면 반드시 함께 조정한다 —
 *        ① user 등 업무 테이블 전체에 company_id 컬럼 추가 + 조회 인덱스 선두 배치
 *        ② user의 UNIQUE를 (company_id, login_id)로 확장할지 결정 (법인 간 ID 중복 허용 여부)
 *        ③ role/common_code를 전사 공통으로 둘지 법인별로 둘지 결정해 CLAUDE.md에 기록
 *        FK는 논리적 참조만 — FOREIGN KEY 제약 미선언, FK 컬럼 인덱스 필수 (database.md 5절)
 */

CREATE TABLE IF NOT EXISTS company (
    company_id     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    company_code   VARCHAR(50)  NOT NULL,              -- 법인 식별 코드 (예: HQ, KR01)
    company_name   VARCHAR(100) NOT NULL,
    business_no    VARCHAR(20),                        -- 사업자등록번호 (하이픈 제외 저장)
    locale         VARCHAR(10)  NOT NULL DEFAULT 'ko', -- 법인 기본 언어 (i18n.md — BCP 47: ko, en, ja)
    timezone       VARCHAR(50)  NOT NULL DEFAULT 'Asia/Seoul',
    sort_order     INT NOT NULL DEFAULT 0,
    is_active      TINYINT(1)   NOT NULL DEFAULT 1,
    created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by     BIGINT,
    updated_at     DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
    updated_by     BIGINT,
    UNIQUE KEY uq_company_company_code (company_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
