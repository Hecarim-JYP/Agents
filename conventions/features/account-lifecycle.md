# 레시피: 가입·이메일/휴대폰 인증·비밀번호 재설정 (계정 열거 방지) `[대외]`

> 확정: 2026-10-16 | 테이블: `schemas/16_account_token.sql` + `user.email_verified_at`(01_auth.sql에 추가) | 원칙: auth.md 1절(비밀번호·시도 제한) | 짝: rate-limit.md(발송 빈도), session-control.md(재설정 후 세션 종료), notification.md(메일 발송), mfa.md, social-login.md(같은 이메일 계정 연결), consent.md(가입 동의), account-withdrawal.md(탈퇴)
> 계정이 있는지 없는지를 **응답 문구로도, 응답 시간으로도** 드러내지 않는다. 확인용 토큰·코드는 원문을 저장하지 않고 **한 번만·짧게·시도 한도 안에서** 쓰인다.

## 1. 언제 쓰나

자체 로그인(auth.md 0절 a)에 **이용자가 스스로 가입하는** 서비스 — 고객용 웹, 거래처 포털. 관리자가 계정을 발급하는 사내 시스템은 3-5절(로그인 응답 시간)만 해당한다.

## 2. 결정 항목 (기본값)

| 결정 | 기본값 | 대안 / 비고 |
|---|---|---|
| 로그인 ID | **이메일** — 앞뒤 공백 제거 + 소문자로 정규화해 저장 | 별도 아이디 방식은 "아이디 중복 확인"이 그대로 열거 수단이 된다. 열거 방어가 필요하면 이메일 |
| 이메일 인증 | **가입 후 링크 인증. 인증 전에도 로그인은 되지만 업무 기능은 막는다** | 인증 전 로그인 차단도 가능 — 그 경우 재발송 화면을 로그인과 별도로 둔다(메일을 못 받은 사람이 갈 곳이 없어진다) |
| 휴대폰 인증 | **필요할 때만** — 6자리 코드, 5분, 5회 | 실명 본인확인(본인확인기관 연동)은 이 레시피 범위 밖 |
| 링크 토큰 | **32바이트 랜덤(base64url 43자), sha256 저장** — 재설정 30분, 가입 인증 24시간 | |
| 코드 시도 한도 | **5회** — 넘으면 그 코드는 폐기, 재발송 필요 | |
| 재발송 빈도 | 대상당 **60초에 1회 · 하루 5회** + IP 단위 제한(rate-limit.md) | 문자는 건당 비용이다 — 발송 남용이 곧 비용 청구 |
| 재설정 완료 후 | **모든 세션 종료 + 로그인 화면으로** (자동 로그인하지 않는다) | 자동 로그인은 2단계 인증을 건너뛰는 통로가 된다 (mfa.md) |
| 로그인 잠금 해제 | **15분 뒤 자동 해제 + 재설정 완료 시 즉시 해제** | auth.md 1절 기본(관리자 해제)의 대외 조정 — 대외에서 영구 잠금은 남의 이메일만 알면 누구든 그 계정을 잠글 수 있게 만든다. CLAUDE.md에 기록 |
| 토큰 행 보관 | 만료 후 **30일** 뒤 배치 삭제 | 요청 IP가 개인정보다 |

## 3. 표준 설계

### 3-1. 가입 — 있는 이메일이어도 같은 응답

```
POST /api/auth/signup { email, password, name }
 ① email 정규화, 비밀번호 정책 검사(auth.md 1절)
 ② 없는 이메일 → user INSERT(email_verified_at NULL, 역할 = 서버가 정한 기본 역할) + SIGNUP_EMAIL 토큰 + 인증 메일
    있는 이메일 → 가입시키지 않고, 그 주소로 "이미 가입된 계정입니다(로그인·비밀번호 재설정 안내)" 메일
              + 비밀번호 해시는 똑같이 계산해서 버린다 (3-5절 — 없는 쪽만 해시하면 응답 시간이 갈린다)
 ③ 두 경우 모두 202 { message: "인증 메일을 보냈습니다. 메일함을 확인해 주세요." }
```

- 메일은 **요청 안에서 보내지 않는다** — notification.md의 outbox 경유. 동기로 보내면 경로마다 발송 시간이 달라 응답 시간이 갈리고, 메일 서버 장애가 가입 실패가 된다.
- 역할·활성 여부 등 권한성 필드는 **요청 본문에서 받지 않는다** — 서버가 기본값으로 넣는다(express.md 5절 신뢰값, auth.md 4-3절 권한 상승 방지).

### 3-2. 링크 인증 — fragment로 싣고, 화면의 POST로만 소비

```
메일 링크: {APP_BASE_URL}/verify-email#token=<43자>
화면이 location.hash에서 토큰을 꺼내 → POST /api/auth/verify-email { token }

UPDATE account_token SET used_at = NOW()
 WHERE token_hash = :sha256_of_token AND purpose = 'SIGNUP_EMAIL'
   AND used_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()
→ 1행: 해당 user의 email_verified_at = NOW()
→ 0행: 400 { error: "TOKEN_INVALID", message: "링크가 만료되었거나 이미 사용되었습니다" }
```

- **토큰은 쿼리 문자열(`?token=`)이 아니라 fragment(`#token=`)에 싣는다** — 쿼리 문자열은 프록시 접근 로그에 원문 그대로 남는다. fragment는 브라우저가 서버로 보내지 않는다 (실측 2026-10-16, nginx 1.24 기본 로그: `GET /reset-password?token=SECRET…` 원문 기록 / `#token=…`은 `GET /reset-password`만 기록).
- **링크를 여는 것(GET)으로 토큰을 소비하지 않는다** — 메일 보안 솔루션·메신저 미리보기는 링크를 사용자보다 먼저 열어 본다. GET에서 소비하면 사용자가 누르기 전에 토큰이 사라진다.
- **링크 주소는 `APP_BASE_URL`로 만든다. 요청의 `Host` 헤더로 만들지 않는다** — `Host`를 바꿔 피해자 이메일로 재설정을 요청하면 피해자에게 **공격자 도메인의 재설정 링크**가 간다(누르는 순간 토큰이 공격자에게 넘어간다).

### 3-3. 비밀번호 재설정

```
① POST /api/auth/password-reset { email }
   → 항상 202 "가입된 이메일이면 재설정 메일을 보냈습니다"
   있는 계정만: 이전 PASSWORD_RESET 토큰 revoke + 새 토큰(30분) + 메일(outbox)

② 화면 /reset-password#token=… → POST /api/auth/password-reset/confirm { token, new_password }
   BEGIN
    UPDATE account_token SET used_at = NOW() WHERE token_hash = :h AND purpose = 'PASSWORD_RESET'
      AND used_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()          ← 0행이면 400
    user_id는 토큰 행에서 읽는다 (요청 본문의 사용자 식별값을 쓰지 않는다)
    user: password_hash 갱신, failed_login_count = 0, locked_at = NULL, token_version + 1
    user_session 전부 revoke(PASSWORD_CHANGED)                                   ← session-control.md 3-1절
   COMMIT
   → "비밀번호가 변경되었습니다" 메일 (본인이 한 게 아니면 알아챌 수 있게)
```

- 같은 링크로 동시에 두 번 확정해도 조건부 UPDATE가 한 번만 성공시킨다 (실측 2026-10-16, MariaDB 10.11: 동시 2건 → 1건 성공 / 1건 거부).

### 3-4. 6자리 코드 (휴대폰·이메일 코드 방식)

```
발급: code = crypto.randomInt(0, 1_000_000) → 6자리 0 채움
      token_hash = HMAC-SHA256(TOKEN_HMAC_KEY, `${purpose}:${target}:${code}`)
      같은 (purpose, target)의 미사용 코드는 revoke, 재발송 빈도는 같은 인덱스로 계산(rate-limit.md 3-2절)

검증: ① 대상의 최신 유효 코드 1건: SELECT … WHERE purpose = :p AND target = :t ORDER BY created_at DESC LIMIT 1
      ② 시도 횟수를 먼저 소모:
         UPDATE account_token SET attempt_count = attempt_count + 1
          WHERE account_token_id = :id AND attempt_count < 5
            AND used_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()
         0행 → 400 "인증 코드를 다시 요청해 주세요"
      ③ HMAC 비교(timingSafeEqual) → 일치하면 UPDATE … SET used_at = NOW() WHERE account_token_id = :id AND used_at IS NULL
```

- **시도 횟수는 비교하기 전에 조건부 UPDATE로 소모한다** — "읽고 비교한 뒤 틀리면 +1"은 동시 요청에서 한도가 사라진다 (실측 2026-10-16, MariaDB 10.11, 동시 오입력 50건: 비교 후 증가 → **50회 비교** / 먼저 소모 → 5회 비교).
- 코드는 HMAC으로 저장한다 — 100만 가지뿐이라 sha256만 하면 DB가 샐 때 전부 역산된다. 키 `TOKEN_HMAC_KEY`는 환경변수(32바이트 이상 랜덤).

### 3-5. 응답 시간으로 새는 계정 존재 여부 (로그인 포함 — 사내도 해당)

```js
// 없는 계정에도 같은 비용의 비교를 한다 — 메시지가 같아도 시간이 다르면 계정 존재가 드러난다
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 12);   // 기동 시 1회, 실제 cost와 같게

async function verifyLogin(loginId, password) {
  const user = await userRepository.findByLoginId(loginId);
  const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
  return user && ok ? user : null;                                      // 판정은 둘 다 참일 때만
}
```

- 실측 2026-10-16 (Node 22, bcryptjs cost 12): 없는 계정이면 바로 반환하는 구현 → 있는 계정 **348ms** / 없는 계정 **0ms**. 더미 해시 비교 → 350ms / 355ms.
- 같은 원리가 가입(3-1절)·재설정 요청(3-3절)에도 적용된다 — "있을 때만 하는 무거운 일"(해시·동기 발송)이 없어야 한다.

## 4. 함정 (STRICT)

| 함정 | 증상 | 처방 |
|---|---|---|
| 없는 계정이면 해시 비교 없이 반환 | 응답 시간으로 계정 존재 판별 (실측 348ms vs 0ms) | 더미 해시 비교 (3-5절) |
| "이미 가입된 이메일입니다" 응답 | 가입 화면이 회원 명단 조회기가 된다 | 같은 응답 + 안내 메일 (3-1절) |
| 토큰을 쿼리 문자열에 | 접근 로그에 재설정 토큰 원문 (실측) | fragment (3-2절) |
| GET으로 토큰 소비 | 메일 보안 솔루션이 먼저 열어 토큰 소멸 | 화면 POST로만 소비 |
| 링크를 `Host` 헤더로 조립 | 공격자 도메인으로 가는 재설정 링크 | `APP_BASE_URL` |
| 비교 후 시도 횟수 증가 | 동시 요청으로 한도 무력화 (실측 50회 비교) | 먼저 소모 (3-4절) |
| 6자리 코드를 sha256만 | DB 유출 시 즉시 역산 | HMAC + 서버 비밀 |
| 토큰 원문 저장 | DB를 읽을 수 있는 사람이 남의 비밀번호를 바꾼다 | 해시만 |
| 재설정 후 기존 세션 유지 | 탈취범이 로그인 상태로 남는다 | 세션 전부 종료 + `token_version` 증가 |
| 재설정 후 자동 로그인 | 2단계 인증 우회 | 로그인 화면으로 |
| 대외에서 영구 잠금 | 남의 계정을 일부러 잠그는 공격 | 시간 해제 + 재설정 해제 |
| 가입 요청의 `role` 반영 | 관리자 계정 자가 생성 | 서버 기본값 |

## 5. 스택별 구현

| 구성 | Express | Spring |
|---|---|---|
| 토큰 생성 | `randomBytes(32).toString('base64url')` → `createHash('sha256')` | `SecureRandom` 32바이트 → `Base64.getUrlEncoder().withoutPadding()` → `MessageDigest("SHA-256")` |
| 코드 HMAC | `createHmac('sha256', key)` + `timingSafeEqual` | `Mac.getInstance("HmacSHA256")` + `MessageDigest.isEqual` |
| 조건부 소비 | `affectedRows === 1` 판정 (sql.md 8절) | `update()` 반환값 1 판정 |
| 더미 해시 | `bcrypt.compare(pw, hash ?? DUMMY_HASH)` | `passwordEncoder.matches(pw, hash != null ? hash : DUMMY_HASH)` |
| 메일 | notification.md outbox | 동일 |

## 6. 검증 포인트

- 자동화 테스트(테스트 DB): 있는/없는 이메일로 가입·재설정 요청 → 응답 본문·상태 동일 / 같은 토큰 동시 확정 2건 → 1건만 성공 / 만료·사용된 토큰 → 400 / 코드 동시 오입력 → 비교 5회 이하 / 재설정 후 기존 refresh → 401.
- 응답 시간: 있는/없는 계정 로그인 각 5회 평균 차이가 bcrypt 1회 비용보다 훨씬 작은지.
- 실동작 검증(/live-test): 실제 메일함에서 링크 클릭 → 주소창에 토큰이 `#` 뒤에 있는지, 프록시 접근 로그에 토큰이 없는지, 링크 도메인이 `APP_BASE_URL`인지.
