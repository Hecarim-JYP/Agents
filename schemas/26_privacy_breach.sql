/*
 * 파일명 : 26_privacy_breach.sql
 * 용도 : 개인정보 유출등(분실·도난·유출·위조·변조·훼손) 대응 기록 — 인지 시각·72시간 기한·대상 정보주체·통지·신고 이력
 *        (conventions/features/privacy-breach.md — 기한·통지 항목·신고 판정 규칙의 단일 출처)
 * 최초등록 : 2026-10-20 [박진영]
 * 참고 : 72시간은 "알게 된 때"부터 시간 단위로 센다(개인정보 보호법 시행령 제39조 ①·제40조 ①) — 날짜로 자르지 않는다
 *        대상 정보주체는 접속기록에서 뽑아 privacy_breach_subject에 한 명당 한 행으로 쌓는다 — 신고 판정(1천명)은 이 행 수로 한다
 *        (접속기록의 행 수·subject_count 합계로 세면 틀린다 — privacy-breach.md 4절 실측)
 *        우선 통지·추가 통지를 모두 남긴다(시행령 제39조 ②·제40조 ②) — 통지 문구 원문도 함께
 */

CREATE TABLE IF NOT EXISTS privacy_breach (
    privacy_breach_id   BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    public_id           CHAR(21) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,   -- 대응 번호 — 내부 보고·신고서에 쓰는 번호 (public-id.md)
    kind                VARCHAR(20)  NOT NULL,          -- CONFIRMED(유출등 확인 — 법 제34조 ①) / POSSIBLE(가능성 — 법 제34조 ②) — 가능성이 확인되면 CONFIRMED로, deadline_at은 그대로
    breach_type         VARCHAR(20)  NOT NULL,          -- LEAK / LOSS / THEFT / FORGERY / ALTERATION / DAMAGE
    cause               VARCHAR(30)  NOT NULL,          -- EXTERNAL_ACCESS / INSIDER / MISDELIVERY / MISCONFIG / LOST_DEVICE / VENDOR / OTHER
    detected_at         DATETIME     NOT NULL,          -- 알게 된 시각 — 72시간 기산점 (확정 시각이 아니다)
    deadline_at         DATETIME     NOT NULL,          -- detected_at + 72시간 — 접수 시 계산해 저장
    occurred_from       DATETIME     NULL,              -- 유출등 시점(추정 범위) — 통지 2호
    occurred_to         DATETIME     NULL,
    items               VARCHAR(500) NULL,              -- 유출등 항목 — 통지 1호 (확인 전 NULL, 우선 통지 후 추가 통지)
    has_sensitive       TINYINT(1)   NOT NULL DEFAULT 0, -- 민감정보·고유식별정보 포함 — 신고 사유 2호
    affected_count      INT          NULL,              -- privacy_breach_subject 행 수 (+ 목록으로 못 뽑은 하한 — 3-2절)
    report_required     TINYINT(1)   NULL,              -- 신고 대상 판정 (시행령 제40조 ① 1~3호 중 하나라도) — 판정 전 NULL
    status              VARCHAR(20)  NOT NULL DEFAULT 'DETECTED',  -- DETECTED / CONTAINED / NOTIFYING / CLOSED
    contained_at        DATETIME     NULL,              -- 긴급 조치(접속 차단·회수) 완료 — 통지 연기 사유가 해소된 시각
    delay_reason        VARCHAR(500) NULL,              -- 72시간을 넘긴 사유 (시행령 제39조 ① 단서·제40조 ① 단서) — 넘겼으면 필수
    reported_at         DATETIME     NULL,              -- 보호위원회·한국인터넷진흥원 1차 신고 시각
    notified_at         DATETIME     NULL,              -- 정보주체 1차 통지(또는 게시) 완료 시각
    posted_until        DATE         NULL,              -- 홈페이지 게시로 갈음한 경우 게시 종료일 (30일 이상 — 시행령 제39조 ③)
    summary             TEXT         NULL,              -- 경위 (통지 2호의 원천)
    handled_by          BIGINT UNSIGNED NULL,           -- 대응 책임자 (개인정보 보호책임자 또는 지정 담당)
    version             INT          NOT NULL DEFAULT 0,
    created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_privacy_breach_public_id (public_id),
    KEY idx_privacy_breach_deadline (status, deadline_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 대상 정보주체 — 한 사람 한 행 (PK가 중복을 없앤다). 통지 발송·누락 확인도 이 표로
CREATE TABLE IF NOT EXISTS privacy_breach_subject (
    privacy_breach_id   BIGINT UNSIGNED NOT NULL,
    subject_type        VARCHAR(50)  NOT NULL,          -- 접속기록의 subject_type (CUSTOMER 등)
    subject_id          VARCHAR(64)  NOT NULL,          -- 접속기록의 subject_ids 원소
    raw_exposed         TINYINT(1)   NOT NULL DEFAULT 0, -- 원문이 나갔는지 (UNMASK·DOWNLOAD) — 0이면 마스킹된 값만 (항목 판단에 쓴다)
    first_accessed_at   DATETIME     NULL,
    notified_at         DATETIME     NULL,              -- 이 사람에게 통지가 나간 시각 (outbox 발송 성공)
    PRIMARY KEY (privacy_breach_id, subject_type, subject_id),
    KEY idx_privacy_breach_subject_pending (privacy_breach_id, notified_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 통지·신고 이력 — 우선 통지와 추가 통지를 차례로 남긴다
CREATE TABLE IF NOT EXISTS privacy_breach_notice (
    privacy_breach_notice_id  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    privacy_breach_id   BIGINT UNSIGNED NOT NULL,
    target              VARCHAR(20)  NOT NULL,          -- SUBJECT(정보주체) / REGULATOR(보호위원회·한국인터넷진흥원) / HOMEPAGE(게시 갈음)
    seq                 TINYINT UNSIGNED NOT NULL,      -- 1 = 우선 통지·신고, 2부터 = 추가 확인 내용
    channel             VARCHAR(20)  NOT NULL,          -- EMAIL / SMS / POST / HOMEPAGE / REPORT_SITE
    content             TEXT         NOT NULL,          -- 실제로 보낸 문구 (법 제34조 ① 1~7호) — 나중에 "무엇을 알렸나"의 증거
    recipient_count     INT          NULL,
    sent_at             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sent_by             BIGINT UNSIGNED NULL,
    UNIQUE KEY uq_privacy_breach_notice_seq (privacy_breach_id, target, seq)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
