# 레시피: 소셜 로그인·계정 연결 (카카오·네이버·구글) `[대외]` ⚑

> 확정: 2026-10-19 | 테이블: `schemas/18_user_identity.sql` + `user.password_hash` NULL 허용 | 원칙: auth.md 0절(검증에 성공하면 **우리 토큰**을 발급) | 짝: account-lifecycle.md(이메일 인증), session-control.md, account-withdrawal.md(연결 끊기)
> 사람은 **(제공사, 제공사 사용자 ID)** 로 식별한다 — 이메일로 식별하지 않는다. 같은 이메일의 기존 계정에 **자동으로 연결하는 것은 양쪽 모두 인증된 이메일일 때만**이다.

## 1. 언제 쓰나

고객용 대외 서비스에서 카카오·네이버·구글 등으로 가입·로그인을 받을 때. 사내 SSO(auth.md 0절 c)는 이 레시피가 아니다 — IdP가 하나이고 계정 연결 문제가 없다.

⚑ 되돌리기 어려운 이유: 식별 키를 이메일로 잡으면 제공사 이메일 변경·부재 때마다 계정이 갈라지거나 합쳐진다. 그리고 카카오 회원번호처럼 **앱 단위로 발급되는 ID**는 제공사 개발자 앱을 바꾸면 값이 바뀐다 — 앱(클라이언트 ID)을 처음부터 운영용으로 만든다.

## 2. 결정 항목 (기본값)

| 결정 | 기본값 | 대안 / 비고 |
|---|---|---|
| 식별 키 | **`(provider, provider_user_id)`** — OIDC `sub`, 카카오 회원번호 | 이메일 식별 금지 |
| 프로토콜 | **OIDC가 되면 OIDC**(구글·카카오 — ID 토큰 서명 검증) + `state` + PKCE(S256) + `nonce` | 제공사가 OAuth만 주면 토큰으로 사용자 정보 API 호출 |
| 같은 이메일의 기존 계정 | **양쪽 다 인증된 이메일이면 연결.** 기존 계정이 미인증이면 그 계정의 비밀번호·세션을 무효화하고 연결(인증된 소유자가 이긴다) | 자동 연결을 아예 끄고 "기존 계정으로 로그인한 뒤 연결" — 안전하지만 사용자가 헤맨다 |
| 제공사가 이메일 인증 여부를 안 줄 때 | **미인증으로 취급** — 자동 연결 없음, 새 계정 | |
| 이메일이 없을 때 | **이메일 없이 가입 허용** — 필요하면 가입 후 받고 인증(account-lifecycle.md 3-2절) | 카카오는 전화번호만으로 만든 계정이 있어 이메일이 비어 올 수 있다 |
| 제공사 토큰 | **저장하지 않는다** — 로그인 직후 우리 세션 발급 | 제공사 API를 계속 쓰면 암호화 저장(mfa.md 3-4절 방식) |
| 탈퇴 | **제공사 연결 끊기 호출 + `user_identity` 삭제** | account-withdrawal.md 3-2절 |

## 3. 표준 설계

### 3-1. 로그인 흐름

```
GET /api/auth/{provider}/start
 → state(32바이트 랜덤)·PKCE verifier·nonce를 서버 세션(짧은 쿠키, 10분)에 저장
 → 제공사 인가 URL로 302 (code_challenge=S256, state, nonce, redirect_uri = APP_BASE_URL 기준 고정값)
GET /api/auth/{provider}/callback?code&state
 ① state가 저장값과 같은지 (다르면 400 — 남이 만든 로그인 응답을 끼워 넣는 로그인 CSRF 차단)
 ② code + verifier로 토큰 교환 (external/ 연동 계층 — 타임아웃, integration.md)
 ③ OIDC: ID 토큰 서명(JWKS)·iss·aud·exp·nonce 검증 → sub·email·email_verified
    OAuth만: 사용자 정보 API → id·email·(인증 여부 필드)
 ④ 3-2절 연결 판정 → user_id
 ⑤ 우리 세션 발급 (session-control.md 3-1절, 2단계 인증 대상이면 mfa.md 3-2절)
```

- `redirect_uri`는 `APP_BASE_URL`로 고정하고 제공사 콘솔에도 같은 값만 등록한다 — 요청 값으로 조립하지 않는다(account-lifecycle.md 3-2절 `Host` 함정과 같은 이유).
- 제공사별 사양(확인 범위 — 2026-10-19):
  - **구글**: OIDC discovery 원문 확인 — `email_verified` 클레임, PKCE `S256` 지원.
  - **카카오**: OIDC를 활성화하면 ID 토큰 발급(`scope`에 `openid` 포함 필요, 공식 문서 검색 결과). 이메일 인증 여부는 `kakao_account.is_email_verified`·`is_email_valid`(SDK 문서). 회원번호는 **앱에 종속**돼 앱을 바꾸면 달라진다(카카오 데브톡). discovery 문서·PKCE 지원은 이 환경에서 확인하지 못했다.
  - **네이버**: OIDC 지원 여부·이메일 인증 필드를 공식 문서로 확인하지 못했다 — 채택 시 개발자센터 문서로 확인하고, 인증 여부를 알 수 없으면 2절대로 미인증 취급.

### 3-2. 연결 판정 — 사전 가입 탈취를 막는다

```js
/**
 * 소셜 로그인 결과를 우리 계정에 연결 — 식별은 (provider, sub), 이메일 자동 연결은 양쪽 모두 인증일 때만
 * @param {{ provider: string, sub: string, email?: string, emailVerified: boolean }} claims 검증을 마친 제공사 정보
 */
async function resolveUser(claims) {
  const linked = await identityRepository.find(claims.provider, claims.sub);
  if (linked) return linked.user_id;                                    // 이미 연결된 계정

  const existing = claims.email && claims.emailVerified ? await userRepository.findByLoginId(claims.email) : null;
  if (!existing) return userRepository.createSocialUser(claims);       // 새 계정 (password_hash NULL)

  if (!existing.email_verified_at) {
    // 누군가 이 이메일로 먼저 가입만 해 두고 인증하지 않은 계정 — 그 비밀번호·세션을 무효화한다(인증된 소유자가 이긴다)
    await userRepository.revokePasswordAndSessions(existing.user_id);  // password_hash = NULL, token_version + 1
  }
  await identityRepository.link(existing.user_id, claims);            // UNIQUE(provider, provider_user_id)가 중복 연결의 최종 방어
  await userRepository.markEmailVerified(existing.user_id);
  return existing.user_id;
}
```

- 실측 2026-10-19 (MariaDB 10.11 시뮬레이션 — 공격자가 피해자 이메일 + 공격자 비밀번호로 먼저 가입(미인증), 피해자가 구글(`email_verified: true`)로 로그인):
  - "이메일이 같으면 연결 + 인증 처리" → 피해자 계정이 **인증 완료 상태가 되고 공격자 비밀번호로 로그인 가능**
  - 위 코드 → 연결은 되지만 공격자 비밀번호 무효 / 제공사가 `email_verified`를 주지 않으면 자동 연결 거부
- 이 유형(사전 가입 탈취)은 인증 라이브러리에서 반복해서 공개·수정됐다(2026년에도 여러 건) — 공통 원인은 **제공사의 `email_verified`만 믿고 우리 쪽 기존 계정의 인증 여부를 보지 않은 것**이다. 라이브러리의 자동 연결 기능을 켤 때도 이 조건을 직접 확인한다.

### 3-3. 스키마 조정

- `user.password_hash`를 **NULL 허용**으로 바꾼다 — 소셜 전용 사용자는 비밀번호가 없다. 로그인 코드는 `password_hash`가 NULL이면 비밀번호 로그인을 거부한다(bcrypt 비교 전에).
- 소셜 전용 사용자가 비밀번호를 추가하려면 비밀번호 재설정 흐름(account-lifecycle.md 3-3절)을 쓴다 — 이메일 소유 확인이 함께 된다.
- 연결 해제: 로그인 수단이 하나만 남으면 해제를 막는다(비밀번호도 다른 연결도 없으면 계정에 들어올 방법이 사라진다).

## 4. 함정 (STRICT)

| 함정 | 증상 | 처방 |
|---|---|---|
| 이메일이 같으면 자동 연결 | 미인증 사전 가입 계정을 통한 계정 탈취 (실측) | 양쪽 인증 확인 + 미인증 계정 무효화 |
| 이메일로 사용자 식별 | 제공사 이메일 변경 시 다른 사람으로 인식, 이메일 없는 계정은 가입 불가 | `(provider, sub)` |
| `state` 검증 생략 | 공격자 계정으로 피해자를 로그인시키는 로그인 CSRF | `state` 필수 |
| ID 토큰 서명·`aud` 검증 생략 | 다른 앱용 토큰으로 로그인 | 라이브러리 검증(JWKS·iss·aud·exp·nonce) |
| 개발용 제공사 앱으로 운영 시작 | 나중에 앱을 바꾸면 회원번호가 바뀌어 전원 재가입 | 처음부터 운영 앱 |
| 제공사 토큰을 로그인 응답으로 화면에 | 제공사 권한 토큰이 브라우저에 노출 | 서버에서만 쓰고 버린다 |
| 마지막 로그인 수단 해제 허용 | 계정에 다시 들어올 수 없다 | 해제 전 남은 수단 확인 |

## 5. 스택별 구현

| 구성 | Express | Spring |
|---|---|---|
| OIDC·PKCE·state | `openid-client` (auth.md 6절) | `spring-boot-starter-oauth2-client` (카카오·네이버는 provider 직접 등록) |
| 연결 판정 | 3-2절 (서비스 계층) | 동일 — `OAuth2UserService` 구현 안에서 |
| 우리 세션 발급 | session-control.md | 동일 |

## 6. 검증 포인트

- 자동화 테스트: 사전 가입(미인증) 계정 + 같은 이메일 소셜 로그인 → 기존 비밀번호로 로그인 불가 / `email_verified` 없음 → 새 계정 / 같은 `(provider, sub)` 두 번째 로그인 → 같은 user_id / `state` 불일치 → 400.
- 실동작 검증(/live-test): 각 제공사 테스트 계정으로 가입·로그인·연결·해제, 카카오 전화번호 가입 계정(이메일 없음)으로 가입.
