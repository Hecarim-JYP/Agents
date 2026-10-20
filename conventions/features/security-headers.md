# 레시피: 보안 헤더·CSP `[대외]`

> 확정: 2026-10-16 | 템플릿: `scaffolds/templates/nginx-proxy.conf`·`Caddyfile` (기본 헤더 내장, CSP는 주석으로 대기) | 원칙: ops.md 5절 2번 | 짝: upload-security.md(파일 응답 헤더)
> 보안 헤더는 **맨 앞 프록시 한 곳에서** 모든 응답(화면·API·파일)에 붙인다. CSP는 Vite 빌드 기준값을 쓰고, **켠 뒤 배포 화면에서 위반 0건을 확인**한다.

## 1. 언제 쓰나

대외 서비스는 3-1·3-2절 모두 필수. 사내 시스템은 3-1절(템플릿 기본 헤더)을 그대로 쓰고 CSP는 권장. **3-3절(helmet과 HTTP)은 Express가 HTML을 내려주는 모든 프로젝트에 해당**한다.

## 2. 결정 항목 (기본값)

| 결정 | 기본값 | 대안 / 비고 |
|---|---|---|
| 붙이는 위치 | **맨 앞 프록시** (nginx-proxy.conf / Caddyfile) | 앱(helmet)·client nginx에 나눠 두면 경로마다 빠지거나 중복된다 (3-4절) |
| 기본 헤더 | `nosniff` · `Referrer-Policy: strict-origin-when-cross-origin` · `X-Frame-Options: DENY` | 템플릿 기본값 |
| iframe 허용 | **없음(DENY)** | 사내 포털 등에 넣어야 하면 `X-Frame-Options`를 빼고 CSP `frame-ancestors <포털 출처>` — `X-Frame-Options`는 출처를 지정할 수 없다 |
| CSP | **3-2절 값** — 대외 필수, 사내 권장 | 외부 자원(폰트 CDN·지도·분석 스크립트)을 쓰면 해당 지시어에 그 출처만 추가 |
| HSTS | **HTTPS(Caddy)일 때 `max-age=31536000`** | `includeSubDomains`·`preload`는 같은 도메인 아래에 HTTP 서비스가 하나도 없을 때만 — 브라우저가 기억해 1년간 되돌릴 수 없다 |
| 도입 순서 | 새 프로젝트는 처음부터 적용. 운영 중 서비스는 `Content-Security-Policy-Report-Only`로 먼저 걸어 위반을 모은 뒤 전환 | |

## 3. 표준 설계

### 3-1. 기본 헤더 — 템플릿에 내장

| 프록시 | 구성 |
|---|---|
| nginx (`nginx-proxy.conf`) | server 블록에 `add_header … always;` 3줄 + `server_tokens off;` — **location 안에는 `add_header`를 두지 않는다** (3-4절) |
| Caddy (`Caddyfile`) | `header { … }` 블록 + HSTS + `-Server` |

- 실측 2026-10-16 (템플릿 그대로 기동, nginx 1.24 · Caddy 2.6.2): `/`·딥링크 `/orders/1`·`/api/…`·`/health` 전부 기본 헤더 부착, nginx `Server` 헤더에 버전 없음, Caddy `Server` 헤더 제거. CSP 줄을 켜면 같은 네 경로에 CSP 1개씩, Vite 앱 렌더링·지연 청크·주입 스타일 정상 + 콘솔 위반 0건.

### 3-2. CSP — Vite + React 빌드 기준값

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:;
font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
```

실측 2026-10-16 (Vite 5 + React 18 배포 빌드, Chromium):

- `script-src 'self'`만으로 앱 렌더링·지연 로딩 청크 모두 정상 — Vite 배포 빌드에는 인라인 스크립트가 없다.
- `style-src 'self'`만 두면 **실행 중에 주입되는 `<style>`이 거부된다** — shadcn/ui가 쓰는 Radix 컴포넌트는 react-style-singleton으로 `<style>`을 주입한다(레이아웃이 깨진다). 그래서 **스타일에만** `'unsafe-inline'`을 둔다. React의 `style={{…}}`(CSSOM)은 영향 없음(실측: 40px 적용).
- `img-src data: blob:` — 업로드 미리보기(`URL.createObjectURL`)와 data URI 아이콘용.
- 폰트(design.md 7절 — Pretendard 등)를 npm 패키지로 번들하면 `font-src 'self'`로 충분하다. CDN에서 받으면 그 출처를 `font-src`·`style-src`에 추가한다.
- **`upgrade-insecure-requests`를 넣지 않는다** — 3-3절.
- CSP는 프록시(배포 구성)에만 있으므로 Vite 개발 서버에서는 확인되지 않는다 — 배포 빌드로 확인한다(6절).

### 3-3. helmet과 HTTP 사내망 (STRICT)

**helmet 기본 CSP에는 `upgrade-insecure-requests`가 들어 있다** — 브라우저가 페이지의 하위 요청(JS·CSS·이미지)을 https로 바꿔 보낸다. HTTP로만 운영하는 사내 서버에서는 https 요청이 실패해 **빈 화면**이 된다. localhost는 예외라 **개발에선 정상, 운영(HTTP)에서만** 터진다.

- 실측 2026-10-16 (helmet 8.3, Chromium): `http://localhost` → 정상 / `http://<사내 IP>` → `https://<사내 IP>/app.js` 요청 실패, 화면 빈 상태 / helmet 없음 → 정상.
- Express가 HTML을 내려주는 구성(`express.static`·서버 렌더링)이면 이 지시어만 끈다 — `helmet({ contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } } })` (실측: 나머지 기본 CSP 유지 + HTTP 사내 IP에서 정상).
- 스캐폴드 구성(프록시 + client nginx가 정적 서빙)에서는 앱이 HTML을 내려주지 않으므로 helmet이 필요 없다 — 헤더는 프록시가 붙인다.

### 3-4. nginx `add_header` 상속 규칙

- nginx는 **현재 블록에 `add_header`가 하나라도 있으면 상위 블록의 `add_header`를 전부 상속하지 않는다.**
- 실측 2026-10-16 (nginx 1.24, 스캐폴드 client `nginx.conf`): server 블록에 CSP를 추가 → `/`와 딥링크 `/orders/1` 모두 **CSP 0개**. SPA fallback이 결국 `location = /index.html`(Cache-Control용 `add_header` 보유)에서 응답하기 때문이다. location마다 같은 헤더를 `include`하면 둘 다 1개.
- 그래서 템플릿은 **헤더를 프록시 server 블록에만 두고 location에는 `add_header`를 두지 않는다.** 예외: 점검 안내용 named location(`@api_unavailable`·`@page_unavailable`)은 자체 `add_header`가 있어 기본 헤더가 빠진다. Caddy도 `handle_errors`가 만든 점검 안내 응답에는 `header` 블록이 적용되지 않는다(실측: 두 프록시 모두 0개). 정적 문자열 응답이라 영향이 없어 그대로 둔다.
- client nginx에 헤더를 추가해야 한다면 location마다 `include`로 같은 줄을 넣는다.

## 4. 함정 (STRICT)

| 함정 | 증상 | 처방 |
|---|---|---|
| helmet 기본 CSP + HTTP 운영 | 운영에서만 빈 화면 (실측) | `upgradeInsecureRequests: null`, 또는 helmet 대신 프록시 헤더 |
| server 블록 `add_header` + location `add_header` | 화면 응답에 CSP가 빠진다 (실측 0개) | 프록시에서만 붙이기, 또는 location마다 include |
| `style-src 'self'`만 | 다이얼로그·드롭다운 레이아웃 깨짐 (실측: 주입 `<style>` 거부) | 스타일만 `'unsafe-inline'` |
| `X-Frame-Options: DENY` + 포털 iframe | 포털에서 빈 칸 | CSP `frame-ancestors` |
| HSTS `includeSubDomains` 성급 적용 | 같은 도메인의 HTTP 서비스가 1년간 접속 불가 | 단독 호스트만 |
| 개발 서버에서 CSP 확인 | 프록시가 없어 적용되지 않음 — "문제없다"로 오판 | 배포 구성으로 확인 |

## 5. 스택별 구현

| 구성 | Express | Spring |
|---|---|---|
| 기본 위치 | 프록시 템플릿 (앱 설정 불필요) | 동일 |
| 앱이 HTML을 내려줄 때 | `helmet({ contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } } })` | Spring Security 기본 헤더 = `nosniff`·`X-Frame-Options: DENY`·`X-XSS-Protection: 0`·`Cache-Control: no-cache, no-store, max-age=0, must-revalidate` — **CSP와 `Referrer-Policy`는 기본에 없다**: `headers(h -> h.contentSecurityPolicy(c -> c.policyDirectives(3-2절 값)).referrerPolicy(r -> r.policy(STRICT_ORIGIN_WHEN_CROSS_ORIGIN)))`. HSTS는 HTTPS 요청에만 붙는다 (실측 2026-10-20, Boot 4.1.1 · Security 7, HTTP 요청: 기본 4종만 / 설정 후 CSP·Referrer-Policy 추가, `upgrade-insecure-requests` 없음) |
| 중복 | 프록시와 앱이 같은 헤더를 붙이면 한쪽을 끈다 | 동일 |

## 6. 검증 포인트

- 배포 구성으로 기동 후 `curl -sI`로 `/`, 딥링크(`/orders/1`), `/api/...`, 파일 다운로드 각각에 기본 헤더(+CSP)가 붙는지 — 딥링크를 빠뜨리지 않는다(3-4절).
- 실동작 검증(/live-test 렌더링 축): CSP를 켠 배포 화면에서 **콘솔 CSP 위반 0건** — 주요 화면 + 다이얼로그·드롭다운·업로드 미리보기까지 열어 본다. HTTP 운영이면 **운영과 같은 사내 IP 주소로** 접속해 확인한다(3-3절).
