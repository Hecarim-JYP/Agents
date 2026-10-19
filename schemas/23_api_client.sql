/*
 * 파일명 : 23_api_client.sql
 * 용도 : 외부에 공개하는 API의 사용자(연동사)와 API 키 — 발급·범위·폐기·사용 기록
 *        (conventions/features/public-api.md — 키 형식·검증·사용량 제한·버전 규칙의 단일 출처)
 * 최초등록 : 2026-10-19 [박진영]
 * 참고 : 키 원문은 저장하지 않는다 — 발급 응답에서 한 번만 보여주고 sha256만 저장(키는 32바이트 랜덤이라 단순 해시로 충분)
 *        조회는 key_prefix(키 앞부분, 공개해도 되는 식별자)로 한 행을 찾은 뒤 해시를 timingSafeEqual로 비교
 *        한 연동사에 키를 여러 개 둘 수 있다 — 무중단 교체(새 키 발급 → 연동사 전환 → 옛 키 폐기)
 */

CREATE TABLE IF NOT EXISTS api_client (
    api_client_id   BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    public_id       CHAR(21) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,   -- 연동사 식별자 (public-id.md)
    client_name     VARCHAR(100) NOT NULL,
    contact_email   VARCHAR(255) NOT NULL,             -- 폐기·변경 공지 대상
    rate_limit_per_min INT UNSIGNED NOT NULL DEFAULT 60, -- 연동사별 한도 (public-api.md 2절)
    is_active       TINYINT(1)   NOT NULL DEFAULT 1,
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by      BIGINT,
    UNIQUE KEY uq_api_client_public_id (public_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS api_key (
    api_key_id      BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    api_client_id   BIGINT UNSIGNED NOT NULL,
    key_prefix      CHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,   -- 키 앞 16자 고정 (예: 'abc_live_3f9a1c7') — 로그·화면에 이것만 보인다
    key_hash        CHAR(64)  CHARACTER SET ascii NOT NULL,                    -- sha256(키 전체)
    scopes          VARCHAR(500) NOT NULL,             -- 쉼표 구분 권한 (예: orders:read,products:read)
    expires_at      DATETIME  NULL,
    revoked_at      DATETIME  NULL,
    last_used_at    DATETIME  NULL,                    -- 매 요청 갱신하지 않는다 — 1분 단위로 묶어 갱신(쓰기 폭주 방지)
    created_at      DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by      BIGINT,
    UNIQUE KEY uq_api_key_prefix (key_prefix),
    KEY idx_api_key_client (api_client_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
