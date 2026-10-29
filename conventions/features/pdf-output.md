# 레시피: PDF·인쇄 출력 — 거래명세서·시험성적서·증명서 `[사내]`

> 확정: 2026-10-20 | 원칙: design.md 7절(글꼴 — 번들), docker.md(이미지) | 짝: long-running-job.md(일괄 생성), seo.md 3-3절(Playwright 이미지), upload-security.md 3-3절(파일 내려주기 헤더), money-calc.md(출력 금액)
> 출력물은 **HTML 템플릿 하나**로 만들고, 화면 인쇄와 서버 PDF가 같은 템플릿을 쓴다. 한글 글꼴은 **`@font-face`로 직접 지정해 PDF에 박아 넣는다** — 서버 이미지에는 한글 글꼴이 없거나(→ □□□) 중국어 글꼴로 대신 그려진다. PDF 라이브러리로 직접 그릴 때도 기본 글꼴은 한글을 못 쓴다 — TTF를 **서브셋으로** 임베드한다.

## 1. 언제 쓰나

거래명세서·견적서·발주서·시험성적서(COA)·재직/경력증명서처럼 **양식이 정해진 문서**를 인쇄하거나 PDF로 내려주거나 메일에 첨부할 때. 목록을 내려받는 것은 excel-download.md.

## 2. 결정 항목 (기본값)

| 결정 | 기본값 | 대안 / 비고 |
|---|---|---|
| 만드는 곳 | **화면 인쇄** — 출력용 화면(HTML) + 인쇄 CSS, 사용자가 브라우저 인쇄·"PDF로 저장" | 서버 PDF가 필요할 때만(메일 첨부·보관·일괄 생성) — 같은 HTML을 서버의 headless Chromium으로 |
| 서버 PDF 도구 | **Playwright `page.pdf()`** — 화면과 같은 HTML·CSS | 칸 위치가 고정된 단순 양식만 PDF 라이브러리(pdf-lib·PDFBox)로 직접 그리기 |
| 서버 PDF 실행 위치 | **별도 작업자 컨테이너**(Playwright 공식 이미지) + 비동기(long-running-job.md) | API 서버 이미지에 브라우저를 넣지 않는다 — 이미지 크기·메모리 |
| 글꼴 | **Pretendard**(OFL — design.md 7절과 같은 글꼴)를 앱에 번들, 출력 HTML에서 `@font-face`로 지정 | 사용자 PC 글꼴(맑은 고딕 등)에 의존하지 않는다 — PC마다 결과가 다르다 |
| 용지 | `@page { size: A4; margin: 15mm; }` | 양식이 정해진 경우 그 규격 |
| 금액·날짜 | 서버가 계산·포맷을 끝낸 값만 템플릿에 (money-calc.md) | |
| 보관 | 발행한 PDF는 `files`(express.md 6절) + **발행 당시 데이터 스냅숏** — 나중에 다시 만들면 값이 바뀔 수 있다 | |

## 3. 표준 설계

### 3-1. 출력 HTML·인쇄 CSS

```html
<!-- 출력 전용 화면 — 화면 인쇄와 서버 PDF가 같은 템플릿 -->
<style>
  @font-face {                                   /* 시스템 글꼴에 맡기지 않는다 — PDF에 이 글꼴이 들어간다 */
    font-family: 'Pretendard';
    src: url('/fonts/Pretendard-Regular.woff2') format('woff2');
  }
  body { font-family: 'Pretendard', sans-serif; }
  @page { size: A4; margin: 15mm; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }         /* 쪽이 넘어가도 머리글 반복 (Chromium 기본값과 같다 — 명시) */
  tr { break-inside: avoid; }                    /* 행이 쪽 경계에서 잘리지 않게 */
  @media print { .no-print { display: none; } }   /* 버튼·메뉴는 인쇄할 때만 숨긴다 */
</style>
```

- 서버 PDF로 만들 때는 글꼴 로딩이 끝난 뒤 찍는다: `await page.evaluate(() => document.fonts.ready)` → `page.pdf({ format: 'A4', printBackground: true })`.
- 글꼴 파일이 외부 URL이면 작업자 컨테이너가 그 주소에 닿아야 한다 — 같은 출처로 서빙하거나 data URI로 넣는다(실측은 data URI).

### 3-2. 실측 — headless Chromium (2026-10-20, Playwright 1.64.1 공식 이미지, 표 80행 거래명세서)

| 조건 | 결과 |
|---|---|
| 이미지에 든 한글 지원 글꼴 | **WenQuanYi Zen Hei(중국어 글꼴)·Unifont뿐**, 한국어 글꼴 없음 / `node:26-slim`은 `fc-list` 자체가 없음 / `eclipse-temurin:25-jre`는 `/usr/share/fonts/truetype`만 |
| 글꼴 지정 없이(`sans-serif`) PDF | 한글이 **WenQuanYiZenHei**로 그려진다 (PDF 글꼴: WenQuanYiZenHei + LiberationSans) |
| 이미지에서 CJK 글꼴을 지운 경우 | 한글이 **□□□□□** (스크린샷 확인) |
| `@font-face` Pretendard | PDF 글꼴 **Pretendard-Regular 서브셋**, 시스템 글꼴과 무관 — 40,205바이트(지정 없음 48,011) |
| A4·80행 | 3쪽, **3쪽 모두 머리글 반복**, 텍스트 추출 정상(`거래명세서`) |

### 3-3. PDF 라이브러리로 직접 그릴 때 (단순 고정 양식)

```js
import { PDFDocument } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

const doc = await PDFDocument.create();
doc.registerFontkit(fontkit);
const font = await doc.embedFont(pretendardTtfBytes, { subset: true });   // 쓴 글자만 — subset 없으면 글꼴 통째로
doc.addPage().drawText('거래명세서', { font, size: 14, x: 50, y: 780 });
```

- 실측 2026-10-20:

| 도구 | 기본 글꼴로 한글 | TTF 임베드 |
|---|---|---|
| pdf-lib 1.17.1 + @pdf-lib/fontkit 1.1.1 | **에러** `WinAnsi cannot encode "거"` | `subset: true` **3,160바이트**, 텍스트 추출 정상 / `subset: false` **1,240,664바이트**, `—`가 `㏆`로 추출 |
| PDFBox 3.0.8 (Java 25) | **`IllegalArgumentException`** U+AC70 not available in Helvetica(WinAnsiEncoding) | `PDType0Font.load(doc, ttf)` — 서브셋 4,567바이트(글꼴 원본 2,725,828), `똠`·`뷁` 포함 추출 정상 |

- PDFBox·pdf-lib는 **TTF**를 넣는다 — Pretendard 패키지의 `dist/public/static/alternative/*.ttf` (OTF는 이 실측 대상 아님).

## 4. 함정 (STRICT)

| 함정 | 증상 | 처방 |
|---|---|---|
| 서버 PDF에서 글꼴을 지정하지 않음 | 개발 PC(한글 글꼴 있음)에서는 정상, **컨테이너에서는 □ 또는 중국어 글꼴** (실측) — 이미지에 글꼴 패키지를 깔아 맞추면 이미지가 바뀔 때 결과도 바뀐다 | 앱이 글꼴 파일을 가지고 `@font-face`로 지정 (3-1절) |
| PDF 라이브러리 기본 글꼴로 한글 | 생성 단계에서 **에러** (실측: pdf-lib·PDFBox 모두) | TTF 서브셋 임베드 (3-3절) |
| 글꼴 전체 임베드 | 문서 하나가 1MB+ — 메일 첨부·보관 용량 (실측 1.24MB vs 3KB) | 서브셋 |
| 긴 표를 그대로 인쇄 | 행이 쪽 경계에서 잘린다 | `tr { break-inside: avoid }` + 머리글 반복 (3-1절) |
| API 서버에서 동기로 PDF 생성 | 브라우저 기동·렌더링 동안 요청이 묶인다 | 작업자 + 비동기 (long-running-job.md) |
| 재발행 때 현재 데이터로 다시 생성 | 발행 후 바뀐 단가·주소가 들어간 "다른 문서" | 발행 시 PDF·데이터 스냅숏 보관 (2절) |
| 금액을 템플릿에서 계산 | 화면·PDF·DB 금액이 서로 다르다 | 서버 계산 결과만 (money-calc.md) |

## 5. 스택별 구현

| 구성 | React + Express | Spring |
|---|---|---|
| 화면 인쇄 | 출력 전용 라우트 + 인쇄 CSS (3-1절) + `window.print()` | 프론트 동일 |
| 서버 PDF | 작업자: Playwright 이미지(`mcr.microsoft.com/playwright:v1.64.1-noble` — Node 24, seo.md 3-3절과 같은 태그 규칙) + `page.pdf` | 같은 작업자를 HTTP로 호출하거나, 단순 양식은 PDFBox `PDType0Font.load` (3-3절 실측) |
| 직접 그리기 | pdf-lib + fontkit `subset: true` | PDFBox 3.x |
| 내려주기 | `Content-Type: application/pdf` + `Content-Disposition: attachment` (upload-security.md 3-3절) | 동일 |

## 6. 검증 포인트

- 자동화 테스트: 생성한 PDF의 글꼴 목록에 지정한 글꼴만 있다(대체 글꼴 없음) / 텍스트 추출에 한글이 그대로 나온다 / 80행 이상 표가 쪽마다 머리글을 가진다.
- 수동: 운영과 같은 이미지에서 만든 PDF를 열어 □·다른 모양 글꼴이 없는지, 사용자 PC(Windows) 인쇄 미리보기와 서버 PDF가 같은지.
- 글꼴 라이선스 파일(OFL)을 앱과 함께 배포한다.
