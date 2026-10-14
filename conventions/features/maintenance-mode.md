# 레시피: 점검 모드·공지 배너·기능 스위치 `[공통]`

> 확정: 2026-10-14 | 테이블: `schemas/13_app_setting.sql` | 템플릿: `scaffolds/templates/nginx-proxy.conf`(앱이 꺼진 동안의 안내) | 짝: cache.md
> 점검 안내는 **세 층**이다 — 앱이 꺼져 있는 동안은 **프록시**가, 앱은 켜두고 업무만 막을 때는 **앱의 점검 모드**가, 특정 기능만 막을 때는 **기능 스위치**가 한다. 모두 재배포 없이 바꾼다.

## 1. 언제 쓰나

| 상황 | 층 | 수단 |
|---|---|---|
| 배포·재시작으로 앱이 잠깐 없다 | **프록시** | nginx가 앱 연결 실패를 받으면 `/api`는 JSON 503, 화면은 안내 HTML 503 (3-1절) |
| DB 작업·데이터 이관 중 — 앱은 켜져 있지만 사용자 업무를 막아야 한다 | **앱 점검 모드** | `app_setting.maintenance` → 미들웨어가 503 `MAINTENANCE` (관리자는 통과) |
| 외부 연동 장애로 특정 기능만 막는다 / 새 기능을 켜고 끈다 | **기능 스위치** | `app_setting.feature.*` → 해당 API 503 `FEATURE_DISABLED` + 화면 버튼 비활성 |
| 점검 예고·공지 | **공지 배너** | `app_setting.banner` → 화면 상단 |

## 2. 결정 항목 (기본값)

| 결정 | 기본값 | 근거 |
|---|---|---|
| 설정 저장 위치 | **DB `app_setting`** + 30초 캐시 (cache.md) | 환경변수는 바꾸려면 재시작이 필요하다 — 배포 시점에 정해지는 값(연동 주소·시크릿)만 환경변수 |
| 설정이 없거나 깨졌을 때 | **코드에 둔 안전 기본값** — 점검 꺼짐, 기존 기능 켜짐 | 설정 행 하나가 빠졌다고 서비스 전체가 막히면 안 된다 |
| 변경 권한 | 관리자 권한 코드 + audit_log 기록 (auth.md 5절) | 점검 모드는 전체 사용자를 막는 스위치다 |
| 점검 중 통과 | `/health`, 관리자 로그인·관리 API, 설정 조회 | 관리자가 점검을 풀 수 있어야 한다 |

## 3. 표준 설계

### 3-1. 프록시 — 앱이 없을 때의 안내 (스캐폴드 템플릿에 포함)

```nginx
location /api/ {
    proxy_pass http://server:3000;
    error_page 502 504 = @api_unavailable;     # 앱 연결 실패·응답 없음일 때만 — 앱이 보낸 503은 그대로 통과
}
location / {
    proxy_pass http://client:8080;
    error_page 502 504 = @page_unavailable;
}
location @api_unavailable {                     # 공용 API 클라이언트가 읽을 수 있는 봉투 (api.md 5절)
    default_type application/json;
    add_header Retry-After 30 always;
    return 503 '{"message":"서비스 점검 중입니다. 잠시 후 다시 시도해 주세요.","error":"SERVICE_UNAVAILABLE"}';
}
location @page_unavailable {
    default_type text/html;
    add_header Cache-Control "no-store" always;  # 안내 페이지가 캐시돼 복구 후에도 보이는 것 방지
    return 503 '<!doctype html><meta charset="utf-8"><title>점검 중</title><p>서비스 점검 중입니다. 잠시 후 새로고침해 주세요.</p>';
}
```

- `proxy_intercept_errors`는 켜지 않는다 — 켜면 **앱이 직접 보낸 에러 봉투**(400·409·503 `MAINTENANCE`)까지 프록시가 가로챈다. 위 설정은 프록시가 앱에 닿지 못한 경우(502·504)만 바꾼다.
- `/health`에는 걸지 않는다 — 가동 감시는 진짜 502를 봐야 한다 (ops.md 7절).
- 실측(2026-10-14, nginx 1.24): 앱 정지 → `/api` JSON 503·화면 HTML 503 / 앱이 보낸 503 JSON → 그대로 전달.

### 3-2. 앱 점검 모드 — 미들웨어

```js
/**
 * 점검 모드 — 켜져 있으면 일반 사용자 요청을 503 MAINTENANCE로 막는다 (관리자·헬스·설정 조회는 통과)
 * @param {import('express').Request} req 요청 (인증 미들웨어 뒤 — req.user 신뢰값)
 * @param {import('express').Response} res 응답
 * @param {import('express').NextFunction} next 다음 미들웨어
 */
export async function maintenanceGate(req, res, next) {
  const m = await getSetting('maintenance', { enabled: false });              // 캐시 30초, 없거나 깨지면 기본값
  // app.use('/api', maintenanceGate) 기준 경로 — /health는 /api 밖이라 애초에 걸리지 않는다
  const bypass = req.path === '/app-status' || req.path === '/auth/admin-login' || req.user?.permissions?.has('system.admin');
  if (!m.enabled || bypass) return next();
  res.set('Retry-After', '300');
  return res.status(503).json({ message: m.message ?? '시스템 점검 중입니다.', error: 'MAINTENANCE' });
}
```

- 로그인 전 화면에서도 점검 안내를 보여야 하므로, 관리자 로그인만 통과시키고 일반 로그인은 막는다.

### 3-3. 기능 스위치

- 키 이름: `feature.{기능}` (예: `feature.excel_upload`, `feature.erp_sync`). 값: `{ "enabled": false, "message": "ERP 점검으로 일시 중단" }`.
- **서버가 막는다** — 해당 API 시작 부분에서 꺼져 있으면 503 `FEATURE_DISABLED`. 화면 버튼 비활성은 UX일 뿐이다 (auth.md 4-1절과 같은 원리).
- 두 종류를 구분한다: **운영 스위치**(장애 시 끄는 kill switch — 계속 유지)와 **출시 스위치**(새 기능을 켜기 위한 것 — 출시가 끝나면 코드와 설정에서 **제거**). 출시 스위치를 남겨두면 분기가 쌓여 아무도 지우지 못한다.

### 3-4. 화면 — 상태 조회 하나로

- `GET /api/app-status`(인증 불필요 — auth.md 4-1절 공개 경로 화이트리스트): `{ maintenance, banner, features: { excel_upload: true, … } }`. 앱 시작·화면 이동 시 조회한다.
- 공용 API 클라이언트(react.md 7절) 응답 인터셉터: 503 + `MAINTENANCE` 또는 `SERVICE_UNAVAILABLE`이면 **점검 화면으로 전환**하고 `Retry-After` 간격으로 상태를 다시 조회해 풀리면 복귀한다.

## 4. 함정 (STRICT)

| 함정 | 증상 | 처방 |
|---|---|---|
| 점검 안내를 앱만 담당 | 배포 중(앱이 꺼진 몇 초~몇 분) 사용자는 nginx 기본 502 HTML을 본다 — API 호출은 JSON이 아니라 화면에 아무 메시지도 안 나온다 | 프록시 층 (3-1절) |
| `proxy_intercept_errors on` | 앱의 검증 에러·충돌 메시지까지 점검 안내로 바뀐다 | 끄고 502·504만 `error_page` (실측: 앱 503 JSON 그대로 통과) |
| `/health`까지 안내로 덮음 | 앱이 죽어도 감시는 503 안내만 받아 장애 원인을 모른다 | `/health` 제외 |
| 안내 페이지 캐시 | 복구 후에도 브라우저가 점검 페이지를 보여준다 | `Cache-Control: no-store` |
| 설정 누락 시 차단 | `app_setting` 행 하나 빠졌다고 전체 점검 상태 | 코드 기본값 |
| 화면에서만 기능 숨김 | API를 직접 부르면 막힌 기능이 동작한다 | 서버 검사 |
| 관리자도 막힘 | 점검 모드를 풀 사람이 없다 | 관리자·설정 경로 통과 |
| 출시 스위치 방치 | 죽은 분기가 쌓인다 | 출시 후 제거 |

## 5. 스택별 구현

| 구성 | Express | Spring |
|---|---|---|
| 설정 조회 | `getSetting(key, 기본값)` — cache.md 3-1절 캐시 + JSON 파싱 실패 시 기본값 | `AppSettingService` + Caffeine |
| 점검 게이트 | 인증 미들웨어 뒤에 3-2절 미들웨어 | `OncePerRequestFilter` 또는 `HandlerInterceptor` |
| 기능 스위치 | 해당 라우트 앞 `requireFeature('excel_upload')` | 인터셉터 + 커스텀 어노테이션 |
| 프록시 | 스캐폴드 nginx 템플릿 (3-1절). Caddy 채택 시 `handle_errors`로 같은 구성이 필요하다(이 레시피에서 미검증) | 동일 |

## 6. 검증 포인트

- 자동화 테스트: 점검 켜짐 → 일반 사용자 503·관리자 200·`/health` 200 / 설정 행 삭제 → 기본값으로 동작 / 기능 꺼짐 → 해당 API 503 `FEATURE_DISABLED`.
- 실동작 검증(/live-test): `docker compose stop server` 상태에서 화면 새로고침(안내 HTML)·저장 시도(점검 메시지) → `start` 후 자동 복귀. 관리 화면에서 점검 모드를 켜고 다른 브라우저(일반 사용자)가 막히는지.
