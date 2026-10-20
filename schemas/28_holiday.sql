/*
 * 파일명 : 28_holiday.sql
 * 용도 : 공휴일·대체공휴일·지정 공휴일(선거일·임시공휴일)·회사 휴무일 — 기한·영업일 계산이 읽는 단일 목록
 *        (conventions/features/holiday.md — 생성 규칙·확정 절차·사용 규칙의 단일 출처)
 * 최초등록 : 2026-10-20 [박진영]
 * 참고 : 음력 공휴일·대체공휴일은 규칙으로 생성(source=GENERATED)하고, 선거일·임시공휴일은 관리자가 등록(MANUAL)한다
 *        한 해의 목록은 정부 발표와 대조해 확정(confirmed_at)한 뒤에만 기한 계산에 쓴다 — 미확정 연도는 배치가 알린다
 *        같은 날 공휴일이 둘이면(어린이날 + 부처님 오신 날) 행도 둘 — 계산은 날짜 집합(DISTINCT holiday_date)으로 한다
 *        COMPANY(창립기념일 등)는 사내 업무 일정에만 — 법정 기한 계산에는 넣지 않는다 (holiday.md 3-4절)
 */

CREATE TABLE IF NOT EXISTS holiday (
    holiday_id      BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    holiday_date    DATE         NOT NULL,
    name            VARCHAR(50)  NOT NULL,              -- 설날, 대체공휴일(광복절), 전국동시지방선거 …
    kind            VARCHAR(20)  NOT NULL,              -- FIXED / LUNAR / SUBSTITUTE / DESIGNATED(선거일·임시) / COMPANY
    source          VARCHAR(20)  NOT NULL,              -- GENERATED(규칙 생성) / MANUAL(관리자 등록)
    confirmed_at    DATETIME     NULL,                  -- 정부 발표와 대조해 확정한 시각 — NULL이면 그 해 목록은 미확정
    confirmed_by    BIGINT UNSIGNED NULL,
    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_holiday_date_name (holiday_date, name),
    KEY idx_holiday_kind_date (kind, holiday_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
