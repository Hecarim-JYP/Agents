# 레시피: 검색 노출·공유 미리보기(SEO) — SPA가 수집기에 어떻게 보이는가 `[대외]` ⚑

> 확정: 2026-10-19 | 템플릿: `scaffolds/templates/nginx.conf`(기본 SPA) — 프리렌더 모드는 3-3절 설정으로 바꾼다 | 짝: error-pages.md(없는 경로), static-assets.md(캐시) | 시작 결정: scaffolds/default.md 체크리스트 29
> SPA의 첫 HTML은 **빈 껍데기**다 — JS를 실행하지 않는 수집기(메신저 미리보기, 일부 검색엔진)에는 **모든 경로가 같은 제목·빈 본문**으로 보인다. 공개 페이지가 있으면 **빌드할 때 그 경로의 HTML을 미리 만들어 둔다.**

## 1. 언제 쓰나

검색 결과에 나와야 하거나, 카카오톡·메신저에 링크를 붙였을 때 제목·이미지 미리보기가 떠야 하는 **공개 페이지**가 있는 대외 서비스. 로그인 뒤 업무 화면만 있는 시스템은 반대로 **색인을 막는다**(3-5절).

⚑ 되돌리기 어려운 이유: "공개 페이지가 많고 자주 바뀌어 서버 렌더링이 필요하다"면 프레임워크(Next.js 등)가 바뀐다 — 사내 표준 스택(Vite SPA) 밖이다. 시작할 때 정한다.

## 2. 결정 항목 (기본값)

| 결정 | 기본값 | 대안 / 비고 |
|---|---|---|
| 공개 페이지가 없음 (로그인 뒤 업무) | **색인 차단** — `robots.txt` `Disallow: /` | 사내 시스템이 인터넷에 열려 있으면 특히 |
| 공개 페이지가 적고 거의 안 바뀜 (소개·약관·공지·가격표) | **빌드 시 프리렌더**(3-3절) + nginx 프리렌더 모드 | |
| 공개 페이지가 많고 자주 바뀜 (상품·게시글) | **서버 렌더링 프레임워크** — 사내 표준 밖, 프로필 미적용 신호(profiles/project-default.md) | 공개 영역만 별도 사이트(CMS)로 분리 |
| 없는 경로 | **404 화면 + `<meta name="robots" content="noindex">`** | HTTP 상태는 SPA fallback이라 200 — 구글 권고 방식(soft 404 대응) |
| 공유 미리보기 | 공개 페이지마다 `og:title`·`og:description`·`og:image`(JPG/PNG) | 카카오톡은 초기 HTML의 og 태그를 읽는다 |

## 3. 표준 설계

### 3-1. 수집기가 받는 것 — 실측

실측 2026-10-19 (Vite 5 + React 18, 경로별 `document.title`·og 태그를 화면 코드가 넣는 일반적인 SPA, 스캐폴드 nginx.conf, curl = JS를 실행하지 않는 수집기):

| 경로 | SPA 그대로 | 프리렌더 + 프리렌더 모드(3-3절) |
|---|---|---|
| `/` | 200, 제목 `csp`(index.html 고정값), 본문 없음, og 없음 | 200, "우리 서비스 — 홈", 본문·og 있음 |
| `/about` | 200, **같은 제목·빈 본문** | 200, "회사 소개 — 우리 서비스", 본문 있음 |
| `/nope`(없는 경로) | **200, 같은 빈 껍데기** | 200 껍데기 → 브라우저에서 404 화면 + `noindex` |

- 구글은 200 응답 페이지를 헤드리스 Chromium으로 렌더링해 색인하지만, SPA는 없는 경로도 200이라 **soft 404** 문제가 생긴다 — 구글은 없는 경로에서 `noindex`를 넣거나 진짜 404 경로로 보내라고 권한다([Google Search Central — JavaScript SEO](https://developers.google.com/search/docs/guides/fix-search-javascript)).
- 카카오톡 미리보기는 og 태그가 있어야 만들어지고, 스크립트로 넣는 og 태그는 결과가 달라질 수 있으니 **curl로 받은 HTML에서 확인하라**고 안내한다(카카오 데브톡 스크랩 체크리스트). 네이버 검색 로봇의 JS 렌더링 범위는 공식 자료를 확인하지 못했다 — **렌더링하지 않는다고 가정**하고 프리렌더한다.

### 3-2. 경로별 머리 정보 + 없는 경로 `noindex`

```jsx
/**
 * 문서 머리 정보 — 경로별 제목·설명·og 태그, 없는 경로는 noindex
 * @param {{ title: string, desc: string } | null} page 현재 경로의 공개 페이지 정보 (없는 경로면 null)
 */
export function useHead(page) {
  useEffect(() => {
    document.title = page ? page.title : '페이지를 찾을 수 없습니다';
    const setMeta = (selector, attr, key, value) => {
      let el = document.head.querySelector(selector);
      if (!el) { el = document.createElement('meta'); el.setAttribute(attr, key); document.head.appendChild(el); }
      el.setAttribute('content', value);
    };
    if (page) { setMeta('meta[name="description"]', 'name', 'description', page.desc); setMeta('meta[property="og:title"]', 'property', 'og:title', page.title); }
    else setMeta('meta[name="robots"]', 'name', 'robots', 'noindex');
  }, [page]);
}
```

- 이 코드만으로는 JS를 실행하는 수집기(구글)에만 보인다 — 3-3절 프리렌더가 이 결과를 HTML로 굳힌다.

### 3-3. 빌드 시 프리렌더 + nginx 프리렌더 모드

```js
// scripts/prerender.mjs — vite build 뒤 실행. 공개 경로를 실제 브라우저로 렌더링해 dist/<경로>/index.html로 저장한다
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
const [base, outDir, ...routes] = process.argv.slice(2);     // 예: http://127.0.0.1:4173 dist / /about /pricing
copyFileSync(`${outDir}/index.html`, `${outDir}/200.html`);  // ① 프리렌더 전 SPA 껍데기를 따로 보관 — 없는 경로·업무 화면의 fallback
const browser = await chromium.launch();
for (const route of routes) {
  const page = await browser.newPage();
  await page.goto(base + route, { waitUntil: 'networkidle' });
  const html = '<!doctype html>' + await page.evaluate(() => document.documentElement.outerHTML);
  const dir = route === '/' ? outDir : `${outDir}${route}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/index.html`, html);                  // ② 경로별 HTML
  await page.close();
}
await browser.close();
```

nginx.conf(client)의 `location /`와 `location = /index.html`을 아래로 바꾼다:

```nginx
location / {
    try_files $uri $uri/index.html /200.html;    # 디렉터리 검사($uri/) 대신 파일을 직접 — 301 리다이렉트가 생기지 않는다
    add_header Cache-Control "no-cache";          # 프리렌더 HTML·껍데기 모두 배포 직후 새 자산을 가리키게
}
```

- 실측 (위 설정 그대로): `/`·`/about`·`/about/` 200 + 경로별 제목·본문, `/nope`·`/orders/1` 200 껍데기(브라우저에서 404 화면 + `noindex`), 없는 자산 404, HTML 전부 `no-cache`.
- 프리렌더 단계는 브라우저가 필요하다 — client 이미지 빌더(`node:22-slim`)에는 없으므로 Playwright 이미지를 빌더로 쓰거나 CI에서 프리렌더 후 `dist`를 이미지에 넣는다(이 레시피에서 미검증 — 채택 시 CI에서 확인).
- React 18의 `createRoot`는 프리렌더된 DOM을 지우고 다시 그린다 — 화면은 정상이다(실측: `#content` 1개, 콘솔 에러 0).

### 3-4. 함께 두는 파일

- `public/robots.txt` — 공개 영역만 허용, 업무 영역(`/app/` 등)·API는 `Disallow`. 공개 페이지가 없으면 `Disallow: /`.
- `public/sitemap.xml` — 프리렌더 경로 목록과 같게(같은 목록에서 생성).
- 공개 페이지마다 `<link rel="canonical">` — `/about`과 `/about/`이 모두 200이므로 하나로 정한다.
- og 이미지는 JPG·PNG, 바꿀 때는 **파일명을 바꾼다** — 카카오톡은 이미지 캐시를 지우지 않는다(카카오 데브톡 답변). 메타 정보는 카카오 공유 디버거에서 캐시를 초기화한다.

### 3-5. 색인을 막아야 하는 곳

- 업무 시스템·개발 서버가 인터넷에 열려 있으면 `robots.txt` `Disallow: /` — 개발 서버가 검색 결과에 나오면 운영과 혼동되고, 테스트 데이터가 노출된다.
- 응답 헤더로 막으려면 프록시에 `add_header X-Robots-Tag "noindex" always;`(nginx) — 개발 서버 프록시 설정에만 둔다.

## 4. 함정 (STRICT)

| 함정 | 증상 | 처방 |
|---|---|---|
| SPA 그대로 공개 페이지 운영 | JS를 안 쓰는 수집기에 모든 경로가 같은 제목·빈 본문 (실측) | 프리렌더 |
| og 태그를 스크립트로만 | 카카오톡 미리보기에 제목·이미지 없음 | 프리렌더된 HTML에 og |
| 프리렌더를 `about/index.html`로 저장 + 기본 nginx.conf | `/about` → **301 `/about/`**, Location에 **내부 포트**(`:8080`)가 실려 프록시 뒤에서 깨지고, 앱은 `/about/`를 모르는 경로로 처리 (실측) | 프리렌더 모드 `try_files $uri/index.html` |
| 루트(`/`) 프리렌더가 껍데기를 덮어씀 | 없는 경로·업무 화면도 **홈 내용**으로 응답 (실측) | 껍데기를 `200.html`로 먼저 보관 |
| 없는 경로를 그냥 200 | soft 404 — 빈 페이지가 색인된다 | `noindex` (3-2절) |
| 개발 서버 색인 | 검색 결과에 테스트 화면·데이터 | `Disallow: /`, `X-Robots-Tag` |
| og 이미지 같은 파일명으로 교체 | 공유 미리보기에 옛 이미지가 계속 | 파일명 변경 |

## 5. 스택별 구현

| 구성 | React(Vite) | 비고 |
|---|---|---|
| 머리 정보 | 3-2절 `useHead` (React 18 실측) | React 19는 컴포넌트 안 `<title>`·`<meta>`를 head로 올려 준다 (이 레시피에서 미검증) |
| 프리렌더 | 3-3절 스크립트 (Playwright, 실측) | 서버 렌더링이 필요하면 프레임워크 결정(⚑) |
| 서빙 | nginx 프리렌더 모드 (실측) | Spring 백엔드와 무관 — 정적 서빙은 client 컨테이너 |

## 6. 검증 포인트

- 배포 구성에서 공개 경로마다 `curl`로 제목·본문·og 태그가 있는지, `/about`이 301 없이 200인지, 없는 경로에 브라우저로 들어가 `noindex`가 붙는지.
- 구글 Search Console·네이버 서치어드바이저에 sitemap 등록 후 수집 상태 확인, 카카오 공유 디버거로 미리보기 확인.
- 업무 시스템·개발 서버: `/robots.txt`가 `Disallow: /`인지.
