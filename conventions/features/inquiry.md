# 레시피: 1:1 문의·신고 접수 `[대외]`

> 확정: 2026-10-19 | 테이블: `schemas/21_inquiry.sql` (+ 첨부는 `03_files.sql`) | 짝: state-machine.md(상태 전이), notification.md(접수·답변 알림), upload-security.md(첨부), rate-limit.md(스팸), public-id.md(조회 URL), account-withdrawal.md(보관 기간)
> 문의는 **대화**(고객 질문 ↔ 직원 답변이 여러 번 오간다)라 메시지 행으로 쌓고, 상태는 전이표로만 바꾼다. 신고는 **(신고자, 대상) 1건**으로 세고, 누적 기준을 넘으면 숨긴 뒤 사람이 검토한다.

## 1. 언제 쓰나

고객 문의 창구가 있는 대외 서비스, 이용자가 글·댓글·다른 이용자를 신고할 수 있는 서비스. 사내 시스템의 업무 요청·장애 접수도 같은 구조를 쓸 수 있다(비회원·신고 부분만 뺀다).

## 2. 결정 항목 (기본값)

| 결정 | 기본값 | 대안 / 비고 |
|---|---|---|
| 접수 | **회원: 로그인 후 / 비회원: 이메일 + CAPTCHA + 빈도 제한**(rate-limit.md) | 비회원 문의를 받지 않는다 |
| 비회원 답변 | **메일로만 보낸다** — 비회원용 조회 화면을 두지 않는다 | 조회 화면이 필요하면 메일 링크 토큰(account-lifecycle.md 3-2절 방식) |
| 상태 | `RECEIVED → IN_PROGRESS → ANSWERED → CLOSED`, 고객 추가 질문 시 `ANSWERED → IN_PROGRESS` | 전이표·조건부 UPDATE (state-machine.md) |
| 담당 배정 | **수동 배정 — 동시에 두 직원이 잡지 못하게 조건부 UPDATE** | 자동 배정(분류별 담당 팀) |
| 자동 종료 | 답변 후 **7일** 고객 반응 없으면 `CLOSED`(배치) | |
| 알림 | 접수 → 담당 팀 화면 알림 / 답변 → 고객 메일 (notification.md, outbox) | |
| 보관 | 전자상거래 사업자: 소비자 불만·분쟁처리 기록 **3년**(전자상거래법 시행령 제6조 — account-withdrawal.md 1-1절) / 그 외: 처리방침 기간 | 기간이 지나면 파기 배치 |
| 신고 자동 숨김 | **서로 다른 신고자 5명** 이상이면 대상 숨김 + 검토 대기 | 자동 숨김 없이 검토만 |

## 3. 표준 설계

### 3-1. 문의 — 대화 + 전이

```
POST /api/inquiries { category, title, body, files[] }     → inquiry(RECEIVED) + 첫 inquiry_message(CUSTOMER) — 한 트랜잭션
POST /api/inquiries/:publicId/messages { body }             → 고객 추가 질문 (ANSWERED면 IN_PROGRESS로 되돌림)
POST /api/admin/inquiries/:id/assign                        → 담당 배정 (3-2절)
POST /api/admin/inquiries/:id/answers { body, internal? }   → STAFF 메시지, 첫 답변이면 first_answered_at, 상태 ANSWERED
GET  /api/inquiries/:publicId                               → 고객 조회 — is_internal_note = 1 메시지 제외
```

- 고객 화면의 URL은 공개 ID(`public_id`) — 순번이면 남의 문의를 번호로 찾아본다(public-id.md). 조회는 **본인 문의만**(auth.md 4-2절 소유권 검증).
- 첨부는 upload-security.md 그대로 — 고객이 올린 파일을 직원 화면에서 여는 구조라 **inline은 래스터 이미지만** 규칙이 특히 중요하다(직원 세션으로 스크립트가 실행된다).

### 3-2. 담당 배정 — 동시 배정 방지

```sql
UPDATE inquiry SET assignee_id = :staffId, status = 'IN_PROGRESS', version = version + 1
 WHERE inquiry_id = :id AND status = 'RECEIVED' AND version = :version
-- 0행 → 409 "다른 담당자가 먼저 배정했습니다" (sql.md 8절)
```

### 3-3. 신고 — 1인 1건, 누적은 신고자 수

```sql
INSERT INTO content_report (reporter_id, target_type, target_id, reason, detail)
VALUES (:reporterId, :targetType, :targetId, :reason, :detail)
ON DUPLICATE KEY UPDATE content_report_id = content_report_id      -- 이미 신고했으면 조용히 무시(같은 응답)

SELECT COUNT(*) FROM content_report WHERE target_type = :t AND target_id = :id AND status = 'RECEIVED'
-- 기준(5) 이상이면 대상 숨김 + 검토 대기열 (숨김은 대상 테이블의 상태 전이)
```

- 실측 2026-10-19 (MariaDB 10.11): 신고자 1이 **동시에 5회** + 신고자 2·3 각 1회 → 누적 **3건**. UNIQUE `(reporter_id, target_type, target_id)`가 동시 중복까지 막는다.
- 신고 처리(ACCEPTED·REJECTED)는 담당자·시각을 남기고, 반려가 많은 신고자는 검토 화면에 표시한다(신고 남용).

## 4. 함정 (STRICT)

| 함정 | 증상 | 처방 |
|---|---|---|
| 문의 본문을 HTML로 렌더링(줄바꿈 처리용 `dangerouslySetInnerHTML` 등) | 고객이 넣은 스크립트가 **직원 화면에서** 실행 — 관리자 세션 탈취 | 텍스트로 출력 + CSS `white-space: pre-wrap` |
| 내부 메모가 고객 조회에 섞임 | 직원 간 메모가 고객에게 노출 | 조회 쿼리에서 `is_internal_note = 0` |
| 신고를 버튼 클릭 수로 셈 | 한 사람이 연타해 자동 숨김 기준을 채운다 | UNIQUE + 신고자 수 |
| 순번 URL | 번호를 바꿔 남의 문의 열람 시도 | 공개 ID + 소유권 검증 |
| 비회원 문의 무제한 | 스팸·메일 폭탄 통로 | CAPTCHA + 빈도 제한 |
| 두 직원이 같은 문의를 동시에 배정 | 중복 답변 | 조건부 UPDATE (3-2절) |
| 고객이 본문에 주민번호·카드번호를 적음 | 문의 테이블이 민감 정보 저장소가 된다 | 접수 화면 안내 + 직원 목록 화면 마스킹(personal-data.md) + 보관 기간 후 파기 |

## 5. 스택별 구현

| 구성 | Express | Spring |
|---|---|---|
| 접수·메시지 | 서비스 한 트랜잭션 (inquiry + 첫 message + files 메타) | `@Transactional` |
| 상태 전이 | state-machine.md 전이표 + 조건부 UPDATE | 동일 |
| 자동 종료 | 배치 컨테이너 (batch.md) | 동일 |

## 6. 검증 포인트

- 자동화 테스트(테스트 DB): 다른 사용자의 문의 조회 → 404·403 / 내부 메모 제외 / 동시 배정 2건 → 1건 성공·1건 409 / 같은 신고자 중복 신고 → 1건 / 기준 도달 시 대상 숨김.
- 실동작 검증(/live-test): 본문에 `<script>`·`<img onerror>`를 넣어 접수 → 직원 화면에서 글자로만 보이는지, 첨부 SVG·HTML이 거부되는지.
