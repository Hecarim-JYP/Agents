/*
 * 파일명 : 19_terms_consent.sql
 * 용도 : 약관·개인정보 수집·마케팅 수신 등 동의 이력 — 누가·언제·어떤 버전의 문서에·어떤 경로로 동의/철회했는지
 *        (conventions/features/consent.md — 버전 관리·재동의·철회 규칙의 단일 출처)
 * 최초등록 : 2026-10-19 [박진영]
 * 참고 : user_consent는 추가 전용이다 — 상태를 덮어쓰지 않고 동의·철회를 매번 새 행으로 쌓는다(현재 상태 = 유형별 최신 행)
 *        UPDATE는 트리거가 거부한다(이력의 증거력). DELETE는 탈퇴 후 보관 기간이 끝난 행의 파기 배치만 쓴다 (consent.md 3-4절)
 *        문서 원문은 버전마다 별도 파일로 두고 바꾸지 않는다 — content_sha256으로 사후 변경 여부를 확인한다
 *        트리거 생성 권한 (2026-10-19 실측, 앱 계정으로 적용): MariaDB 10.11 기본 설정 → 성공 /
 *        MySQL 8.0.46 → ERROR 1419 (바이너리 로그가 기본으로 켜져 있어 SUPER 필요 — 테이블만 생기고 여기서 멈춘다).
 *        MySQL·바이너리 로그를 켠 MariaDB는 이 문장만 DB 관리자 계정으로 실행한다 (consent.md 4절)
 */

CREATE TABLE IF NOT EXISTS terms_document (
    terms_document_id  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    terms_type         VARCHAR(30)  NOT NULL,          -- TERMS_OF_SERVICE / PRIVACY_COLLECT / PRIVACY_OPTIONAL / MARKETING_{EMAIL|SMS|PUSH|NIGHT} / THIRD_PARTY 등
    version            VARCHAR(20)  NOT NULL,          -- 예: 2026-10-19
    is_required        TINYINT(1)   NOT NULL,          -- 필수 동의(서비스 이용 조건)인지 — 선택 항목 미동의로 서비스를 거부하지 않는다
    title              VARCHAR(200) NOT NULL,
    content_url        VARCHAR(500) NOT NULL,          -- 해당 버전 원문 위치 (버전마다 다른 파일, 덮어쓰기 금지)
    content_sha256     CHAR(64)     NOT NULL,          -- 원문 해시
    effective_at       DATETIME     NOT NULL,          -- 시행 시각 — 이 시각 이후 로그인부터 재동의 요구
    created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by         BIGINT,
    UNIQUE KEY uq_terms_document_type_version (terms_type, version),
    KEY idx_terms_document_effective (terms_type, effective_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_consent (
    user_consent_id    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id            BIGINT UNSIGNED NOT NULL,
    terms_document_id  BIGINT UNSIGNED NOT NULL,       -- 동의한 문서 버전
    terms_type         VARCHAR(30)  NOT NULL,          -- 최신 상태 조회용 (terms_document와 같은 값)
    agreed             TINYINT(1)   NOT NULL,          -- 1 동의 / 0 거부·철회
    channel            VARCHAR(20)  NOT NULL,          -- SIGNUP / SETTINGS / RECONSENT / UNSUBSCRIBE(수신거부 링크 — marketing-message.md)
    ip_address         VARCHAR(45)  NULL,              -- 프록시 뒤 실제 IP (rate-limit.md 3-1절)
    user_agent         VARCHAR(300) NULL,
    created_at         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),   -- 같은 초 안의 동의·철회 순서 보존
    KEY idx_user_consent_user_type (user_id, terms_type, user_consent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 추가 전용 — 동의 이력을 고쳐 쓰는 경로를 DB에서 막는다
CREATE TRIGGER trg_user_consent_no_update BEFORE UPDATE ON user_consent
    FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'user_consent is append-only';
