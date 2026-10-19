/*
 * 파일명 : 24_payment.sql
 * 용도 : PG(결제대행) 결제·취소 — 주문 1건의 결제 시도와 상태, 부분 취소 이력
 *        (conventions/features/payment.md — 금액 검증·승인·망취소·대사 규칙의 단일 출처)
 * 최초등록 : 2026-10-19 [박진영]
 * 참고 : 카드번호 등 결제수단 정보는 저장하지 않는다 — PG 결제창이 받는다. 우리는 PG가 준 결제 키·결과만 저장
 *        상태 전이는 조건부 UPDATE로만 (READY → PAID → PARTIAL_CANCELLED/CANCELLED, READY → FAILED/EXPIRED)
 *        — 성공 화면 새로고침·웹훅·대사 배치가 동시에 와도 한 번만 전이한다 (payment.md 3-3절)
 *        amount는 서버가 주문에서 계산해 저장한 값 — 화면·리다이렉트 URL의 금액을 믿지 않는다
 */

CREATE TABLE IF NOT EXISTS payment (
    payment_id        BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_id          BIGINT UNSIGNED NOT NULL,        -- 업무 주문 (내부 PK)
    pg_order_id       VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,   -- PG에 넘기는 주문번호 — 시도마다 새로, 추측 불가(public-id.md 방식)
    amount            INT UNSIGNED NOT NULL,           -- 결제할 금액(원) — 서버 계산값
    status            VARCHAR(20)  NOT NULL DEFAULT 'READY',   -- READY / PAID / PARTIAL_CANCELLED / CANCELLED / FAILED / EXPIRED
    pg_payment_key    VARCHAR(200) NULL,               -- PG 결제 키 (승인 후)
    method            VARCHAR(30)  NULL,               -- CARD / TRANSFER / VIRTUAL_ACCOUNT ...
    approved_at       DATETIME     NULL,
    cancelled_amount  INT UNSIGNED NOT NULL DEFAULT 0, -- 누적 취소 금액
    failure_code      VARCHAR(60)  NULL,
    version           INT          NOT NULL DEFAULT 0,
    created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME     NULL ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_payment_pg_order_id (pg_order_id),
    UNIQUE KEY uq_payment_pg_payment_key (pg_payment_key),
    KEY idx_payment_order (order_id),
    KEY idx_payment_status (status, created_at)            -- 대사·만료 배치
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payment_cancel (
    payment_cancel_id  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    payment_id         BIGINT UNSIGNED NOT NULL,
    amount             INT UNSIGNED NOT NULL,
    reason             VARCHAR(200) NOT NULL,
    idempotency_key    CHAR(36) CHARACTER SET ascii NOT NULL,   -- PG 취소 요청에 그대로 보낸다 — 응답 유실 후 재시도해도 한 번만 취소
    status             VARCHAR(20)  NOT NULL DEFAULT 'REQUESTED', -- REQUESTED / DONE / FAILED
    requested_by       BIGINT UNSIGNED NULL,
    requested_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    done_at            DATETIME NULL,
    UNIQUE KEY uq_payment_cancel_idempotency (idempotency_key),
    KEY idx_payment_cancel_payment (payment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
