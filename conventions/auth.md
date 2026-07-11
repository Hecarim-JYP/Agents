# 인증·권한 구현 표준 (JYP)

로그인이 있는 모든 시스템에 적용한다. 점검용 체크리스트는 ops.md 5절, 신뢰값 주입은 express.md 5절.
이 문서의 원칙은 **백엔드 스택 무관**이다 — 스택별 구현 도구는 6절 매핑 표 참조.

## 1. 비밀번호 (STRICT)

- 저장은 **bcrypt 또는 argon2 해시**로만. 평문·복호화 가능 암호화·MD5/SHA 단독 해시 금지.
- 로그인 실패 메시지는 모호하게: "아이디 또는 비밀번호가 올바르지 않습니다" (계정 존재 여부를 노출하지 않는다).
- 실패 횟수 제한 + 계정 잠금(예: 5회 실패 시 잠금, 관리자 해제)을 구현한다.

## 2. 토큰 (JWT 기준)

- **access token은 짧게**(수 시간 이내) + **refresh token으로 갱신** — 장기 access 토큰(수십 일) 금지 (근거: 탈취 시 만료까지 무방비).
- 시크릿은 환경변수로만(길고 랜덤하게), 페이로드에 비밀번호·민감정보 금지 — JWT는 암호화가 아니라 서명이며 내용은 누구나 읽는다.
- 페이로드 표준: 사용자 ID, 테넌트/회사 ID, 역할 코드 — 이것이 `req.user` 신뢰값의 원천이다.
- **서버 측 무효화 수단 필수**: 강제 로그아웃·계정 비활성화·권한 변경 시 기존 토큰을 무효화할 수 있어야 한다 (토큰 버전 컬럼 또는 세션 상태 확인). "만료까지 기다리기"는 무효화가 아니다.

## 3. 토큰 저장 — 클라이언트 (STRICT)

- **localStorage / sessionStorage에 토큰 저장 금지** (근거: JS로 읽을 수 있어 XSS 한 번에 토큰이 탈취된다).
- 표준 패턴: **access token은 메모리(앱 상태)에만 보관 + refresh token은 `httpOnly` + `Secure` + `SameSite=Lax` 쿠키**.
  - 새로고침 시 refresh 쿠키로 access를 재발급받는다(silent refresh) — 첫 로드에 재발급 API 1회 호출.
  - XSS로는 refresh 쿠키를 읽을 수 없고, CSRF로는 access token을 얻을 수 없는 조합.
- 쿠키를 쓰므로 **CSRF 대응 필수**: `SameSite` 속성 + 상태 변경 요청(POST/PUT/DELETE)은 커스텀 헤더(예: `Authorization: Bearer <access>`) 요구 — 단순 폼 전송으로는 위조 불가.
- CORS 사용 시 `credentials: true`(양쪽) 설정, origin 화이트리스트 필수 (ops.md 5절 1번).
- 이 규칙은 백엔드가 Node든 Spring이든 동일하다 — 저장 위치는 브라우저 보안 모델의 문제다.

## 4. 권한 모델 (RBAC + 스코프)

**RBAC은 "기능 접근"만 답한다. "데이터 접근"은 스코프 층이 별도로 필요하다 — 둘을 혼동하면 역할 게이트가 있어도 남의 데이터를 조회·수정할 수 있는 결함이 생긴다.**

### 4-1. 기능 접근 (RBAC)
- 2단 구조: **역할(role)** + **액션 권한 코드(`{module}.{action}`)** (예: `ct_request.create`, `mail.send`).
- 화면 게이트(버튼 숨김/비활성)는 UX, **서버 게이트가 보안** — 같은 권한 코드로 클라·서버 양쪽에 적용한다 (design/react 권한 게이트 규칙과 연계).
- 관리자·설정 엔드포인트는 `requireRole`/`requirePermission` 미들웨어 필수 (express.md 5절).
- **기본은 거부(default deny)**: 인증이 필요 없는 공개 경로는 명시적 화이트리스트로 관리하고, 그 외 모든 라우트는 인증 미들웨어를 기본 통과한다.

### 4-2. 데이터 접근 (스코프 3종)
1. **테넌트 스코프**: 회사/조직 구분값은 서버가 토큰 신뢰값으로 강제 주입 — 모든 쿼리의 기본 필터 (express.md 5절, sql.md 7절).
2. **소유권 검증**: "본인 것만 수정 가능" 류의 규칙은 원본 조회 직후, 필드 권한 검사 전에 owner 컬럼과 `req.user.id`(신뢰값)를 비교한다. 양쪽 null 가드 필수(`null == null` 거짓 통과 방지).
3. **목록 가시성 스코프**: 특정 역할은 목록에서 본인 관련 행만 보이는 요구가 흔하다 — 역할별 listScope를 쿼리 레벨에서 적용 (화면 필터링으로 대체 금지: 응답에 이미 남의 데이터가 실려 나간다).

### 4-3. 권한 데이터 관리
- 역할·권한·매핑은 DB 테이블로 관리한다 (`role`, `permission`, `role_permission`).
- **권한 변경 반영 시점을 정한다 (기본: 매 요청 조회 + 짧은 캐시)** — 토큰에 권한을 굽는 방식은 토큰 만료까지 옛 권한이 유지되므로, 굽는 건 역할 코드까지만 하고 세부 권한은 서버에서 조회한다.
- **권한 상승 방지**: 자기 자신의 역할·권한 변경 금지, 역할/권한 부여는 관리자 권한 게이트 뒤에서만, 변경 이력 기록(5절).

## 5. 감사(Audit)

- 로그인 성공/실패, 계정 잠금, 권한 변경은 이력을 남긴다 (누가·언제·어디서).
- 결재/승인처럼 법적·업무적 책임이 걸린 행위는 행위 시점의 스냅샷(서명, 직급 등)을 동결 저장한다 — 이후 정보가 바뀌어도 당시 기록이 유지되어야 한다.

## 6. 스택별 구현 매핑

원칙(1~5절)은 동일하고 도구만 다르다. 새 스택 채택 시 이 표에 열을 추가한다.

| 구성 요소 | Node/Express | Spring |
|---|---|---|
| 인증 필터 | 커스텀 미들웨어 (`authenticateToken`) | Spring Security `SecurityFilterChain` |
| 권한 게이트 | `requireActionPermission('module.action')` | `@PreAuthorize("hasAuthority('module.action')")` |
| JWT 발급/검증 | jsonwebtoken 또는 jose | jjwt / spring-security-oauth2-resource-server |
| 비밀번호 해싱 | bcrypt | `BCryptPasswordEncoder` |
| refresh 쿠키 | `res.cookie(..., { httpOnly, secure, sameSite })` | `ResponseCookie` + `HttpOnly/Secure/SameSite` |
| CSRF | SameSite + Bearer 헤더 요구 (3절) | Spring Security CSRF 설정 (토큰 방식이면 비활성 + 3절 방식) |

- Spring을 실제 채택하는 시점에 `spring.md`(계층·구현 패턴)를 express.md에 준해 작성한다.
