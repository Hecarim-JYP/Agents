/*
 * 파일명 : 17_user_mfa.sql
 * 용도 : 2단계 인증(TOTP) 등록 정보와 복구 코드
 *        (conventions/features/mfa.md — 등록·검증·재사용 방지·복구 규칙의 단일 출처)
 * 최초등록 : 2026-10-16 [박진영]
 * 참고 : TOTP 비밀은 해시할 수 없다(서버가 코드를 계산하려면 원문이 필요) → AES-256-GCM으로 암호화해 저장, 키는 환경변수
 *        enabled_at이 NULL이면 등록 확인 전 — 로그인에서 2단계를 요구하지 않는다(QR 스캔에 실패한 사람이 잠기지 않게)
 *        last_used_step: 마지막으로 통과한 시간 단계(unix초/30) — 이 값 이하의 단계 코드는 재사용으로 거부
 *        복구 코드는 80비트 랜덤이라 sha256으로 충분하다 (6자리 코드와 달리 역산 불가)
 */

CREATE TABLE IF NOT EXISTS user_mfa (
    user_mfa_id     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id         BIGINT UNSIGNED  NOT NULL,
    method          VARCHAR(20)      NOT NULL DEFAULT 'TOTP',
    secret_enc      VARBINARY(255)   NOT NULL,          -- iv(12) + 인증 태그(16) + 암호문
    key_version     TINYINT UNSIGNED NOT NULL DEFAULT 1, -- 암호화 키 교체 시 어느 키로 풀지
    enabled_at      DATETIME         NULL,              -- 첫 코드 확인 시각 — NULL이면 미완료 등록
    last_used_step  BIGINT           NULL,              -- 재사용 방지 — 조건부 UPDATE로만 올린다
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_user_mfa_user_method (user_id, method)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_mfa_recovery_code (
    user_mfa_recovery_code_id  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id                    BIGINT UNSIGNED NOT NULL,
    code_hash                  CHAR(64) NOT NULL,       -- sha256(복구 코드) — 원문은 발급 응답에서 한 번만 보여준다
    used_at                    DATETIME NULL,           -- 1회용 — 조건부 UPDATE 1행일 때만 성공
    created_at                 DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_user_mfa_recovery_code_user (user_id, code_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
