/*
 * 파일명 : 27_identity_verification.sql
 * 용도 : 본인확인(휴대폰 등 본인확인기관 연동) — 서버가 발급한 1회용 요청, 기관이 돌려준 결과, 회원별 확인 결과(CI 중복 가입 차단)
 *        (conventions/features/identity-verification.md — 요청·결과 수신·중복 판정·만 14세 판정 규칙의 단일 출처)
 * 최초등록 : 2026-10-20 [박진영]
 * 참고 : 연계정보(CI)는 개인정보다 — 원문은 AES-GCM으로 암호화(ci_enc), 중복 판정은 HMAC 블라인드 인덱스(ci_bidx)의 UNIQUE로 한다
 *        (암호문은 행마다 IV가 달라 같은 CI도 다른 값 — 암호문에 UNIQUE를 걸면 중복 가입이 그대로 통과한다, 실측)
 *        연계정보는 주민등록번호와 분리해 보관하고 받은 목적 안에서만 쓴다 (정보통신망법 제23조의5 ④·제23조의6 ②)
 *        주민등록번호는 받지도 저장하지도 않는다 (같은 법 제23조의2 — 본인확인기관만 처리)
 *        결과(이름·생년월일·휴대폰)는 기관이 서버로 돌려준 값만 쓴다 — 브라우저가 보낸 값으로 덮어쓰지 않는다
 */

-- 본인확인 요청 — 서버가 만들고(request_no), 기관 결과가 돌아오면 한 번만 쓰인다
CREATE TABLE IF NOT EXISTS identity_verification (
    identity_verification_id  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    request_no          CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,   -- 기관에 넘기는 요청 번호(서버 생성 난수) — 결과에 그대로 돌아와야 한다
    purpose             VARCHAR(20)  NOT NULL,          -- SIGNUP / GUARDIAN_CONSENT / ACCOUNT_RECOVERY / CHANGE_PHONE
    session_hash        CHAR(64) CHARACTER SET ascii NOT NULL,  -- 요청을 시작한 세션 식별자의 sha256 — 결과를 다른 브라우저에서 쓰지 못하게
    provider            VARCHAR(20)  NOT NULL,          -- 본인확인기관·대행사 코드 (PASS·NICE 등 — 프로젝트가 정한 값)
    status              VARCHAR(20)  NOT NULL DEFAULT 'REQUESTED',  -- REQUESTED / VERIFIED / FAILED / CONSUMED
    requested_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at          DATETIME     NOT NULL,          -- 요청 유효 시각 (기본 10분) — 지난 결과는 받지 않는다
    verified_at         DATETIME     NULL,
    -- 기관 결과 — 복호화·검증을 마친 값. 소비(가입 완료 등) 후에는 지운다(ci_enc·name_enc·phone_enc = NULL)
    name_enc            VARBINARY(300) NULL,            -- AES-GCM (field-encryption.md 3-1절)
    phone_enc           VARBINARY(100) NULL,
    birth_date          DATE         NULL,              -- 만 14세 판정 근거
    ci_enc              VARBINARY(200) NULL,
    ci_bidx             CHAR(64) CHARACTER SET ascii NULL,      -- HMAC-SHA256(CI) — 결과 수신 즉시 기존 회원 여부 확인
    fail_code           VARCHAR(50)  NULL,              -- 기관이 준 실패 코드 (사용자 취소 포함)
    consumed_at         DATETIME     NULL,              -- 결과를 쓴 시각 — 조건부 UPDATE로 한 번만
    UNIQUE KEY uq_identity_verification_request_no (request_no),
    KEY idx_identity_verification_expires (status, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 회원의 본인확인 결과 — 사람 한 명당 한 행. ci_bidx UNIQUE가 같은 사람의 두 번째 가입을 막는다
CREATE TABLE IF NOT EXISTS user_verified_identity (
    user_id             BIGINT UNSIGNED PRIMARY KEY,
    ci_bidx             CHAR(64) CHARACTER SET ascii NOT NULL,  -- HMAC-SHA256(FIELD_BIDX_KEY, CI)
    ci_enc              VARBINARY(200) NOT NULL,        -- CI 원문(88자 base64 기준 117바이트) — 기관 연계가 필요할 때만 복호화
    birth_date          DATE         NOT NULL,
    provider            VARCHAR(20)  NOT NULL,
    verified_at         DATETIME     NOT NULL,          -- 마지막 확인 시각 (재확인하면 갱신)
    UNIQUE KEY uq_user_verified_identity_ci (ci_bidx)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
