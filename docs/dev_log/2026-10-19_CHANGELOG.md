# 변경 이력 — 2026-10-19

> 작업 베이스 커밋 a025c91(10-16 변경 이력 갱신) 이후 5커밋.
> 사용자 요청 "3-2차 진행해" — 운영 기능 카탈로그 `[대외]`의 남은 11개 항목을 레시피 10개로 묶어 진행했다. 이번에는 **Docker가 동작해(mirror.gcr.io 이미지) 스캐폴드 compose 템플릿 그대로 스택을 띄워** 배포·프록시 동작을 실측할 수 있었다.
> 핵심 주제: **① 스캐폴드 배포 흐름의 결함 정정 — 재배포 후 서비스 전체가 점검 안내 503에 고정 ② 레시피 10개 + 스키마 4개 ③ 3-1차 "MySQL 8.0 미검증" 해소**

---

## 1. 스캐폴드 배포 결함 — 재배포 후 서비스 전체 503 고정 (fix)

기존: nginx 프록시 템플릿이 `proxy_pass http://server:3000;`처럼 컨테이너 이름을 고정으로 써서, nginx가 **기동할 때 한 번만** IP를 해석했다.
변경: Docker 내장 DNS로 요청 시점에 다시 해석(`resolver 127.0.0.11 valid=1s` + 변수 `proxy_pass`) + `proxy_connect_timeout 2s`.

| 실측 (Docker 29.8 · compose 5.6 · nginx-unprivileged 1.27, 스캐폴드 compose 템플릿 그대로) | 결과 |
|---|---|
| client·server를 같은 태그로 함께 재배포 (일반적인 배포) | **두 컨테이너가 IP를 맞바꿈** → `/api`·화면 모두 503 고정, 재배포를 반복해도 풀리지 않음. proxy 재시작으로만 복구 |
| server 재배포 중 다른 컨테이너가 옛 IP를 차지 | 고정 해석 20초 내내 503 / 재해석 0.3초 후 200 |
| 순차 교체 중 DNS 캐시 5초 + 연결 타임아웃 기본 60초 | 최대 응답 **60,057ms**, 503 531건 |
| 최종 템플릿(1초 + 2초)으로 부하 중 순차 교체 3회 | **실패 0건**, 최대 2초대 |
| Caddy 템플릿 | 기본 동작이 재해석 — 0.3초 복구 |

**변경 파일**: `scaffolds/templates/nginx-proxy.conf`, `Caddyfile`(주석), `conventions/docker.md` 7절(STRICT — 고정 이름으로 바꾸지 않는다)

## 2. 프록시 압축 (feat)

- 베이스 이미지 `nginx-unprivileged:1.27`의 nginx.conf는 `#gzip on;`(꺼짐)이고 템플릿도 켜지 않아 **JS·JSON이 원본 크기로 나갔다**(실측).
- 프록시에서 gzip(nginx)·zstd/gzip(Caddy `encode`)을 켰다 — 실측 JS 143,738 → 54,312바이트, 목록 JSON 10,100 → 589바이트. nginx gzip은 200·403·404 응답만 압축한다(201은 안 됨 — 실측).

**변경 파일**: `scaffolds/templates/nginx-proxy.conf`, `Caddyfile`

## 3. 레시피 10개 + 스키마 4개 (feat)

| 레시피 | 스키마 | 실측으로 확정한 함정 |
|---|---|---|
| `zero-downtime-deploy.md` 무중단 배포 | — | 1절 + **`.env` 태그를 나중에 바꾸면 다른 compose 명령이 server를 옛 태그로 되돌림** / client 두 버전 공존 중 화면 열기 60회 중 **33회 JS 404**(순차 교체 금지) / SIGKILL로 빼면 처리 중 POST 3건 실패 / HEALTHCHECK `interval=30s`면 healthy까지 31초(`--start-interval`로 3초) |
| `multi-instance.md` 다중 인스턴스 ⚑ | — | 2개로 늘리면: 빈도 제한 3회 → **6회**, 설정 변경 후 한쪽만 옛 값, 업로드 절반 404, 하루 1회 작업 2회 실행 → Redis 저장소·pub/sub 무효화로 해소(실측). 같은 호스트 복제본은 named volume 공유, MariaDB 11.4 `max_connections` 151 |
| `static-assets.md` 정적 자산 | — | 배포 후 열린 탭의 옛 청크 404 → **흰 화면**, `vite:preloadError` 새로고침으로 해소 / 캐시 프록시가 Cache-Control 없는 개인 파일을 **다른 사용자에게 줌**(`private, no-store`로 해소) / 썸네일 요청 시 생성 91ms·목록 20건 510ms |
| `load-test.md` 부하 테스트 | — | 풀 크기 10 → 481 req/s·p50 205ms, 50 → 2,158 req/s (**오류 0 — 지연으로만 드러남**) / **bcryptjs는 로그인 몰림 동안 다른 API 처리량 0**, 네이티브 bcrypt는 영향 없음, 스레드풀 증설은 효과 미미 |
| `error-pages.md` 에러 응답·화면·상태 페이지 | — | 흔한 errorHandler는 깨진 JSON·용량 초과를 **전부 500**(5xx 알림 소음) / 최상위 ErrorBoundary 없으면 흰 화면 |
| `seo.md` 검색 노출 ⚑ | — | SPA는 수집기에 모든 경로가 같은 제목·빈 본문·200 / 프리렌더를 디렉터리로 저장하면 **301 + Location에 내부 포트** / 루트 프리렌더가 SPA 껍데기를 덮어씀 → 프리렌더 모드 nginx 설정(실측) |
| `social-login.md` 소셜 로그인 ⚑ | `18_user_identity.sql` | 이메일이 같으면 자동 연결 → **미인증 사전 가입 계정을 통한 탈취**(시뮬레이션), 양쪽 인증 확인 + 미인증 계정 무효화로 차단 |
| `account-withdrawal.md` 탈퇴·파기·분리 보관 ⚑ | `20_retained_personal_data.sql` | `is_active = 0`만이면 개인정보 잔존 + **같은 이메일 재가입 ER_DUP_ENTRY** / 별도 스키마 이동은 같은 트랜잭션에 묶임(롤백 실측) |
| `consent.md` 동의 이력 ⚑ | `19_terms_consent.sql` | 추가 전용 트리거가 UPDATE 거부 / **MySQL 8에서 앱 계정으로 트리거 생성 → ERROR 1419**(테이블만 생기고 중단) — 관리자 계정으로 실행하면 정상 / 재동의 판정 SQL 양쪽 DB 동일 결과 |
| `inquiry.md` 문의·신고 | `21_inquiry.sql` | 같은 신고자 동시 5회 → UNIQUE로 1건 |

**법령·제공사 사양 확인 범위** (법제처·카카오·네이버 사이트는 이 환경에서 접속 불가 — 검색 결과로 교차 확인):
- 확인: 개인정보 유효기간제(휴면 분리 의무) **2023-09-15 시행 개정으로 폐지**, 2023 개정 제15조('불가피하게' 삭제)·제22조(구분 동의, 선택 미동의로 서비스 거부 금지), 구글 OIDC discovery 원문(`email_verified`, PKCE S256), 카카오 회원번호 앱 종속·탈퇴 시 연결 끊기 안내(데브톡).
- **원문 미확인**: 전자상거래법 시행령 제6조 보존기간 중 3년(소비자 불만·분쟁처리), 파기 "5일 이내"(교육부 지침 기반 2차 자료), 네이버 OIDC·이메일 인증 필드 — 각 레시피 1-1절에 표시하고 **법무 확인 후 CLAUDE.md 기록을 MANDATORY**로 했다.

## 4. 기존 문서 연결 (docs)

- 시작 결정 체크리스트 **29(검색 노출)·30(대외 자체 가입 계정 정책)** 신설, 22번 근거에 multi-instance 링크, 기초 테이블 18~21
- `auth.md` 6절: **순수 JS `bcryptjs` 금지**(이벤트 루프 차단 실측), 소셜 로그인 행 / `express.md` 3절: 본문 파싱 400·용량 초과 413 / `react.md` 8절: 최상위 ErrorBoundary + 청크 실패 새로고침 / `ops.md` 2절: `DEPLOY_TAG`부터 갱신, 7절: 장애 공지 경로 / `patterns.md` 0-3절·`migration.md` 4절·`cache.md`·`rate-limit.md`·`error-alert.md`·`account-lifecycle.md`·`personal-data.md` 링크
- catalog `[대외]` 전 항목 📄(3-1·3-2차 완료 — 남은 것은 4차), `dev-rules` 카탈로그 기능 목록, 프로필 29·30, OVERVIEW 1.8, README

## 5. 발견했지만 고치지 않음 (확인 필요)

| 항목 | 내용 |
|---|---|
| nginx 템플릿의 `listen [::]:8080;` | IPv6를 커널에서 끈 호스트(`ipv6.disable=1`)에서는 **nginx가 기동하지 못한다**(이 환경에서 실측: `socket() [::]:8080 failed (97)`). 기본 compose 네트워크는 IPv4라 이 줄의 이득은 작다 — 제거 또는 유지 결정 필요 |
| JWT 서명 시크릿 변수 | 10-16에 보고한 그대로 — compose 템플릿·`.env.example`에 연결 지점이 없다 |

---

## 검증

| 항목 | 결과 |
|---|---|
| `node scripts/check-refs.mjs` | 통과 — 문서 56개 / 참조 501건 (skills·agents 포함 확장: 65개 / 522건) |
| `scripts/verify-templates.sh` | 통과 — 두 모드 compose 병합·치환 정상 |
| 프록시 템플릿 실기동 (Docker, 스캐폴드 compose 그대로) | nginx: 기본 헤더·XFF 덮어쓰기·압축·앱 정지 시 503 안내(`/health` 502)·IP 변경 0.3초 복구·순차 교체 3회 실패 0 / Spring 헬스 변형(변수 + URI) 정상 / `nginx -t` 통과 / Caddy: `caddy validate`·`fmt` 통과, gzip·zstd, IP 변경 0.3초 복구 |
| 스키마 22종 | MariaDB 10.11 전부 적용 / MySQL 8.0.46 전부 적용(19번 트리거만 ERROR 1419 — 관리자 계정 실행 시 정상, 앱 계정 UPDATE 차단 확인) |
| 3-1차 레시피 SQL의 MySQL 8.0 검증 | **해소** — account-lifecycle·mfa 레시피 SQL이 MySQL 8.0.46에서 MariaDB와 같은 결과 |
| `install.sh` 임시 HOME 설치 | 레시피 34개·스키마 22개 설치 확인 |
| 환경 제약으로 바꿔서 잰 것 | 이 커널에 IPv6가 없어 실측용 복사본에서만 `listen [::]:8080;` 제외(5절), 빌드 컨테이너는 npm 접근 불가라 호스트에서 설치한 `node_modules` 사용 — 둘 다 측정 대상(프록시·종료·배포 동작)과 무관 |
| 실측 안 한 것 | CAPTCHA·카카오·네이버 실제 연동, ClamAV, Spring 쪽 구현(Bucket4j·Redis·예외 매핑), 여러 호스트 구성, Playwright 이미지로의 프리렌더 CI — 각 레시피에 "미검증" 표기 |
| `install.ps1` 재실행 | **미수행** — 회사 PC에서 `git pull` 후 실행 필요 |

---

## 커밋 코멘트

```
@@ 2026-10-19 @@
운영 기능 카탈로그 3-2차 — [대외] 레시피 10개 + 재배포 후 서비스 전체 503 고정 결함 정정

■ 결함 정정 (스캐폴드 compose 그대로 실기동해 재현)
- nginx 프록시가 컨테이너 이름을 기동 때만 해석 → 재배포로 IP가 바뀌면(client·server 맞바꿈) 전체 503 고정
  → resolver 127.0.0.11 valid=1s + 변수 proxy_pass + proxy_connect_timeout 2s (순차 교체 3회 실패 0)
- 압축 꺼짐(베이스 이미지 기본) → 프록시 gzip / Caddy encode

■ 레시피 (conventions/features/)
- zero-downtime-deploy, multi-instance, static-assets, load-test, error-pages, seo
- social-login, account-withdrawal, consent, inquiry
- schemas: 18_user_identity, 19_terms_consent, 20_retained_personal_data, 21_inquiry

■ 연결
- 체크리스트 29(검색 노출)·30(대외 계정 정책), auth.md bcryptjs 금지, express.md 400/413, react.md ErrorBoundary
- 3-1차 레시피 SQL MySQL 8.0 검증 완료
```
