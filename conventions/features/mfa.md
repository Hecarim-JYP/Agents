# 레시피: 2단계 인증(TOTP) `[대외]`

> 확정: 2026-10-16 | 테이블: `schemas/17_user_mfa.sql` | 원칙: auth.md 1·2절 | 짝: session-control.md(세션 발급 시점), account-lifecycle.md(재설정 후 자동 로그인 금지), rate-limit.md
> 비밀번호가 맞아도 **세션은 아직 주지 않는다** — 짧은 "2단계 대기 증표"만 주고, 인증 앱 코드까지 통과해야 세션을 만든다. 같은 코드는 **한 번만** 통과한다.

## 1. 언제 쓰나

대외 서비스의 관리자(운영자 화면) 계정, 금전·개인정보를 다루는 계정, 이용자가 선택하는 보안 옵션. SSO(auth.md 0절 c)는 IdP가 2단계를 담당하므로 해당 없다.

## 2. 결정 항목 (기본값)

| 결정 | 기본값 | 대안 / 비고 |
|---|---|---|
| 방식 | **TOTP(인증 앱)** — RFC 6238, SHA1·6자리·30초 (인증 앱 호환 표준값) | 문자 OTP는 유심 복제에 약하고 건당 비용 — 요구가 있을 때만, 코드 규칙은 account-lifecycle.md 3-4절 |
| 대상 | **관리자 필수, 일반 이용자 선택** | |
| 시계 허용 오차 | **±1단계(30초)** | 서버 시계는 호스트 NTP를 따른다 |
| 실패 한도 | **로그인 실패 횟수에 합산**(auth.md 1절 잠금) — 2단계 실패도 `failed_login_count`를 올린다 | 별도 카운터를 두지 않는다 — 비밀번호만 맞힌 공격자가 코드를 무한히 시도하지 못하게 |
| 대기 증표 수명 | **5분** | |
| 복구 코드 | **10개, 16자(80비트), 1회용** — 등록 완료 응답에서 한 번만 보여준다 | 남은 개수가 2개 이하면 재발급 안내 |
| 비밀 보관 | **AES-256-GCM 암호화**, 키는 환경변수 `MFA_ENC_KEY`(32바이트, base64) | 해시 불가 — 서버가 코드를 계산하려면 원문이 필요 |
| 이 기기 기억 | **하지 않음** | 요구가 생기면 별도 결정 — 기기 쿠키 수명·폐기 규칙 |

## 3. 표준 설계

### 3-1. 등록

```
① POST /api/me/mfa/totp/setup
   → 20바이트 비밀 생성, user_mfa INSERT(enabled_at NULL) → otpauth URI 반환 → 화면이 QR로 표시
② POST /api/me/mfa/totp/confirm { code }
   → 3-3절 검증(확인 모드) 통과 시 enabled_at = NOW() + 복구 코드 10개 발급(원문은 이 응답에서만)
```

- **확인 전(`enabled_at` NULL)에는 로그인에서 요구하지 않는다** — QR 스캔에 실패한 사람이 잠기지 않는다.
- 재등록(휴대폰 교체): 현재 코드 또는 복구 코드 확인 → 기존 행·복구 코드 삭제 → ①부터.
- 해제: 비밀번호 + 현재 코드를 요구하고 해제 알림 메일을 보낸다. 관리자처럼 필수 대상은 해제할 수 없다.

### 3-2. 로그인

```
POST /api/auth/login { login_id, password }  → 비밀번호 확인 (account-lifecycle.md 3-5절)
  2단계 없음 → 세션 발급 (session-control.md 3-1절)
  2단계 있음 → 200 { mfa_required: true, mfa_token }
               mfa_token = 5분짜리 서명 토큰 { sub: user_id, purpose: 'mfa' } — access 토큰이 아니다(업무 API는 거부)
POST /api/auth/mfa { mfa_token, code | recovery_code }
  ① 실패 횟수를 먼저 소모: UPDATE user SET failed_login_count = failed_login_count + 1
       WHERE user_id = :id AND locked_at IS NULL AND failed_login_count < :threshold     ← 0행이면 잠금 처리 → 401 ACCOUNT_LOCKED
  ② 3-3절 검증(또는 3-4절 복구 코드) → 성공이면 failed_login_count = 0 + 세션 발급
```

- **비밀번호 확인 직후 세션을 만들면 2단계가 무의미하다** — 세션은 ②가 끝난 뒤에만.
- 시도 횟수는 비교하기 **전에** 조건부 UPDATE로 소모한다 — 비교 후 증가는 동시 요청에서 한도가 사라진다 (account-lifecycle.md 3-4절 실측과 같은 구조).

### 3-3. 코드 검증 — 같은 코드는 한 번만

```js
import * as OTPAuth from 'otpauth';

/**
 * TOTP 코드 검증 — 통과한 시간 단계를 조건부 UPDATE로 올려 같은 단계·이전 단계 코드의 재사용을 거부한다
 * @param {number} userId 사용자 PK
 * @param {string} code 입력한 6자리 코드
 * @param {boolean} confirming 등록 확인 단계인지(enabled_at이 NULL인 행을 대상으로)
 */
async function verifyTotp(userId, code, confirming = false) {
  const row = await mfaRepository.findByUserId(userId);
  const totp = new OTPAuth.TOTP({ secret: new OTPAuth.Secret({ buffer: decryptSecret(row.secret_enc) }) });
  const now = Date.now();                                           // validate와 단계 계산에 같은 시각을 쓴다
  const delta = totp.validate({ token: code, timestamp: now, window: 1 });   // null | -1 | 0 | 1
  if (delta === null) return false;
  const step = Math.floor(now / 1000 / 30) + delta;
  return mfaRepository.advanceStep(userId, step, confirming);       // 아래 SQL — 1행이면 통과
}
```

```sql
-- 로그인: enabled_at IS NOT NULL / 등록 확인: enabled_at IS NULL + SET enabled_at = NOW()
UPDATE user_mfa SET last_used_step = :step
 WHERE user_id = :userId AND enabled_at IS NOT NULL
   AND (last_used_step IS NULL OR last_used_step < :step)
```

- **otpauth의 `validate`는 같은 코드를 몇 번이든 통과시킨다** — 재사용 방지는 우리 몫이다 (실측 2026-10-16, otpauth 9.5: 같은 코드 2회 → 두 번 다 delta 0).
- 실측 2026-10-16 (위 코드 그대로, MariaDB 10.11): 현재 코드 동시 2건 → **1건만 통과** / 같은 코드 재사용 → 거부 / 이미 통과한 단계보다 이전 단계 코드 → 거부 / 확인 전 등록으로 로그인 검증 → 거부.
- 라이브러리 정확성: otpauth 9.5와 node:crypto 직접 구현 모두 RFC 6238 부록 B 테스트 벡터 6/6 일치 (실측). 다른 라이브러리를 쓰면 같은 벡터로 먼저 확인한다.

### 3-4. 복구 코드와 비밀 암호화

```js
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// 복구 코드: 10바이트 랜덤 → base32 16자, 표시는 XXXX-XXXX-XXXX-XXXX. 저장은 sha256 (80비트라 역산 불가)
const recoveryCodes = Array.from({ length: 10 }, () => new OTPAuth.Secret({ size: 10 }).base32);
// 사용: 입력에서 '-' 제거 + 대문자 → UPDATE … SET used_at = NOW() WHERE user_id = :u AND code_hash = :h AND used_at IS NULL (1행이면 통과)

const MFA_KEY = Buffer.from(process.env.MFA_ENC_KEY, 'base64');   // 32바이트 — 없으면 기동 실패(폴백 금지, patterns.md 4절)

/** TOTP 비밀 암호화 — 결과는 iv(12) + 인증 태그(16) + 암호문 */
function encryptSecret(plain) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', MFA_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}

/** TOTP 비밀 복호화 — 태그가 맞지 않으면(변조·다른 키) 예외 */
function decryptSecret(blob) {
  const decipher = createDecipheriv('aes-256-gcm', MFA_KEY, blob.subarray(0, 12));
  decipher.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]);
}
```

- 실측 2026-10-16: 20바이트 비밀 → `secret_enc` 48바이트, 복호화한 비밀로 코드 검증 정상 / 복구 코드 동시 2회 사용(대·소문자 섞어 입력) → 1회만 통과.
- 키를 바꿀 때는 `key_version`으로 어느 키로 풀지 구분하고, 로그인 성공 시 새 키로 다시 암호화해 점진 교체한다.

## 4. 함정 (STRICT)

| 함정 | 증상 | 처방 |
|---|---|---|
| 비밀번호 확인 직후 세션 발급 | 2단계를 건너뛰고 업무 API 호출 | 대기 증표만, 세션은 코드 통과 후 |
| 재사용 방지 없음 | 엿본·가로챈 코드를 30~90초 안에 재사용 (라이브러리는 막지 않는다 — 실측) | `last_used_step` 조건부 UPDATE |
| 2단계 실패를 세지 않음 | 비밀번호만 맞힌 공격자가 코드를 무한 대입 | 로그인 실패 횟수에 합산, 먼저 소모 |
| 등록 확인 전에 활성화 | QR 스캔 실패한 사람이 영구히 못 들어온다 | `enabled_at`은 첫 코드 확인 후 |
| TOTP 비밀 평문 저장 | DB 유출 = 모든 2단계 무력화 | AES-GCM + 환경변수 키 |
| 복구 코드 원문 저장·재표시 | DB 유출 시 그대로 사용 | sha256 저장, 원문은 발급 응답 한 번 |
| 비밀번호 재설정 후 자동 로그인 | 2단계 우회 | 로그인 화면으로 (account-lifecycle.md 2절) |
| 시간 허용 오차를 넓게 | 유효 코드가 늘어 대입 성공률 증가 | ±1단계 |

## 5. 스택별 구현

| 구성 | Express | Spring |
|---|---|---|
| TOTP | `otpauth` (9.5 실측) | RFC 6238 구현 라이브러리 — 부록 B 벡터로 검증 후 채택 (이 레시피에서 미검증) |
| QR | 화면에서 otpauth URI를 QR로 렌더링 (`qrcode` 등) — 비밀이 외부 QR 서비스로 나가지 않게 | 동일 |
| 암호화 | `node:crypto` `aes-256-gcm` | `Cipher.getInstance("AES/GCM/NoPadding")` + `GCMParameterSpec(128, iv)` |
| 대기 증표 | jose/jsonwebtoken, `purpose: 'mfa'` + 5분 — 인증 미들웨어는 `purpose`가 있는 토큰을 거부 | 동일 원칙 |

## 6. 검증 포인트

- 자동화 테스트(테스트 DB): RFC 6238 벡터 / 같은 코드 동시 2건 → 1건만 / 재사용·이전 단계 → 거부 / 대기 증표로 업무 API → 401 / 2단계 실패 반복 → 잠금 / 복구 코드 1회용.
- 실동작 검증(/live-test): 실제 인증 앱(Google Authenticator·Microsoft Authenticator 등)으로 QR 등록 → 로그인, 서버 시계 확인(코드가 계속 틀리면 호스트 NTP부터).
