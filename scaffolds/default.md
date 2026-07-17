# 새 프로젝트 스캐폴드

사용자가 "새 프로젝트 시작/세팅"을 요청하면 이 문서의 절차대로 생성한다.

## 생성 절차

1. **확인**: **`~/.claude/jyp/profiles/project-default.md`(사내 표준 프로필)를 먼저 읽는다.** 프로필이 체크리스트의 기본 답안이므로, 23개를 순서대로 다 묻지 않는다:
   1. **프로필의 [확인] 항목만 묻는다 (4개)**: 프로젝트명·목적 / 인증 소스 / 사내 API 연동 / 특수 요구(멀티테넌트·다국어·배치).
   2. **[고정] 항목은 확정값을 표로 보여주고 이견만 받는다** — 묻지 않되 숨기지도 않는다.
   3. 프로필 미적용 신호(대외 서비스·비표준 스택·규제 요건)에 해당하면 **프로필을 버리고 체크리스트 전체**를 확인한다.
   4. 확정값은 전부 CLAUDE.md "프로젝트 참고사항"에 기록한다 — 프로필을 안 읽은 사람도 이 프로젝트의 결정을 알 수 있어야 한다.
2. **생성**: 아래 기본 구조를 만들고, 스택별 조정표에 따라 변형한다. **compose·프록시·nginx 설정은 `~/.claude/jyp/scaffolds/templates/`의 파일을 복사해 프로젝트에 맞게 조정한다** — 즉흥 작성 금지 (docker.md 규칙이 이미 반영된 파일이다).
3. **first-run 준비**: `.env.example`에서 **`.env`를 자동 생성**하고 결정된 값(DB 포트, 노출 포트 등)을 채운다 — compose 변수 치환(`${DB_NAME}`)은 `.env`가 없으면 빈 값으로 기동돼 첫 실행이 깨진다. `.env`는 `.gitignore` 대상임을 재확인.
   - ⚠ **`.env`는 BOM 없이 쓴다 (Windows 함정, 2026-07-14 실측)**: PowerShell의 `Set-Content -Encoding utf8`(5.1)은 BOM을 붙이는데, BOM이 있으면 **compose가 첫 줄의 키를 인식하지 못한다**. `[System.IO.File]::WriteAllText(..., [System.Text.UTF8Encoding]::new($false))` 또는 `Out-File -Encoding ascii`를 쓴다.
4. **초기화**: `git init` 후 첫 커밋 (`chore: 프로젝트 초기 구조 생성`)
5. **보고**: 생성된 구조를 트리로 보여주고, 다음 단계(의존성 설치, `docker compose up` 등)를 안내한다. **노출 포트가 다른 로컬 프로젝트와 충돌할 수 있음을 함께 고지** (충돌 시 `.env`의 포트 변수만 변경).

## 시작 결정 체크리스트

컨벤션 곳곳의 "프로젝트 시작 시 결정"(= patterns.md 0절의 "되돌리기 어려운 결정") 레지스트리. **평소에는 프로필(`profiles/project-default.md`)이 이 표의 답을 대신하고, 이 표는 프로필의 근거이자 미적용 시의 전체 목록이다.** 확정값은 생성되는 CLAUDE.md의 "프로젝트 참고사항"에 기록한다.

| # | 결정 항목 | 기본값 | 근거 문서 |
|---|---|---|---|
| 1 | **언어 — 반드시 묻는다**: 프론트(TS/JS) · 백엔드가 Node면 백엔드도 | **기본값 없음 — 확인 필수** (중간 전환 = 재생성 비용) | react.md / express.md 0절 |
| 2 | 백엔드 스택 | Express (대안: Spring Boot — Java 21 + Gradle). 언어는 1번에서 확인 | express.md / spring.md 0절 |
| 3 | 구조 | 풀스택이면 모노레포(client/+server/) | 아래 모노레포 절 |
| 4 | UI 모드 | 업무 시스템 모드 | design.md 4절 |
| 5 | 다크모드 지원 | 프로젝트별 결정 | design.md 3절 |
| 6 | 브랜드 색 (`:root` 변수) | shadcn 기본 → 프로젝트 색 | design.md 2절 |
| 7 | DB 종류 / 시간대 | MariaDB/MySQL / Asia/Seoul | database.md 1절 |
| 8 | **DB 위치** — (a) 컨테이너 db / (b) 호스트 로컬 / (c) 외부 매니지드 | (a) 컨테이너 | docker.md 4-2절 — compose·.env 구성이 통째로 달라진다 |
| 9 | **DB 호스트 노출 포트** | 3306 (로컬에 다른 MySQL이 있으면 3307 등) | docker.md 4-3절 |
| 10 | **서비스 노출 포트** (`.env` 변수) | client 5173 / server 3000 (Spring 8080) | docker.md 4-1절 — 전부 변수화 |
| 11 | **멀티테넌트(다중 법인) 여부** | 단일 테넌트 | database.md 3절 — 소급 비용이 크므로 시작 시 확정 |
| 12 | **다국어(i18n) 지원 여부** — 지원 시 언어 목록·기본 언어 | 미지원(한국어 단일) | i18n.md — 문구 키 소급 비용이 크므로 시작 시 확정 |
| 13 | API 응답 봉투 계약 | 단일 봉투 (모든 응답 `data` 키) | api.md 5절 |
| 14 | 테스트 파일 위치 | `tests/` 미러링 | testing.md 4절 |
| 15 | **외부 노출·도메인·프록시 — 반드시 묻는다**: ①서버가 인터넷에서 접근 가능한가 ②도메인 유무 ③프록시 선택(nginx / Caddy) | 사내망 전용 — **nginx-unprivileged 프록시**(HTTP, non-root). **외부 노출 + 도메인이면 Caddy 권장**(자동 HTTPS — ACME 검증은 인터넷에서 80 도달 가능할 때만 동작). 외부 노출인데 nginx를 택하면 certbot 갱신 운영을 CLAUDE.md에 기록 | docker.md 7절 |
| 16 | GitHub 원격/CI 사용 여부 | 사용 (test.yml + release.yml 생성) | 아래 CI 절 |
| 17 | **가동 모니터링/알림 구현 여부 — 반드시 묻는다**: (a) 사내 인프라팀 위임 / (b) 자체 구축(Uptime Kuma) | (a) 인프라팀 위임 — 헬스 URL·연락처 전달, CLAUDE.md 기록 | ops.md 7절 |
| 18 | **사내 API서버 연동 여부** — 있으면 대상·주소(env 키)·인증 방식·담당 창구를 CLAUDE.md에 기록 | 미연동 (연동 시 `external/` 계층 + `INTERNAL_API_URL` 추가) | integration.md |
| 19 | **인증 소스 — 반드시 묻는다**: (a) 자체 로그인 / (b) 사내 인증 위임 / (c) SSO(OIDC·SAML) | (a) 자체 로그인 — 표준 스키마 그대로. (b)(c)는 user 테이블 조정(`password_hash` 제거 + `external_user_key`) + 계정 프로비저닝(JIT/사전등록) 결정 필요. **(b)는 잠금 컬럼 유지 + 시도 제한 구현**(우리가 ID/PW를 받는다), (c)는 잠금 컬럼도 제거 | auth.md 0·1절 |
| 20 | **정기 배치 작업 필요 여부** (집계·사내 API 동기화·알림 발송·정리) | 없음 (필요하면 `06_batch_history.sql` 포함 + 첫 배치 구현 전에 실행 방식을 사용자에게 제안·확정) | batch.md 0·1절 |
| 21 | **테스트 DB 사용 여부** — 있으면 실제 DB로 서비스·쿼리 검증(동시성·제약까지), 없으면 쿼리 목킹 | (a) 사용 — compose에 `db-test` + CI에도 구성 | testing.md 0절 |
| 22 | **예상 규모** — 동시 사용자 수, 주요 테이블의 연간 증가 건수 | 사내 업무 시스템(동시 수십 명, 연 수만 건) — 단일 인스턴스 | patterns.md 0-3절 — 페이징 상한·인덱스·배치·다중화 필요성의 근거. 규모가 이를 크게 넘으면 다중 인스턴스 전제로 재검토 |
| 23 | **배포 호스트 구성** — 운영·개발서버가 물리적으로 분리인가, **한 PC에 공존**인가 | 분리 (각 서버 1대) | docker.md 7-2절 — 공존이면 `COMPOSE_PROJECT_NAME`·디렉토리·DB 자격·프록시 포트를 스택별로 분리 (미분리 시 볼륨이 겹쳐 개발이 운영 DB를 붙잡는다) |
| 24 | **Spring 데이터 접근 — 백엔드=Spring일 때 반드시 묻는다**: (a) JdbcClient / (b) JPA(+QueryDSL) / (c) MyBatis | (a) JdbcClient (순수 SQL·Boot 버전 자유) | spring.md 0절 — 리포지토리 계층·의존성·Boot 버전 제약이 갈린다. MyBatis 채택 시 Boot 4.0.x 고정, JPA 채택 시 N+1·지연로딩 정책을 CLAUDE.md에 함께 기록 |

## 기본 구조

```
<프로젝트명>/
├── README.md          # 아래 초기 내용 참조
├── CLAUDE.md          # 아래 초기 내용 참조
├── .gitignore         # 언어에 맞는 표준 gitignore
├── .env.example       # 환경 변수가 필요한 프로젝트만 (포트 변수 포함)
├── .env               # .env.example에서 자동 생성 — git 비추적 (생성 절차 3)
├── Dockerfile         # 멀티스테이지 빌드 — 스택별 예시: conventions/docker.md 2절
├── .dockerignore      # node_modules, .env*, .git 등
├── docker-compose.yml           # base + dev/deploy override — 규칙: docker.md 4-1절
├── .github/
│   └── workflows/
│       └── test.yml   # CI — push/PR마다 테스트 자동 실행 (아래 CI 절 — 스택별 job)
├── docs/              # 설계 문서, 결정 기록
│   ├── dev_log/       # 작업 이력 ("작업 정리" 명령이 changelog를 여기에 생성)
│   └── incidents/     # 장애 기록 (운영 프로젝트만 — incident 템플릿)
├── migrations/        # DB 사용 프로젝트만 — 규칙: conventions/migration.md
├── src/               # 소스 코드 (스택별 조정표 참조)
├── tests/             # 테스트 코드 (testing.md)
└── scripts/           # 빌드/배포/유틸 스크립트
```

## 풀스택 모노레포 구조 (client + server)

웹 서비스(프론트+백엔드)는 **한 저장소에 client/·server/를 두는 모노레포**를 기본으로 한다:

```
<프로젝트명>/
├── README.md / CLAUDE.md / .gitignore / .env.example / .env
├── docker-compose.yml           # base            ┐
├── docker-compose.dev.yml       # 개발 모드        ├ templates/에서 복사 (docker.md 4-1절)
├── docker-compose.deploy.yml    # 배포 모드        ┘
├── proxy/
│   └── nginx.conf | Caddyfile   # 프록시 설정 — 체크리스트 15 선택 (정적 서빙은 client가 담당)
├── .github/workflows/
│   ├── test.yml                 # 스택별 job (+ 테스트 DB 서비스)
│   └── release.yml              # 태그 push → ghcr.io 이미지 빌드·push
├── docs/                        # 공유 (dev_log/, incidents/, 설계 문서)
├── migrations/                  # DB 마이그레이션 (공유 — migrate 서비스가 읽는다)
├── client/                      # React — package.json, Dockerfile, nginx.conf(정적 서빙)
└── server/                      # Express TS 또는 Spring Boot — 빌드 파일, Dockerfile
```

- 패키지 관리는 client/·server/ 각자 개별 수행 (루트 package.json 없이 시작 — 필요해지면 워크스페이스 도입).
- Dockerfile은 각 서비스별로, compose가 전체를 조립한다 (docker.md).
- **정적 서빙은 client(nginx) 컨테이너, 프록시는 라우팅(+ Caddy 채택 시 HTTPS 종단)** (docker.md 2-3·7절). 프록시 서비스와 그 설정 파일은 반드시 포함 — 없으면 배포 모드에 외부 접근 경로가 없다. 로컬 개발 모드는 프록시 없이 Vite `server.proxy`로 `/api/*`를 서버에 연결해 동일 출처를 유지한다.
- **compose·프록시 설정(nginx-proxy.conf 또는 Caddyfile — 체크리스트 15)·nginx.conf는 `~/.claude/jyp/scaffolds/templates/`에서 복사**하고 프로젝트 결정값(스택·DB 위치·테스트 DB·배치 유무)에 맞게 불필요한 서비스를 지운다.
- CLAUDE.md·docs·migrations는 루트에서 공유 — "작업 정리"도 저장소 단위 1회.

## 기초 테이블 (DB 사용 프로젝트)

- `~/.claude/jyp/schemas/`의 표준 스키마(schema_migrations / 인증·권한 / 공통코드 / 파일 메타 / 감사 로그 / company)를 `migrations/001_core_tables.sql`(DDL이므로 필요 시 분할)로 복사해 첫 마이그레이션으로 삼는다.
- 프로젝트 요구에 맞게 조정한다: **멀티테넌트면 `05_company.sql` 포함 + 전 업무 테이블에 스코프 컬럼**(database.md 3절), 불필요한 테이블(예: 파일 업로드 없는 프로젝트의 files)은 제외. **다국어면 코드성 테이블에 `_i18n` 번역 테이블 동반** (i18n.md 3절). **인증 소스가 위임·SSO면(체크리스트 19) user 테이블 조정** — `password_hash` 제거 + `external_user_key` 추가. **위임(b)은 잠금 컬럼(`failed_login_count`·`locked_at`) 유지, SSO(c)는 함께 제거** (auth.md 0절). **정기 배치가 있으면(체크리스트 20) `06_batch_history.sql` 포함** (batch.md 3절).
- JVM(Flyway) 채택 시 `00_schema_migrations.sql`은 복사하지 않고, 파일명은 Flyway 규약(`V001__core_tables.sql`)을 따른다 (migration.md 5절).
- 초기 관리자 계정·기본 역할(ADMIN 등) 시드는 별도 마이그레이션 파일로, `NOT EXISTS` 가드와 함께.

## 스택별 조정표

| 스택 | 조정 내용 |
|---|---|
| Python | `pyproject.toml` 추가, `src/<패키지명>/` 레이아웃, `src/<패키지명>/__init__.py`. 테스트: **pytest** |
| Node/Express 서버 | **언어는 체크리스트 1에서 확인** — `package.json`(`"type": "module"`). TS면 `tsconfig.json`(`strict: true`) + 개발 `tsx watch` / 배포 `tsc` 빌드, JS면 개발 `node --watch` / 빌드 없음. 계층 구조는 `conventions/express.md` 1절, 경계 검증은 **zod**. 테스트: **Vitest + supertest** — 의존성 설치 + `"test"` 스크립트 등록까지 스캐폴드가 한다. DB 사용 시 **마이그레이션 러너**(`npm run migrate` — migration.md 5절) 포함 |
| Spring Boot 서버 | **Java 21 + Gradle** — 구조·패턴은 `conventions/spring.md`. Spring Initializr 산출물로 시작(web, validation, actuator, flyway + DB 드라이버). **데이터 접근 의존성은 체크리스트 24 선택에 따른다**: JdbcClient=`spring-boot-starter-jdbc`(별도 ORM 없음) / JPA=`spring-boot-starter-data-jpa`(+ QueryDSL) / MyBatis=`mybatis-spring-boot-starter`(⚠ Boot 4.0.x 고정). **Gradle wrapper jar 확보 필수**(오프라인 생성 불가 — Initializr 산출물 사용) + `git update-index --chmod=+x gradlew`(Windows 실행 비트 유실 — spring.md 0절). 마이그레이션: **Flyway**(`spring.flyway.enabled=false` + 별도 단계). 테스트: **JUnit 5**, `./gradlew test`. **자동 강제: Spotless + Checkstyle을 `check`에 연결**(spring.md 7절) |
| React/Next.js | **언어는 체크리스트 1에서 확인** — TS면 Vite `react-ts` 템플릿 / Next.js `create-next-app --typescript` + `strict: true` 고정, JS면 Vite `react` 템플릿 / `create-next-app`(TS 미지정). **CLI 산출물 위에 얹은 뒤 데모 잔재를 정리한다**: 데모 App/CSS/로고 에셋 제거, `index.html`의 `<title>`·메타를 프로젝트명으로 치환, favicon 결정. 스타일링: **Tailwind + shadcn/ui — `design.md` 8절 셋업 레시피의 체크리스트 전 항목 수행**(JS 프로젝트면 `components.json`의 `tsx: false` 포함). 테스트: **Vitest + Testing Library** — ⚠ Vite 템플릿에는 test 스크립트가 없다: 의존성 설치 + `"test": "vitest run --passWithNoTests"` 등록까지 해야 CI `npm test`가 깨지지 않는다 |
| 기타 | 해당 언어 커뮤니티의 표준 레이아웃을 조사해서 따르고, CLAUDE.md/docs/는 항상 추가. 테스트 도구는 해당 언어 표준 채택 |

## 린트·포맷 (자동 강제 — MANDATORY)

**컨벤션 중 도구로 강제할 수 있는 것은 도구가 강제한다.** 문서로만 두면 코드가 커질수록 지켜지지 않는다 — 린트 설정은 스캐폴드 단계에서 반드시 포함한다.

- **React/Node**: 언어(체크리스트 1)에 맞는 템플릿을 각 디렉토리에 `eslint.config.mjs`로 복사하고 `"lint": "eslint ."` 스크립트를 등록한다 — **TS면** `~/.claude/jyp/scaffolds/templates/eslint.config.client.mjs` / `eslint.config.server.mjs`, **JS면** `eslint.config.client-js.mjs` / `eslint.config.server-js.mjs`(TS 전용 규칙인 `any` 금지만 빠지고 나머지 강제는 동일 — 2026-07-17 검증). 강제되는 규칙: `any` 금지, 순환 의존, `=== 200` 비교, hex·팔레트 색상, 네이티브 alert/confirm, 토큰 스토리지 저장, axios 직접 import, `process.env || 폴백`, `console.error(err)` 한 줄, SQL 템플릿 리터럴 보간.
  - 설치 (⚠ **eslint와 `@eslint/js`의 메이저를 맞춘다** — 최신 `@eslint/js`는 eslint 10을 요구해 `ERESOLVE`로 설치가 깨진다. 2026-07-14 실측):
    ```bash
    # client
    npm i -D eslint@9 @eslint/js@9 typescript-eslint eslint-plugin-react-hooks eslint-plugin-import globals
    # server
    npm i -D eslint@9 @eslint/js@9 typescript-eslint eslint-plugin-import globals
    ```
- **Java/Spring**: Spotless(google-java-format) + Checkstyle을 `check`에 연결 (spring.md 7절). ⚠ **`.gitattributes`(`* text=auto eol=lf`)를 반드시 함께 생성**한다 — 없으면 Windows에서 CRLF를 기대해 정상 코드가 `spotlessCheck`에서 실패한다 (2026-07-14 실측).
- **CI와 훅이 이 스크립트를 실행한다** — 린트가 없으면 훅이 조용히 통과해 자동 검증 층이 사라진다.

## 초기 파일 내용

### README.md
```markdown
# <프로젝트명>

<목적 한 줄>

## 시작하기
<!-- 설치 및 실행 방법 — 구현되는 대로 채운다. "먼저 .env 확인" 단계 포함 -->

## 구조
<!-- 주요 디렉토리 설명 -->
```

### CLAUDE.md
```markdown
# <프로젝트명>

<목적 한 줄>

## 작업 규칙
@~/.claude/jyp/rules/dev-rules.md

## 코딩 컨벤션
@~/.claude/jyp/conventions/general.md

## 프로젝트 참고사항
<!-- 시작 결정 체크리스트 확정값을 여기에 기록. 이 프로젝트만의 규칙, 주의점 추가 -->

## 다중화 전환 목록
<!-- 단일 인스턴스 전제에 의존하는 항목 (patterns.md 0-3절).
     앱 인스턴스를 2개 이상으로 늘릴 때 손봐야 할 것을 발견 즉시 여기에 기록한다.
     예: 인메모리 권한 캐시 → 공유 캐시 / 업로드 로컬 볼륨 → 공유 스토리지 -->

## Critical Pitfalls
<!-- 번호 레지스트리 — 번호 재사용 금지, 기존 항목과 겹치면 갱신.
     규칙에는 확정 날짜 + ✅/❌ 예시 + 근거(버그 사례) 병기. 비대해지면 위성 문서로 분리 -->
```

### .gitignore
언어별 표준 gitignore(github/gitignore 기준)에 다음을 항상 포함:
```
.env
*.log
```

### .env.example
결정된 값을 변수로 — 최소한 다음을 포함. 각 항목의 규칙: 모드·포트는 docker.md 4-1절, DB 접속은 4-3절 매트릭스, SITE_ADDRESS·DEPLOY_TAG는 5·7절, 테스트 DB는 testing.md 0절. compose에서는 폴백 없이 `${VAR:?}`로 참조한다.
```
# 모드 선택 (로컬=dev, 서버=deploy)
COMPOSE_FILE=docker-compose.yml:docker-compose.dev.yml
# ⚠ COMPOSE_FILE 구분자 — Windows 기본값은 ';'라 위 표기가 깨진다. ':'로 고정 (2026-07-14 실측)
COMPOSE_PATH_SEPARATOR=:
# 스택 이름 — 컨테이너·네트워크·볼륨 이름의 접두사.
# 한 호스트에 운영·개발을 함께 띄우면 반드시 다르게 (docker.md 7-2절: 안 하면 볼륨이 겹친다)
COMPOSE_PROJECT_NAME=<프로젝트명>-dev
# 노출 포트 (충돌 시 여기만 변경)
WEB_PORT=5173
API_PORT=3000
DB_PORT=3306
# 프록시 노출 포트 (배포 모드 — 운영 80, 같은 호스트의 개발 스택은 8080 등. HTTPS_PORT는 Caddy 채택 시만)
HTTP_PORT=80
HTTPS_PORT=443
# DB 접속
DB_HOST=db
DB_NAME=<프로젝트명>
DB_USER=
DB_PASSWORD=
DB_ROOT_PASSWORD=
# 테스트 DB (체크리스트 21 — 사용 시)
TEST_DB_NAME=<프로젝트명>_test
TEST_DB_USER=
TEST_DB_PASSWORD=
TEST_DB_PORT=3307
# 프록시 접근 주소 (Caddy 채택 시만 — 도메인 값으로 교체하면 자동 HTTPS)
SITE_ADDRESS=:80
# 배포 이미지 (서버 .env에서만 사용 — CI가 push한 ghcr 경로와 태그)
IMAGE_PREFIX=ghcr.io/<계정>/<저장소>
DEPLOY_TAG=
# 사내 API 연동 (체크리스트 18 — 연동 프로젝트만, integration.md 3절)
INTERNAL_API_URL=
INTERNAL_API_KEY=
```

### .github/workflows/test.yml
GitHub 원격 저장소를 쓰는 프로젝트에 생성 (사내 전용/무원격이면 생략하고 사용자에게 고지). **job은 스택별로 구성한다** — 모노레포는 디렉토리별 job, 이종 스택(예: React + Spring)이면 툴체인도 job마다 다르다:

```yaml
name: test
on: [push, pull_request]
jobs:
  # Node job
  test-client:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: client } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm run lint          # 컨벤션 자동 강제 (린트 절)
      - run: npm test

  # JVM job (Spring 서버) — 테스트 DB를 쓰면 서비스 컨테이너로 띄운다 (체크리스트 21)
  test-server:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: server } }
    services:
      db-test:
        image: mariadb:11.4
        env:
          MARIADB_DATABASE: app_test
          MARIADB_USER: app
          MARIADB_PASSWORD: test
          MARIADB_ROOT_PASSWORD: test
        ports: ['3306:3306']
        options: >-
          --health-cmd="healthcheck.sh --connect --innodb_initialized"
          --health-interval=10s --health-timeout=5s --health-retries=10
    env:
      TEST_DB_HOST: 127.0.0.1
      TEST_DB_PORT: 3306
      TEST_DB_NAME: app_test
      TEST_DB_USER: app
      TEST_DB_PASSWORD: test
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: 21
      - run: chmod +x gradlew
      - run: ./gradlew check --no-daemon      # spotlessCheck + checkstyle + test

  docker:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: docker build -t ci-client-check client/
      - run: docker build -t ci-server-check server/
```

- 단일 구조 프로젝트는 해당 스택 job 하나 + docker job으로 축소 (`working-directory` 제거, `docker build .`). 서버가 Node면 test-server도 Node job 형태로 하되 **`services:`와 `env:` 블록은 그대로 유지**한다.
- **테스트 DB를 쓰지 않기로 했으면(체크리스트 21-b) `services:`·`env:` 블록을 제거**한다 — 대신 쿼리 목킹으로 테스트한다.
- Python 프로젝트는 `setup-python` + `pip install -e .[dev]` + `pytest`로 대체.
- docker job은 이미지 빌드 성공만 검증한다 — Dockerfile이 깨진 채 배포 시점까지 가는 것을 방지 (push/실행은 하지 않음).

### .github/workflows/release.yml

배포 태그(`v*`) push 시 이미지를 빌드해 ghcr.io로 push한다 — 서버는 pull만 (docker.md 5절 배포 절차의 2단계):

```yaml
name: release
on:
  push:
    tags: ['v*']
jobs:
  build-push:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - run: |
          docker build -t ghcr.io/${{ github.repository }}-server:${{ github.ref_name }} server/
          docker push ghcr.io/${{ github.repository }}-server:${{ github.ref_name }}
          docker build -t ghcr.io/${{ github.repository }}-client:${{ github.ref_name }} client/
          docker push ghcr.io/${{ github.repository }}-client:${{ github.ref_name }}
```

- 단일 구조는 이미지 하나로 축소 (`docker build .`). deploy override의 `image:`는 같은 ghcr 경로를 참조한다.
- 서버 최초 셋업 시 `docker login ghcr.io`(`read:packages` 토큰) 1회 — 토큰 보관은 ops.md 1절 시크릿 규칙.

## 주의

- 이미 파일이 있는 폴더에는 생성하지 않는다. 먼저 사용자에게 확인한다.
- 요청받지 않은 예제 코드, 샘플 파일을 만들지 않는다. 빈 구조까지만 (프레임워크 CLI 산출물의 데모 제거는 반대로 필수 — 조정표).
- `docs/REFACTORING_BACKLOG.md`는 스캐폴드 시점에 만들지 않는다 — 첫 개선 항목을 발견하는 시점에 backlog 템플릿(`~/.claude/jyp/templates/backlog.md`)으로 생성한다.
