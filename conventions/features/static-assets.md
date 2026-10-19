# 레시피: 정적 자산 — 배포 후 옛 청크, 압축, 캐시, CDN, 이미지 리사이즈 `[대외]`

> 확정: 2026-10-19 | 템플릿: `scaffolds/templates/nginx.conf`(캐시 헤더)·`nginx-proxy.conf`·`Caddyfile`(압축) | 짝: zero-downtime-deploy.md(client 교체), upload-security.md(업로드 이미지), error-pages.md(흰 화면)
> 해시가 붙은 자산은 **영원히 캐시**하고, HTML은 **매번 확인**한다. 배포하면 옛 청크가 사라지므로 **열려 있던 탭은 새로고침으로 넘긴다.** 사용자별 파일에는 **`Cache-Control: private`** 를 붙여 중간 캐시가 남에게 주지 않게 한다.

## 1. 언제 쓰나

Vite로 빌드한 SPA를 배포하는 모든 프로젝트(3-1·3-2·3-3절). CDN을 앞에 두거나 이미지 목록 화면이 있는 대외 서비스(3-4·3-5절).

## 2. 결정 항목 (기본값)

| 결정 | 기본값 | 대안 / 비고 |
|---|---|---|
| 캐시 정책 | `/assets/*` 1년 + `immutable`, `index.html` `no-cache` (템플릿) | 바꾸지 않는다 |
| 배포 후 열린 탭 | **청크 로드 실패 시 1회 새로고침** (`vite:preloadError`) | 옛 자산을 다음 이미지에도 남기는 방식 — 이미지 빌드가 직전 이미지에 의존해 복잡해진다 |
| 압축 | **맨 앞 프록시에서 gzip**(nginx) / zstd·gzip(Caddy) (템플릿) | 빌드 시 미리 압축(`gzip_static`) — 자산이 커서 CPU가 문제일 때 |
| CDN | **사내: 없음 / 대외: 필요 시 정적 자산만** | API·사용자 파일은 CDN을 거치지 않거나, 거치면 3-4절 헤더 필수 |
| 목록 이미지 | **업로드 시 썸네일을 미리 만든다**(upload-security.md 재인코딩 단계에서 함께) | 요청 때 생성 — 3-5절 비용 |

## 3. 표준 설계

### 3-1. 배포 후 열린 탭 — 청크 실패 시 새로고침

배포로 client 이미지가 바뀌면 옛 빌드의 청크 파일은 사라진다. 배포 전에 화면을 열어 둔 사용자가 지연 로딩 화면으로 이동하면 옛 청크를 요청한다.

```js
// main.jsx — 앱 진입점 맨 위. 청크를 못 받으면 새 index.html을 다시 받는다(같은 탭에서 10초 안 재시도는 하지 않는다 — 무한 새로고침 방지)
window.addEventListener('vite:preloadError', (event) => {
  const last = Number(sessionStorage.getItem('chunk-reload-at') ?? 0);
  if (Date.now() - last < 10_000) return;           // 방금 새로고침했는데 또 실패 — 진짜 장애. 에러 화면에 맡긴다(error-pages.md)
  sessionStorage.setItem('chunk-reload-at', String(Date.now()));
  event.preventDefault();
  window.location.reload();
});
```

- 실측 2026-10-19 (Vite 5 + React 18 빌드 v1→v2, 스캐폴드 nginx.conf, Chromium): 처리 없음 → 청크 **404 → 화면 전체가 빈다**(root 내용 0). 위 코드 → 새로고침 후 v2 청크 200, 화면 정상.
- 새로고침이 동작하는 전제는 **`index.html`이 `no-cache`**라는 것이다(템플릿) — 캐시된 옛 `index.html`이 다시 옛 청크를 가리키면 소용없다.
- 입력 중이던 폼이 있는 화면은 새로고침으로 내용을 잃는다 — 긴 입력 화면은 이탈 전 임시 저장 같은 별도 대책이 필요하다.

### 3-2. 압축 — 프록시 한 곳에서

- **베이스 이미지(`nginx-unprivileged:1.27`)의 nginx.conf는 `#gzip on;`으로 꺼져 있다**(실측) — 템플릿이 켜지 않으면 JS·JSON이 압축 없이 나간다.
- 실측 (최종 템플릿): nginx — JS 143,738 → **54,312바이트**, 목록 JSON 10,100 → **589바이트** / Caddy `encode zstd gzip` — JS 48,367바이트(gzip), JSON 328바이트(zstd).
- ⚠ nginx `gzip`은 **상태 200·403·404 응답만** 압축한다 — 201 응답은 압축되지 않는다(실측). 큰 목록은 GET 200으로 내려준다.
- `gzip_vary on` — 압축본과 원본을 구분해 캐시하라고 중간 캐시·CDN에 알린다(템플릿).

### 3-3. 캐시 헤더 — 이미 템플릿에 있는 것

| 경로 | 헤더 | 이유 |
|---|---|---|
| `/assets/*` (파일명에 해시) | `expires 1y` + `Cache-Control: public, immutable` | 내용이 바뀌면 파일명이 바뀐다 |
| `index.html`·SPA fallback | `Cache-Control: no-cache` | 배포 직후 새 자산을 가리키게 |
| 없는 자산 | 404 (`/assets/` location에 fallback 없음) | fallback으로 HTML을 주면 JS 자리에 HTML이 와서 원인을 찾기 어렵다 |

### 3-4. CDN·중간 캐시 — 사용자별 응답은 `private`

- 흔한 캐시 설정은 **URL을 키로 200 응답을 일정 시간 캐시**한다 — 로그인 사용자마다 내용이 다른 응답(파일 다운로드, `/api/me`)에 캐시 지시가 없으면 **다른 사람에게 그대로 준다.**
- 실측 2026-10-19 (nginx `proxy_cache_valid 200 10m` — 흔한 CDN 설정과 같은 동작): 같은 URL의 개인 파일을 홍길동이 받은 뒤 김철수가 요청 → **김철수가 홍길동의 파일을 받음**(X-Cache: HIT). 앱이 `Cache-Control: private, no-store`를 붙이면 둘 다 MISS, 각자 자기 파일.
- 규칙: **인증이 필요한 응답은 전부 `Cache-Control: private, no-store`** — Express는 인증 미들웨어 통과 후 공통으로 설정한다. CDN은 정적 자산(`/assets/*`)에만 붙이는 것이 가장 단순하다.

### 3-5. 이미지 리사이즈 — 업로드 때 만든다

- 실측 (sharp 0.33, 4000×3000 사진 7.5MB): 400px 썸네일 1건 **91ms**, 목록 한 화면(20건) 동시 생성 **510ms**. 요청 때 만들면 목록을 열 때마다 이 비용이 든다 — 업로드 시 재인코딩(upload-security.md 3-2절)과 같은 단계에서 썸네일까지 만들어 `files`에 함께 기록한다.
- 목록에 원본을 쓰면 한 화면에 수십~수백 MB를 내려보낸다(위 사진 20장 = 150MB).

## 4. 함정 (STRICT)

| 함정 | 증상 | 처방 |
|---|---|---|
| 배포 후 열린 탭의 옛 청크 | 다음 화면 이동에서 흰 화면 (실측) | 3-1절 새로고침 |
| `index.html` 캐시 | 새로고침해도 옛 자산을 가리켜 계속 실패 | `no-cache` (템플릿) |
| 압축 미설정 | 자산·JSON이 원본 크기로 전송 (베이스 이미지 기본 꺼짐 — 실측) | 프록시 gzip (템플릿) |
| 큰 목록을 201·POST 응답으로 | nginx가 압축하지 않음 (실측) | GET 200 |
| 사용자별 응답에 캐시 지시 없음 | 중간 캐시가 남의 파일을 준다 (실측) | `private, no-store` |
| 요청마다 썸네일 생성 | 목록 화면마다 수백 ms CPU (실측) | 업로드 시 생성 |
| client 순차 교체 | 새 HTML이 옛 컨테이너에 자산 요청 → 404 | zero-downtime-deploy.md 3-4절 |

## 5. 스택별 구현

| 구성 | Express | Spring |
|---|---|---|
| 개인 응답 캐시 금지 | 인증 미들웨어 뒤 `res.set('Cache-Control', 'private, no-store')` | Spring Security 기본 헤더(`Cache-Control: no-cache, no-store …`)를 끄지 않는다 (이 레시피에서 미검증) |
| 썸네일 | sharp `resize(400)` (upload-security.md 재인코딩 단계) | 업로드 처리에서 같은 원칙 (이 레시피에서 미검증) |
| 청크 실패 새로고침 | 프론트 공통 (3-1절) | 동일 |

## 6. 검증 포인트

- 배포 구성: `curl -H 'Accept-Encoding: gzip' -I`로 JS·JSON에 `Content-Encoding`이 붙는지, `/assets/*`에 `immutable`, `index.html`에 `no-cache`.
- 인증 API 응답 헤더에 `Cache-Control: private, no-store`.
- /live-test(관찰자 모드): 화면을 연 채로 client 재배포 → 지연 로딩 화면으로 이동해 흰 화면 없이 넘어가는지.
