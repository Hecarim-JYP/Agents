# 레시피: 동시 로그인 제어·세션 강제 종료 `[사내]`

> 확정: 2026-10-14 | 테이블: `schemas/15_user_session.sql` + `user.token_version`(01_auth.sql) | 원칙: auth.md 2·3절(토큰·쿠키)
> 로그인 하나를 **세션 행 하나**로 관리한다. refresh 토큰은 해시만 저장하고 갱신할 때마다 회전한다. 기기별 종료는 세션 행으로, 사용자의 전부 종료는 `token_version`으로 한다.

## 1. 언제 쓰나

auth.md의 토큰 체계(access 메모리 + refresh httpOnly 쿠키)를 쓰는 모든 시스템. 특히 퇴사·권한 박탈 즉시 차단, "내 로그인 기기" 관리, 동시 로그인 제한 요구가 있을 때.

## 2. 결정 항목 (기본값)

| 결정 | 기본값 | 대안 / 비고 |
|---|---|---|
| 동시 로그인 | **허용** (사내 PC·노트북 동시 사용) | 보안 요구가 있으면 "1개만 — 새 로그인이 기존 세션을 종료(`NEW_LOGIN`)". "새 로그인 거부"는 쓰지 않는다(브라우저를 닫기만 한 사람이 다시 못 들어온다) |
| access 토큰 수명 | **15분** | auth.md 2절 "수 시간 이내" 안에서 짧게 — 기기별 종료가 반영되기까지의 최대 지연 |
| refresh 절대 만료 | **24시간** — 회전해도 늘지 않는다 | 사내 업무는 하루 1회 로그인이 일반적. 분실 PC 노출을 하루로 제한 |
| refresh 회전 | **갱신할 때마다 회전 + 재사용 감지 + 30초 유예** | 3-3절 |
| 사용자 전체 종료 | `user.token_version` 증가 — **요청마다 확인**(권한 조회와 함께, 짧은 캐시 — auth.md 4-3절) | 퇴사·계정 비활성·관리자 강제 종료 즉시 반영 |
| 쿠키 `Secure` | **HTTPS면 필수, HTTP 사내망이면 끈다** — 설정값 `COOKIE_SECURE` | 3-2절 — HTTP에서 `Secure`면 쿠키가 아예 저장되지 않는다(실측) |

## 3. 표준 설계

### 3-1. 수명 주기

| 사건 | 처리 |
|---|---|
| 로그인 | (2단계 인증 대상이면 코드 통과 후 — mfa.md 3-2절) `user_session` INSERT(`session_key` UUID, refresh 해시, `expires_at = NOW()+24h`) → access JWT에 `sid`(session_key)·`tv`(token_version) |
| 요청 | JWT 검증 + `tv`가 현재 `user.token_version`과 같은지(캐시 30초) |
| 갱신 | 3-3절 |
| 로그아웃 | 해당 세션 `revoked_at`·`LOGOUT` + 쿠키 삭제(**발급 때와 같은 Path**) |
| 비밀번호 변경 | 다른 세션 전부 `PASSWORD_CHANGED` + `token_version` 증가 → 현재 기기만 새로 발급 |
| 관리자 강제 종료·계정 비활성 | 그 사용자 세션 전부 `ADMIN` + `token_version` 증가 (audit_log 기록 — auth.md 5절) |
| 내 로그인 기기 | 본인 세션 목록(`user_agent`·`ip_address`·`last_used_at`) + 개별 종료 |

### 3-2. refresh 쿠키

```
Set-Cookie: rt=<토큰>; HttpOnly; SameSite=Lax; Path=/api/auth; [Secure — HTTPS일 때만]
```

- `Path=/api/auth` — refresh·logout에만 실려 가고 **업무 API 요청에는 붙지 않는다**(실측: `/api/orders` 요청에 쿠키 없음).
- ⚠ **HTTP 사내망에서 `Secure`를 붙이면 브라우저가 쿠키를 저장하지 않는다** — 새로고침마다 로그아웃된다. localhost는 예외로 저장되므로 **개발에선 정상, 운영(HTTP)에서만** 터진다(실측 2026-10-14, Chromium: `http://localhost`는 Secure 쿠키 전송 / `http://사내IP`는 전송 안 됨). `COOKIE_SECURE`를 `.env`에 명시하고(폴백 금지 — patterns.md 4절), HTTP 운영은 "쿠키가 평문으로 오간다"는 제약을 CLAUDE.md에 기록한다 (docker.md 7절).
- 쿠키 삭제는 **발급 때와 같은 Path**로 — `Path=/`로 지우면 `Path=/api/auth` 쿠키는 남는다(실측). 로그아웃했는데 refresh가 계속 되는 형태로 나타난다.

### 3-3. 갱신 — 회전, 재사용 감지, 유예

```
POST /api/auth/refresh (쿠키 rt):
 BEGIN
  ① SELECT … FROM user_session WHERE session_key = :sid FOR UPDATE      ← 같은 세션의 갱신을 차례로 처리
     없음·revoked·expires_at 지남 → 401
  ② sha256(rt) = refresh_token_hash                                   → 정상: ③
     sha256(rt) = prev_token_hash AND rotated_at > NOW() - 30초        → 여러 탭 동시 갱신: ③
     그 외                                                            → 재사용(탈취 의심): 세션 revoke(REUSE_DETECTED) + audit_log → 401
  ③ 새 토큰 발급 — prev_token_hash = refresh_token_hash, refresh_token_hash = sha256(새 토큰), rotated_at = NOW(), last_used_at = NOW()
 COMMIT → 새 access + Set-Cookie(새 rt)
```

- **여러 탭은 같은 쿠키를 공유한다** — 두 탭이 동시에 갱신하면 두 번째 요청은 이미 회전된 옛 토큰을 들고 온다. 유예가 없으면 정상 사용자가 **"재사용"으로 판정돼 로그아웃**된다(실측: 유예 0초 → 한쪽 401 + 세션 종료 / 유예 30초 → 둘 다 성공·세션 유지).
- 남는 한계: 두 응답이 도착 순서가 뒤바뀌어 브라우저에 **옛 토큰**이 남고 30초 안에 다시 갱신하지 않으면, 다음 갱신이 재사용으로 판정돼 재로그인을 요구한다. 드물고 안전한 쪽(로그아웃)으로 실패한다.
- 탭 간 갱신 순서 맞추기에 Web Locks(`navigator.locks`)를 쓰지 않는다 — **HTTP 사내망에서는 존재하지 않는다**(실측: localhost `object` / 사내 IP `undefined`). 탭 간 로그아웃 전파는 `BroadcastChannel`(HTTP에서도 동작 — 실측)로 한다.

## 4. 함정 (STRICT)

| 함정 | 증상 | 처방 |
|---|---|---|
| HTTP 운영에서 `Secure` 쿠키 | **운영에서만 새로고침마다 로그아웃** (실측) | `COOKIE_SECURE` 설정값 (3-2절) |
| 회전 + 재사용 감지에 유예 없음 | 탭 여러 개 쓰는 사용자가 수시로 튕긴다 (실측) | 30초 유예 (3-3절) |
| 갱신을 잠금 없이 처리 | 동시 갱신이 서로 덮어써 유예 판정이 어긋난다 | `FOR UPDATE` |
| refresh 원문 저장 | DB가 새면 모든 세션을 탈취당한다 | sha256 해시만 |
| 회전할 때 만료 연장 | 한 번 로그인하면 영원히 유지되는 세션 | `expires_at` 고정 |
| 쿠키 `Path=/` | 모든 API 요청에 refresh 토큰이 실려 간다 | `Path=/api/auth` (실측) |
| 삭제 Path 불일치 | 로그아웃 후에도 refresh 성공 (실측) | 같은 Path로 삭제 |
| 강제 종료가 access 만료까지 안 먹힘 | 퇴사자가 최대 15분 더 쓴다 | 사용자 단위는 `token_version` 요청마다 확인 |
| `navigator.locks`에 의존 | HTTP에서 `undefined` 오류 (실측) | 서버 유예 + `BroadcastChannel` |

## 5. 스택별 구현

| 구성 | Express | Spring |
|---|---|---|
| 쿠키 | `res.cookie('rt', token, { httpOnly: true, sameSite: 'lax', path: '/api/auth', secure: env.COOKIE_SECURE })` / 삭제 `res.clearCookie('rt', { path: '/api/auth' })` | `ResponseCookie.from("rt", token).httpOnly(true).sameSite("Lax").path("/api/auth").secure(cookieSecure)` |
| 갱신 | 서비스 트랜잭션에서 3-3절 (`SELECT … FOR UPDATE`) | `@Transactional` + 같은 SQL |
| `token_version` 확인 | 인증 미들웨어에서 권한 조회와 함께 (캐시 30초 — cache.md) | 인증 필터 |
| 탭 간 로그아웃 | `new BroadcastChannel('auth')` → 다른 탭이 로그인 화면으로 | 동일(프론트) |

## 6. 검증 포인트

- 자동화 테스트(테스트 DB): 같은 토큰 동시 갱신 2건 → 둘 다 성공 / 30초 지난 옛 토큰 → 401 + 세션 종료 / 만료된 세션 → 401 / 비밀번호 변경 → 다른 세션 갱신 401 / `token_version` 증가 → 기존 access 401.
- 실동작 검증(/live-test 관찰자 모드): **운영과 같은 HTTP 주소로 접속해서** 로그인 → 새로고침해도 유지되는지, 탭 3개를 열어 두고 15분 이상 사용, 관리자 강제 종료 후 즉시 차단되는지.
