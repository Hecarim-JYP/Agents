# 레시피: 에러 응답·에러 화면(404·500)과 서비스 밖 장애 공지 `[대외]`

> 확정: 2026-10-19 | 원칙: api.md 5절(에러 봉투), express.md 1절(라우터 → notFoundHandler → errorHandler), react.md 8절(404·403 화면) | 짝: maintenance-mode.md(앱이 없을 때 프록시 안내), error-alert.md(5xx 알림), seo.md(없는 경로 noindex)
> 클라이언트가 잘못 보낸 요청은 **4xx**, 우리 잘못만 **5xx**다. 화면은 어떤 예외에도 **흰 화면이 되지 않는다.** 서비스 전체가 죽었을 때의 안내는 **서비스 밖**에 있어야 한다.

## 1. 언제 쓰나

모든 웹앱의 에러 응답·화면(3-1·3-2절). 대외 서비스는 서비스 밖 장애 공지(3-3절)까지.

## 2. 결정 항목 (기본값)

| 결정 | 기본값 | 대안 / 비고 |
|---|---|---|
| 요청 형식 오류 | **본문 파싱 실패 400 `INVALID_JSON`, 용량 초과 413 `PAYLOAD_TOO_LARGE`** | 흔한 errorHandler는 500으로 응답한다 — 4절 |
| 없는 API | 404 봉투 `NOT_FOUND` (notFoundHandler) | |
| 없는 화면 경로 | **404 화면 + `noindex`** — HTTP 상태는 SPA fallback이라 200 | seo.md 3-2절 |
| 렌더링 예외 | **최상위 ErrorBoundary**(전체) + 큰 화면 단위 경계(그 화면만 대체) | |
| 앱이 없을 때 | 프록시 점검 안내 503 (maintenance-mode.md 3-1절, 템플릿) | |
| 서비스 밖 장애 공지 | **사내: 인프라팀 공지 채널·사내 메신저 / 대외: 서비스와 다른 인프라의 상태 페이지** | 같은 서버·도메인에 두면 함께 죽는다 |

## 3. 표준 설계

### 3-1. API — 클라이언트 오류를 4xx로

```js
/**
 * 중앙 에러 핸들러 — 요청 형식 오류(본문 파싱·용량 초과)를 먼저 4xx로 거르고, 나머지 모르는 예외만 500
 * @param {Error & { type?: string, code?: string }} err 에러 (body-parser는 type, multer는 code를 단다)
 * @param {import('express').Request} req 요청
 * @param {import('express').Response} res 응답
 * @param {import('express').NextFunction} next 다음 미들웨어
 */
export function errorHandler(err, req, res, next) {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ message: '요청 본문 형식이 올바르지 않습니다', error: 'INVALID_JSON' });
  if (err.type === 'entity.too.large' || err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ message: '요청이 너무 큽니다', error: 'PAYLOAD_TOO_LARGE' });
  // ... ZodError → 400, 타입 있는 업무 에러 → 각 상태 (express.md 3절, patterns.md 3절)
  logger.error({ err, requestId: req.id }, '처리되지 않은 오류');
  return res.status(500).json({ message: '서버 오류가 발생했습니다', error: 'INTERNAL_ERROR' });
}
```

실측 2026-10-19 (Express 4.22, `express.json({ limit })` + multer `limits.fileSize`):

| 요청 | 흔한 구현(알려진 에러 외 500) | 위 핸들러 |
|---|---|---|
| 깨진 JSON 본문 | **500** `INTERNAL_ERROR` | 400 `INVALID_JSON` |
| JSON 본문 상한 초과 | **500** | 413 `PAYLOAD_TOO_LARGE` |
| 파일 크기 상한 초과 | **500** | 413 |
| 없는 API | 404 (notFoundHandler) | 404 |

- 500으로 응답하면 error-alert.md의 5xx 알림이 **외부에서 깨진 요청만 보내도 울린다** — 알림이 소음이 되고 진짜 장애가 묻힌다.

### 3-2. 화면 — 흰 화면을 만들지 않는다

```jsx
/** 최상위 오류 경계 — 렌더링 중 잡히지 않은 예외(지연 로딩 청크 실패 포함)가 화면 전체를 비우지 않게 한다 */
export class AppErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('화면 오류', error, info.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return <ErrorScreen message="문제가 발생했습니다" action={{ label: '새로고침', onClick: () => window.location.reload() }} />;
  }
}
// main.jsx: <AppErrorBoundary><App /></AppErrorBoundary>
```

- 실측 2026-10-19 (React 18, 배포 후 옛 청크 404): 경계 없음 → **root 내용 0(흰 화면)** / 최상위 경계 → "문제가 발생했습니다 · 새로고침" 표시.
- 청크 실패는 static-assets.md 3-1절이 먼저 새로고침으로 처리하고, 그래도 실패하면 이 경계가 받는다.
- 에러 화면 문구는 design.md의 에러 상태 규칙(로딩·빈 상태·에러 3종)을 따른다 — 기술 메시지(스택·SQL)를 화면에 그대로 보이지 않는다.
- 404·403 화면은 react.md 8절(라우팅·인증 가드)이 정한다. 없는 경로의 `noindex`는 seo.md 3-2절.

### 3-3. 서비스 밖 장애 공지

- 서비스 전체가 내려가면 서비스 안의 공지 배너(maintenance-mode.md)도 함께 사라진다. 프록시 점검 안내(503)는 **앱만** 없을 때다 — 서버·네트워크·도메인 장애에는 아무것도 보이지 않는다.
- 대외 서비스는 **다른 인프라에 상태 페이지**를 둔다(호스팅형 상태 페이지 서비스 또는 다른 호스팅의 정적 페이지) — 같은 서버·같은 도메인 금지(`status.example.com`이 같은 서버를 가리키면 의미가 없다).
- 상태 페이지 내용: 현재 상태(정상·일부 장애·전체 장애·점검), 영향 범위(어떤 기능), **다음 갱신 예정 시각**, 원인과 조치(복구 후). 장애 기록은 templates/incident.md로 남긴다.
- 사내 시스템은 상태 페이지 대신 공지 채널(사내 메신저·메일)과 그 연락 경로를 CLAUDE.md에 기록한다(ops.md 7절 가동 모니터링과 함께).

## 4. 함정 (STRICT)

| 함정 | 증상 | 처방 |
|---|---|---|
| 본문 파싱·용량 초과를 500으로 | 클라이언트 실수가 서버 장애로 집계, 5xx 알림 소음 (실측) | 3-1절 4xx 매핑 |
| ErrorBoundary 없음 | 렌더링 예외 하나에 화면 전체가 빈다 (실측) | 최상위 경계 |
| 에러 화면에 기술 메시지 | 스택·SQL·내부 경로 노출 (ops.md 5절 8번) | 사용자 문구 + 서버 로그 |
| 상태 페이지를 같은 서버에 | 서비스와 함께 죽어 아무 안내도 없다 | 다른 인프라 |
| 없는 화면 경로를 그냥 200 | 검색엔진이 빈 페이지를 색인(soft 404) | 404 화면 + `noindex` (seo.md) |

## 5. 스택별 구현

| 구성 | Express | Spring |
|---|---|---|
| 형식 오류 매핑 | 3-1절 (`err.type`, `err.code`) — Express 5.3에서도 같은 값(실측 2026-10-19) | spring.md 4절 코드 — `MethodArgumentNotValidException` 400 · `HttpMessageNotReadableException` 400 · `MaxUploadSizeExceededException` 413 (실측 2026-10-19, Boot 4.1.1) |
| 없는 API | notFoundHandler | 없는 경로는 `NoResourceFoundException`(프레임워크의 `ErrorResponse` 구현)으로 온다 — spring.md 4절 코드가 그 상태코드(404)로 봉투 응답, 메서드 불일치 405도 같은 경로 (실측 2026-10-19, Boot 4.1.1) |
| 화면 오류 경계 | 프론트 공통 (3-2절) | 동일 |

## 6. 검증 포인트

- 자동화 테스트: 깨진 JSON → 400 `INVALID_JSON` / 상한 초과 JSON·파일 → 413 / 없는 API → 404 봉투 — 모두 응답 본문이 에러 봉투인지.
- 실동작 검증(/live-test 렌더링 축): 배포 후 열린 탭에서 화면 이동, 존재하지 않는 경로 진입 — 흰 화면 없이 안내 화면이 뜨는지.
- 대외: 상태 페이지 주소가 서비스와 다른 인프라인지(DNS·호스팅 확인), 에러 화면·점검 안내에서 그 주소로 안내하는지.
