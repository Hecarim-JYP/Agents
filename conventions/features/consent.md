# 레시피: 약관·개인정보 처리 동의 이력 `[대외]` ⚑

> 확정: 2026-10-19 | 테이블: `schemas/19_terms_consent.sql` | 짝: account-lifecycle.md(가입), account-withdrawal.md(탈퇴 후 처리), marketing-message.md(광고 수신 동의·발송 직전 확인·2년 확인), privacy-rights.md(동의 철회 요구), gdpr.md(쿠키 동의), personal-data.md
> 동의는 **상태가 아니라 이력**이다 — 덮어쓰지 않고 동의·철회를 매번 새 행으로 쌓는다. 누가 **어떤 버전의 어떤 문서에** 언제·어떤 경로로 동의했는지를 나중에 증명할 수 있어야 한다.

## 1. 언제 쓰나

이용자가 가입하며 약관·개인정보 수집·마케팅 수신에 동의하는 대외 서비스. 사내 시스템은 임직원 개인정보 처리 근거가 근로계약·내부 규정이라 이 레시피가 대개 필요 없다.

⚑ 되돌리기 어려운 이유: `marketing_agree` 같은 상태 컬럼 하나로 시작하면 **과거 시점의 동의 여부를 복원할 수 없다** — 나중에 이력 테이블을 만들어도 그 이전 기록은 영영 없다.

### 1-1. 법정 요건 (확인 범위를 명시한다 — 2026-10-19)

| 항목 | 내용 | 확인 상태 |
|---|---|---|
| 동의 없이 처리 | 2023년 개정으로 계약 체결·이행에 필요한 수집은 '불가피하게' 요건이 빠져 **동의 없이 가능**(제15조) — 대신 동의 없이 처리하는 항목과 근거를 **동의 항목과 구분해 공개**, 입증 책임은 처리자 | 원문 확인 2026-10-19 (legalize-kr — 법제처 데이터를 옮긴 공개 저장소). 제15조 ①4호 "계약을 이행하거나 … 정보주체의 요청에 따른 조치를 이행하기 위하여 필요한 경우", 제22조 ③ |
| 동의 받는 방법 | 동의 사항을 **각각 구분**해 알리고 받는다(제22조 ①), 선택 항목 미동의·홍보 목적 동의 거부를 이유로 **서비스 제공을 거부하지 않는다**(제22조 ⑤), 동의 여부를 선택할 수 있다는 사실을 명확히 표시(시행령 제17조 ④) | 원문 확인 2026-10-19 |
| 동의의 조건 | 자유로운 선택, 구체적·명확한 내용, 쉬운 문구, 동의 여부를 명확히 표시할 방법 — 네 조건 모두 (시행령 제17조 ①, 2023-09-12 신설). 인터넷 홈페이지에 게재하고 동의 여부를 표시하게 하는 방법 허용(같은 조 ②4호) | 원문 확인 2026-10-19 |
| 광고성 정보 수신 동의 | 정보통신망법 제50조 — 사전 동의, 야간 별도 동의, 2년마다 확인 | **marketing-message.md** |

- 문구·항목 구분은 **법무가 확정**하고 CLAUDE.md에 기록한다 (MANDATORY) — 이 레시피는 그것을 저장·증명하는 구조를 정한다.

## 2. 결정 항목 (기본값)

| 결정 | 기본값 | 대안 / 비고 |
|---|---|---|
| 항목 구분 | **이용약관(필수) / 개인정보 수집·이용 — 동의가 필요한 항목만(필수·선택 구분) / 마케팅 수신(선택)** | 계약 이행용 수집은 처리방침 공개로 갈음(1-1절) — 동의 체크박스로 만들지 않는다 |
| 화면 | **항목별 체크박스, 선택 항목은 기본 해제**, "전체 동의"는 항목별 체크를 한 번에 켜는 버튼으로만 | |
| 문서 원문 | **버전마다 별도 파일(불변) + sha256** | 원문을 제자리에서 고치면 "무엇에 동의했는지"를 증명할 수 없다 |
| 약관 개정 | **새 버전 등록 → 시행 시각 이후 첫 로그인에 필수 항목 재동의 화면** | 재동의 전까지 업무 API는 403 `TERMS_REQUIRED` |
| 철회 | **설정 화면에서 언제든** — 새 행(`agreed = 0`), 즉시 반영 | |
| 탈퇴 후 동의 이력 | **처리방침에 정한 기간 뒤 파기 배치가 삭제** — 기간은 법무 확인 [확인] | 분쟁 대비 근거라 탈퇴 즉시 지우지 않는 것이 일반적 |

## 3. 표준 설계

### 3-1. 기록 — 추가 전용

```sql
-- 가입: 화면에 보여준 문서 버전 그대로, 체크 여부를 모두 남긴다(미동의도 기록)
INSERT INTO user_consent (user_id, terms_document_id, terms_type, agreed, channel, ip_address, user_agent)
VALUES (:userId, :docId, :type, :agreed, 'SIGNUP', :ip, :ua);

-- 철회·재동의도 같은 INSERT — UPDATE는 트리거가 거부한다
```

- 실측 2026-10-19 (MariaDB 10.11): `UPDATE user_consent …` → **ERROR 1644 `user_consent is append-only`**, INSERT·파기 배치 DELETE는 통과.
- `created_at`은 `DATETIME(3)` — 같은 초에 동의 후 철회해도 순서가 남는다. 최신 판정은 `user_consent_id`(증가 순)로 한다.
- 화면에서 받은 `terms_document_id`는 **지금 시행 중인 버전인지 서버가 확인**한다 — 오래 열어 둔 가입 화면이 옛 버전에 동의시키지 않게.

### 3-2. 현재 상태와 재동의 판정

```sql
-- 유형별 현재 상태 = 유형별 최신 행
SELECT c.terms_type, c.agreed, d.version
  FROM user_consent c JOIN terms_document d ON d.terms_document_id = c.terms_document_id
 WHERE c.user_consent_id IN (SELECT MAX(user_consent_id) FROM user_consent WHERE user_id = :userId GROUP BY terms_type);

-- 재동의가 필요한 필수 문서: 시행 중인 최신 버전에 대한 최신 행이 '동의'가 아닌 것
SELECT d.terms_type, d.version
  FROM terms_document d
 WHERE d.is_required = 1
   AND d.effective_at = (SELECT MAX(effective_at) FROM terms_document x WHERE x.terms_type = d.terms_type AND x.effective_at <= NOW())
   AND NOT EXISTS (SELECT 1 FROM user_consent c
                    WHERE c.user_id = :userId AND c.terms_document_id = d.terms_document_id AND c.agreed = 1
                      AND c.user_consent_id = (SELECT MAX(user_consent_id) FROM user_consent WHERE user_id = :userId AND terms_type = d.terms_type));
```

- 실측 (MariaDB 10.11·MySQL 8.0.46 동일): 마케팅 동의 후 철회한 사용자 → 현재 `agreed = 0` / 옛 약관만 동의한 사용자 → 새 시행 버전 재동의 필요 / 이미 새 버전에 동의한 사용자 → 없음 / **시행 전(미래 `effective_at`) 버전은 아직 요구하지 않음**.
- 재동의 판정은 로그인·토큰 갱신 시 1회 하고 결과를 세션에 싣는다 — 요청마다 조회하지 않는다. 판정이 걸린 동안 허용 API는 동의 화면·동의 저장·로그아웃뿐.

### 3-3. 동의 여부를 쓰는 곳 — 발송 시점에 확인

- 마케팅 메일·알림은 **보낼 때**(outbox relay가 발송하기 직전) 최신 동의를 다시 확인한다 — 대상 목록을 만든 뒤 철회한 사람에게 보내지 않게.
- 선택 항목(예: 맞춤 추천용 이용 기록)에 미동의한 사용자는 그 기능만 끄고 서비스는 그대로 제공한다(1-1절).

### 3-4. 탈퇴 후

- account-withdrawal.md 3-1절 탈퇴 트랜잭션은 동의 이력을 지우지 않는다(UPDATE 금지 — 익명화도 하지 않는다). 처리방침에 정한 기간이 지나면 파기 배치가 `DELETE FROM user_consent WHERE user_id IN (탈퇴 후 기간 경과)`로 지운다 — 실행 이력 필수(batch.md 3절).

## 4. 함정 (STRICT)

| 함정 | 증상 | 처방 |
|---|---|---|
| 상태 컬럼 하나(`marketing_agree`)로 관리 | 과거 시점 동의 여부를 증명할 수 없다 | 추가 전용 이력 |
| 약관 원문을 제자리에서 수정 | 동의 당시 내용을 복원할 수 없다 | 버전별 불변 파일 + 해시 |
| 선택 항목 기본 체크 / 미동의 시 가입 차단 | 법 위반 소지 (1-1절) | 기본 해제, 기능만 제한 |
| 약관 개정을 신규 가입자에게만 적용 | 기존 사용자는 옛 약관 동의 상태로 계속 이용 | 시행 후 로그인 시 재동의 (3-2절) |
| 대상 목록 작성 시점에만 동의 확인 | 그사이 철회한 사람에게 광고 발송 | 발송 직전 확인 (3-3절) |
| 이력 행을 UPDATE로 고침 | 증거력 상실 | 트리거 + 코드에서 INSERT만 |
| MySQL 8에서 앱 계정으로 트리거 생성 | **ERROR 1419** — 테이블만 생기고 마이그레이션 중단 (실측 — 8.0.46, 2026-10-20 LTS 8.4·9.7도 같음) | 트리거 문장만 DB 관리자 계정으로 실행 (스키마 파일 주석) |
| 같은 초의 동의·철회 | 순서가 뒤바뀌어 현재 상태 오판 | `DATETIME(3)` + id 순 판정 |

## 5. 스택별 구현

| 구성 | Express | Spring |
|---|---|---|
| 기록 | 동의 저장 서비스 — INSERT만 (리포지토리에 update 메서드를 두지 않는다) | 동일 |
| 재동의 게이트 | 인증 미들웨어 뒤 — 세션의 `termsRequired`가 있으면 허용 목록 외 403 `TERMS_REQUIRED` | 인증 필터 뒤 같은 판정 |
| 화면 | 403 `TERMS_REQUIRED` 응답을 공용 API 클라이언트가 받아 동의 화면으로 (react.md 7절) | 동일(프론트) |

## 6. 검증 포인트

- 자동화 테스트(테스트 DB): 가입 시 체크·미체크 모두 행 생성 / 철회 후 현재 상태 0 / 새 약관 시행 후 기존 사용자 → 403 `TERMS_REQUIRED`, 재동의 후 해제 / 시행 전 버전은 요구하지 않음 / UPDATE 시도 → DB 오류.
- 발송 배치: 대상 작성 후 철회한 사용자에게 발송되지 않는지.
- 법무 확인: 화면 문구·항목 구분이 CLAUDE.md 기록과 같은지.
