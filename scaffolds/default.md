# 새 프로젝트 스캐폴드

사용자가 "새 프로젝트 시작/세팅"을 요청하면 이 문서의 절차대로 생성한다.

## 생성 절차

1. **확인**: **`~/.claude/jyp/profiles/project-default.md`(사내 표준 프로필)를 먼저 읽는다.** 프로필이 체크리스트의 기본 답안이므로, 36개를 순서대로 다 묻지 않는다:
   1. **프로필의 [확인] 항목만 묻는다 (4개)**: 프로젝트명·목적 / 인증 소스 / 사내 API 연동 / 특수 요구(멀티테넌트·다국어·배치).
   2. **[고정] 항목은 확정값을 표로 보여주고 이견만 받는다** — 묻지 않되 숨기지도 않는다.
   3. 프로필 미적용 신호(대외 서비스·비표준 스택·규제 요건)에 해당하면 **프로필을 버리고 체크리스트 전체**를 확인한다.
   4. 확정값은 전부 CLAUDE.md "프로젝트 참고사항"에 기록한다 — 프로필을 안 읽은 사람도 이 프로젝트의 결정을 알 수 있어야 한다. "운영 정보"·"정기 점검" 표는 지금 아는 값(런타임 버전·지원 종료일, 해당 없는 행)만 채우고 나머지는 `<미정>` 그대로 둔다 — `/deploy-check`가 운영 배포 전에 빈칸을 막는다.
2. **생성**: 아래 기본 구조를 만들고, 스택별 조정표에 따라 변형한다. **compose·프록시·nginx 설정은 `~/.claude/jyp/scaffolds/templates/`의 파일을 복사해 프로젝트에 맞게 조정한다** — 즉흥 작성 금지 (docker.md 규칙이 이미 반영된 파일이다).
3. **first-run 준비**: `.env.example`에서 **`.env`를 자동 생성**하고 결정된 값(DB 포트, 노출 포트 등)을 채운다 — compose 변수 치환(`${DB_NAME}`)은 `.env`가 없으면 빈 값으로 기동돼 첫 실행이 깨진다. `.env`는 `.gitignore` 대상임을 재확인. **`JWT_SECRET`은 생성 시 랜덤값(48바이트 base64)으로 채운다** — `.env.example`에는 값을 넣지 않는다(저장소에 서명 키가 남는다).
   - ⚠ **`.env`는 BOM 없이 쓴다 (Windows 함정, 2026-07-14 실측)**: PowerShell의 `Set-Content -Encoding utf8`(5.1)은 BOM을 붙이는데, BOM이 있으면 **compose가 첫 줄의 키를 인식하지 못한다**. `[System.IO.File]::WriteAllText(..., [System.Text.UTF8Encoding]::new($false))` 또는 `Out-File -Encoding ascii`를 쓴다.
4. **초기화**: `git init` 후 첫 커밋 (`chore: 프로젝트 초기 구조 생성`)
5. **보고**: 생성된 구조를 트리로 보여주고, 다음 단계(의존성 설치, `docker compose up` 등)를 안내한다. **노출 포트가 다른 로컬 프로젝트와 충돌할 수 있음을 함께 고지** (충돌 시 `.env`의 포트 변수만 변경).

## 시작 결정 체크리스트

컨벤션 곳곳의 "프로젝트 시작 시 결정"(= patterns.md 0절의 "되돌리기 어려운 결정") 레지스트리. **평소에는 프로필(`profiles/project-default.md`)이 이 표의 답을 대신하고, 이 표는 프로필의 근거이자 미적용 시의 전체 목록이다.** 확정값은 생성되는 CLAUDE.md의 "프로젝트 참고사항"에 기록한다.

| # | 결정 항목 | 기본값 | 근거 문서 |
|---|---|---|---|
| 1 | **언어 — 반드시 묻는다**: 프론트(TS/JS) · 백엔드가 Node면 백엔드도 | **기본값 없음 — 확인 필수** (중간 전환 = 재생성 비용) | react.md / express.md 0절 |
| 2 | 백엔드 스택 | Express (대안: Spring Boot — Java 25 + Gradle). 언어는 1번에서 확인. **런타임은 LTS만**(Node·Java 버전은 템플릿 값 — general.md 8-1절) | express.md / spring.md 0절 |
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
| 16 | GitHub 원격/CI 사용 여부 | 사용 (test.yml + release.yml + audit.yml + dependabot.yml 생성, 저장소 보안 설정 — ops.md 5-1절) | 아래 CI 절 |
| 17 | **가동 모니터링/알림 구현 여부 — 반드시 묻는다**: (a) 사내 인프라팀 위임 / (b) 자체 구축(Uptime Kuma) | (a) 인프라팀 위임 — 헬스 URL·연락처 전달 + **운영 감시 URL(`/api/ops/status`)은 수신자를 개발팀으로** 등록, CLAUDE.md 기록 | ops.md 7절, batch.md 3-1절 |
| 18 | **사내 API서버 연동 여부** — 있으면 대상·주소(env 키)·인증 방식·담당 창구를 CLAUDE.md에 기록. **쓰기 연동이 있으면 outbox**(`07_outbox.sql` + relay 워커) + 수신 측 멱등 방식 기록 | 미연동 (연동 시 `external/` 계층 + `INTERNAL_API_URL` 추가) | integration.md 4절 / features/outbox.md |
| 19 | **인증 소스 — 반드시 묻는다**: (a) 자체 로그인 / (b) 사내 인증 위임 / (c) SSO(OIDC·SAML) | (a) 자체 로그인 — 표준 스키마 그대로. (b)(c)는 user 테이블 조정(`password_hash` 제거 + `external_user_key`) + 계정 프로비저닝(JIT/사전등록) 결정 필요. **(b)는 잠금 컬럼 유지 + 시도 제한 구현**(우리가 ID/PW를 받는다), (c)는 잠금 컬럼도 제거 | auth.md 0·1절 |
| 20 | **정기 배치 작업 필요 여부** (집계·사내 API 동기화·알림 발송·정리) | 없음 (필요하면 `06_batch_history.sql` 포함 + 첫 배치 구현 전에 실행 방식을 사용자에게 제안·확정) | batch.md 0·1절 |
| 21 | **테스트 DB 사용 여부** — 있으면 실제 DB로 서비스·쿼리 검증(동시성·제약까지), 없으면 쿼리 목킹 | (a) 사용 — compose에 `db-test` + CI에도 구성 | testing.md 0절 |
| 22 | **예상 규모** — 동시 사용자 수, 주요 테이블의 연간 증가 건수 | 사내 업무 시스템(동시 수십 명, 연 수만 건) — 단일 인스턴스 | patterns.md 0-3절 — 페이징 상한·인덱스·배치·다중화 필요성의 근거. 규모가 이를 크게 넘으면 다중 인스턴스 전제로 재검토 (features/multi-instance.md) |
| 23 | **배포 호스트 구성** — 운영·개발서버가 물리적으로 분리인가, **한 PC에 공존**인가 | 분리 (각 서버 1대) | docker.md 7-2절 — 공존이면 `COMPOSE_PROJECT_NAME`·디렉토리·DB 자격·프록시 포트를 스택별로 분리 (미분리 시 볼륨이 겹쳐 개발이 운영 DB를 붙잡는다) |
| 24 | **Spring 데이터 접근 — 백엔드=Spring일 때 반드시 묻는다**: (a) JdbcClient / (b) JPA(+QueryDSL) / (c) MyBatis | (a) JdbcClient (순수 SQL·Boot 버전 자유) | spring.md 0절 — 리포지토리 계층·의존성·Boot 버전 제약이 갈린다. MyBatis 채택 시 스타터의 Boot 대응 버전(4.0.x↔Boot 4.0, 4.1.x↔Boot 4.1)을 맞춰 기록, JPA 채택 시 N+1·지연로딩 정책과 QueryDSL 포크(`io.github.openfeign.querydsl`)를 CLAUDE.md에 함께 기록 |
| 25 | **운영 DB 식별자** — 호스트·포트·DB명 | 생성 시 묻지 않는다 — 배포 호스트가 정해지면 기록. 미기록이면 `/live-test`가 첫 실행 때 묻고 기록 | testing.md 6-1절 — 개발 DB 쓰기를 허용하는 실동작 검증이 운영 DB를 가려내는 유일한 기준. 없으면 검증이 진행되지 않는다 |
| 26 | **결재 필요 여부·방식** — 결재 대상 문서가 있으면: (a) 사내 전자결재 연동 / (b) 자체 결재 | 결재 없음. 필요하면 **(a) 사내 전자결재가 있으면 연동 우선** — 결재함이 둘이 되면 결재자가 한쪽을 놓친다 | approval.md 2절 — 테이블·화면·연동이 통째로 갈린다 |
| 27 | **개인정보 처리 여부·등급** — 고유식별정보·민감정보 포함 여부, 정보주체 규모 | 처리함(일반) — 화면 마스킹 + 접속기록 **별도 DB**(`{DB_NAME}_log`, 앱 계정 SELECT·INSERT만). **고유식별정보·카드·계좌번호를 저장하면 앱 계층 암호화 + 블라인드 인덱스**(키는 환경변수) — 저장하지 않는 것이 기본 | personal-data.md 2절·features/field-encryption.md 2절 — 접속기록 DB·계정 권한은 인프라 구성, 평문으로 쌓은 뒤 암호화로 바꾸면 전 행 재기록·검색 쿼리가 함께 바뀐다 |
| 28 | **외부 노출 ID** — URL·API에 레코드 ID가 나가는 대외 서비스인가 | 사내: 적용 안 함(내부 PK 그대로). **대외: 노출 테이블에 `public_id`(랜덤 21자, `ascii_bin`) + API의 모든 ID 필드를 공개 ID로** | features/public-id.md 2절 — API 계약이라 한번 내보낸 ID는 북마크·연동에 박혀 바꿀 수 없다 |
| 29 | **검색 노출(SEO) — 공개 페이지 유무·성격** | 사내: 없음 — `robots.txt` `Disallow: /`. 대외: 공개 페이지가 적고 거의 안 바뀌면 빌드 시 프리렌더, 많고 자주 바뀌면 서버 렌더링 프레임워크(사내 표준 밖 — 프로필 미적용) | features/seo.md 2절 — 서버 렌더링이 필요하면 프레임워크가 바뀐다 |
| 30 | **대외 자체 가입 계정 정책** — 소셜 로그인 제공사, 동의 항목 구분, 탈퇴 후 보존 항목·기간 | 대외 자체 가입일 때만. **동의 항목·보존 기간은 법무가 원문으로 확인해 CLAUDE.md에 기록**, 제공사 개발자 앱은 처음부터 운영용 | features/social-login.md·consent.md·account-withdrawal.md — 식별 키·동의 이력 구조는 소급할 수 없다 |
| 31 | **결제(PG) 여부** — PG사, 결제 수단, 청약철회 제한 상품 유무 | 없음. 있으면 **PG 결제창(카드번호 미수신) + 시도마다 `payment` 행 + 서버 계산 금액 대조 + 승인·취소 멱등 키 + 대사 배치**, 영업일·제한 표시는 법무 확인 | features/payment.md 2절 — 주문·결제 1:1 구조나 클라이언트 금액 신뢰로 시작하면 쌓인 결제 데이터·정산 대사를 함께 고쳐야 한다 |
| 32 | **외부 공개 API 여부** — 연동사, 제공 데이터·권한 범위 | 없음. 있으면 **`/api/public/v1` 분리 + API 키(접두어 16자 + sha256 저장) + 연동사별 한도 + 메이저 버전만 URL에** | features/public-api.md 2절 — 공개한 URL·필드·키 형식은 연동사 코드에 박혀 혼자 바꿀 수 없다 |
| 33 | **본인확인(실명) 여부** — 1인 1계정·성인 확인·만 14세 미만 가입 허용 여부, 본인확인 대행사 | 없음(휴대폰 소유 확인만 필요하면 6자리 코드 — account-lifecycle.md 3-4절). 있으면 **서버가 결과를 받는 연동 + 결과 1회 사용 + CI 블라인드 인덱스 UNIQUE + 한국 날짜 만 나이**, 14세 미만은 받지 않음이 기본 | features/identity-verification.md — 중복 판정 키·가입 시 확인 여부는 기존 회원에게 소급할 수 없다 |
| 34 | **검색 요구 수준** — 검색 대상 행 규모(수백만 이상?), 부분 일치로 충분한지·형태소 분석·오타 허용이 필요한지 | DB `LIKE` 부분 일치 + `ESCAPE '!'` + 범위 조건 (FULLTEXT 기본 파서는 한글 2글자를 못 찾는다) | features/korean-search.md — 검색 전용 저장소는 색인 동기화·권한 필터가 함께 붙어 나중에 바꾸기 어렵다 |
| 35 | **금액 계산 정책** — 원 미만 처리(절사·반올림), 세액 계산 단위(합계·줄별), 할인 배분 규칙 | 금액을 다루면 회계팀과 확정 — 기본 제안: 원 정수(`BIGINT`), 세액 원 미만 절사, 합계 공급가액 기준 1회 계산 | features/money-calc.md — 이미 발행한 문서와 계산이 달라지면 되돌릴 수 없다 |
| 36 | **백업 사본 위치 — 반드시 묻는다**: (a) 사내 백업 체계·NAS에 위임 / (b) 다른 서버로 직접 복사 | (a) 사내 체계가 있으면 위임, 없으면 (b) — **운영 개시 전 확정**, 위치·보관 기간·키 보관처를 CLAUDE.md에 기록 | ops.md 6절 — 같은 서버의 백업은 서버와 함께 사라진다 |

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
│   ├── workflows/
│   │   └── test.yml   # CI — push/PR마다 테스트 자동 실행 (아래 CI 절 — 스택별 job)
│   └── dependabot.yml # 의존성 갱신 PR (아래 — ops.md 5-1절)
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
├── .github/
│   ├── workflows/
│   │   ├── test.yml             # 스택별 job (+ 테스트 DB 서비스)
│   │   ├── release.yml          # 태그 push → 취약점 검사 → ghcr.io 이미지 빌드·push
│   │   └── audit.yml            # 의존성 취약점 검사 — release가 호출 + 주 1회 (ops.md 5-1절)
│   └── dependabot.yml           # 의존성 갱신 PR (ops.md 5-1절)
├── docs/                        # 공유 (dev_log/, incidents/, 설계 문서)
├── migrations/                  # DB 마이그레이션 (공유 — migrate 서비스가 읽는다)
├── scripts/backup.sh            # DB·업로드 백업 — backup 서비스가 실행 (ops.md 6절)
├── client/                      # React — package.json, Dockerfile, nginx.conf(정적 서빙)
└── server/                      # Express TS 또는 Spring Boot — 빌드 파일, Dockerfile
```

- 패키지 관리는 client/·server/ 각자 개별 수행 (루트 package.json 없이 시작 — 필요해지면 워크스페이스 도입).
- Dockerfile은 각 서비스별로, compose가 전체를 조립한다 (docker.md).
- **정적 서빙은 client(nginx) 컨테이너, 프록시는 라우팅(+ Caddy 채택 시 HTTPS 종단)** (docker.md 2-3·7절). 프록시 서비스와 그 설정 파일은 반드시 포함 — 없으면 배포 모드에 외부 접근 경로가 없다. 로컬 개발 모드는 프록시 없이 Vite `server.proxy`로 `/api/*`를 서버에 연결해 동일 출처를 유지한다.
- **compose·프록시 설정(nginx-proxy.conf 또는 Caddyfile — 체크리스트 15)·nginx.conf·backup.sh(→ `scripts/`)는 `~/.claude/jyp/scaffolds/templates/`에서 복사**하고 프로젝트 결정값(스택·DB 위치·테스트 DB·배치 유무)에 맞게 불필요한 서비스를 지운다.
- CLAUDE.md·docs·migrations는 루트에서 공유 — "작업 정리"도 저장소 단위 1회.

## 기초 테이블 (DB 사용 프로젝트)

- `~/.claude/jyp/schemas/`의 표준 스키마(schema_migrations / 인증·권한 / 공통코드 / 파일 메타 / 감사 로그 / company)를 `migrations/001_core_tables.sql`(DDL이므로 필요 시 분할)로 복사해 첫 마이그레이션으로 삼는다.
- 프로젝트 요구에 맞게 조정한다: **멀티테넌트면 `05_company.sql` 포함 + 전 업무 테이블에 스코프 컬럼**(database.md 3절), 불필요한 테이블(예: 파일 업로드 없는 프로젝트의 files)은 제외. **다국어면 코드성 테이블에 `_i18n` 번역 테이블 동반 + `user`에 `locale VARCHAR(10) NULL` 추가** (i18n.md 3·4절 — 사용자 선호 locale은 fallback 사슬의 첫 층이다. 법인 기본값 `company.locale`은 05_company.sql에 이미 있다). **인증 소스가 위임·SSO면(체크리스트 19) user 테이블 조정** — `password_hash` 제거 + `external_user_key` 추가. **위임(b)은 잠금 컬럼(`failed_login_count`·`locked_at`) 유지, SSO(c)는 함께 제거** (auth.md 0절). **정기 배치가 있거나 백업 서비스를 쓰면(DB 위치 (a)의 기본 — ops.md 6절) `06_batch_history.sql` 포함** (batch.md 3절 — 백업 성공도 여기에 기록된다). **쓰기 연동이 있으면(체크리스트 18) `07_outbox.sql` 포함** (features/outbox.md 3절). **기본 포함: `12_error_event.sql`(error-alert.md 3절)·`13_app_setting.sql`(maintenance-mode.md 3절)·`15_user_session.sql`(session-control.md 3절)**. 개인정보를 처리하면(체크리스트 27) `14_personal_data_access_log.sql`을 **별도 DB에**(personal-data.md 3-4절), 장시간 작업이 있으면 `11_async_job.sql`(long-running-job.md 3절). 변경 이력을 보여줄 업무 문서가 있으면 `08_change_log.sql`(change-history.md 3절), **자체 결재면(체크리스트 26) `09_approval.sql`**(approval.md 3절), 화면 알림이 있으면 `10_notification.sql`(notification.md 3절). **이용자 자체 가입·비밀번호 재설정이 있으면 `16_account_token.sql` + `user`에 `email_verified_at DATETIME NULL` 추가**(account-lifecycle.md 3절), 2단계 인증이 있으면 `17_user_mfa.sql`(mfa.md 3절). **소셜 로그인이면 `18_user_identity.sql` + `user.password_hash` NULL 허용**(social-login.md 3-3절), **대외 자체 가입이면 `19_terms_consent.sql`**(consent.md 3절)과 `20_retained_personal_data.sql`을 **별도 스키마 `{DB_NAME}_retention`에**(account-withdrawal.md 3절) + `user`에 `withdrawn_at DATETIME NULL`, 문의·신고가 있으면 `21_inquiry.sql`(inquiry.md 3절). **대외 서비스면 `25_privacy_request.sql`**(열람등요구 접수·기한 — privacy-rights.md 3절), 개인정보를 처리하면 `26_privacy_breach.sql`(유출 대응 기록 — privacy-breach.md 3절), **본인확인이면(체크리스트 33) `27_identity_verification.sql`**(identity-verification.md 3절), **기한·영업일 계산이 있으면(열람등요구·환급 포함) `28_holiday.sql`**(holiday.md 3절), 웹훅을 받으면 `22_webhook_inbox.sql`(webhook-receive.md 3절), **결제면(체크리스트 31) `24_payment.sql`**(payment.md 3절), **공개 API면(체크리스트 32) `23_api_client.sql`**(public-api.md 3절).
- JVM(Flyway) 채택 시 `00_schema_migrations.sql`은 복사하지 않고, 파일명은 Flyway 규약(`V001__core_tables.sql`)을 따른다 (migration.md 5절).
- 초기 관리자 계정·기본 역할(ADMIN 등) 시드는 별도 마이그레이션 파일로, `NOT EXISTS` 가드와 함께.

## 스택별 조정표

| 스택 | 조정 내용 |
|---|---|
| Python | `pyproject.toml` 추가, `src/<패키지명>/` 레이아웃, `src/<패키지명>/__init__.py`. 테스트: **pytest** |
| Node/Express 서버 | **언어는 체크리스트 1에서 확인** — `package.json`(`"type": "module"`). TS면 `tsconfig.json`(`strict: true`) + 개발 `tsx watch` / 배포 `tsc` 빌드 — **TypeScript는 `typescript@~6.0.3`으로 고정**(린트 절 — `npm i -D typescript`는 7.x를 설치해 ESLint 설치가 ERESOLVE로 깨진다), JS면 개발 `node --watch` / 빌드 없음. 계층 구조는 `conventions/express.md` 1절, 경계 검증은 **zod**. 테스트: **Vitest + supertest** — 의존성 설치 + `"test"` 스크립트 등록까지 스캐폴드가 한다. DB 사용 시 **마이그레이션 러너**(`npm run migrate` — migration.md 5절) 포함. **테스트 DB 사용(체크리스트 21-a)이면** `~/.claude/jyp/scaffolds/templates/`에서 `vitest.config.server.mjs` → `server/vitest.config.mjs`, `vitest-test-db.global.mjs`·`vitest-test-db.worker.mjs` → `server/test/setup/test-db.global.mjs`·`test-db.worker.mjs`로 복사한다 — 워커마다 테스트 DB를 따로 써서 병렬 테스트가 서로의 데이터를 지우지 않는다(testing.md 0절). 의존성: `mysql2`(앱과 같은 드라이버) |
| Spring Boot 서버 | **Java 25(LTS) + Spring Boot 4.x + Gradle 9.x — Boot 3.x로 시작하지 않는다**(spring.md 0절 STRICT). 구조·패턴은 `conventions/spring.md`. Spring Initializr 산출물로 시작(webmvc, validation, actuator, flyway + DB 드라이버) — **Initializr에 접근할 수 없으면 `~/.claude/jyp/scaffolds/templates/build.gradle`을 복사**하고 버전을 Maven Central 최신 GA로 갱신한다(기억으로 쓰지 않는다 — 학습 데이터 기본값이 Boot 3.x다). `config/checkstyle/checkstyle.xml`은 템플릿 `checkstyle.xml`, `config/header.txt`(파일 헤더 주석), `gradle/osv-lock.gradle`(취약점 검사용 — 템플릿 `osv-lock.gradle`, ops.md 5-1절)도 함께. **데이터 접근 의존성은 체크리스트 24 선택에 따른다**: JdbcClient=`spring-boot-starter-jdbc`(별도 ORM 없음) / JPA=`spring-boot-starter-data-jpa`(+ QueryDSL 포크 `io.github.openfeign.querydsl`) / MyBatis=`mybatis-spring-boot-starter`(⚠ Boot 대응 버전 — 4.0.x↔4.0, 4.1.x↔4.1). **Gradle wrapper jar 확보 필수**(Initializr 산출물, 또는 로컬 Gradle로 `gradle wrapper --gradle-version 9.x`, 둘 다 없으면 spring.md 0절 컨테이너 방식) + `git update-index --chmod=+x gradlew`(Windows 실행 비트 유실 — spring.md 0절). 마이그레이션: **Flyway**(`spring.flyway.enabled=false` + 별도 단계). 테스트: **JUnit Jupiter(Boot 4 관리) + `@MockitoBean`**, `./gradlew test` + **패키지 순환 검사 `ArchitectureTest`(ArchUnit — spring.md 7절)**. **자동 강제: Spotless + Checkstyle을 `check`에 연결**(템플릿에 포함) |
| React/Next.js | **언어는 체크리스트 1에서 확인** — TS면 Vite `react-ts` 템플릿 / Next.js `create-next-app --typescript` + `strict: true` 고정, JS면 Vite `react` 템플릿 / `create-next-app`(TS 미지정). **CLI 산출물 위에 얹은 뒤 데모 잔재를 정리한다**: ⚠ 최신 Vite 템플릿(create-vite 9.x, 2026-10-19 확인)은 **린트가 oxlint(`"lint": "oxlint"`)이고 TypeScript가 `~7.0`이다** — `oxlint` 의존성을 지우고 `lint` 스크립트를 ESLint로 바꾸며(린트 절), **TS는 `~6.0.3`으로 내린다**(TS 7이면 ESLint 설치가 ERESOLVE). 데모 App/CSS/로고 에셋 제거, `index.html`의 `<title>`·메타를 프로젝트명으로 치환, favicon 결정. 스타일링: **Tailwind + shadcn/ui — `design.md` 8절 셋업 레시피의 체크리스트 전 항목 수행**(JS 프로젝트면 `components.json`의 `tsx: false` 포함). 테스트: **Vitest + Testing Library** — ⚠ Vite 템플릿에는 test 스크립트가 없다: 의존성 설치 + `"test": "vitest run --passWithNoTests"` 등록까지 해야 CI `npm test`가 깨지지 않는다 |
| 기타 | 해당 언어 커뮤니티의 표준 레이아웃을 조사해서 따르고, CLAUDE.md/docs/는 항상 추가. 테스트 도구는 해당 언어 표준 채택 |

## 린트·포맷 (자동 강제 — MANDATORY)

**컨벤션 중 도구로 강제할 수 있는 것은 도구가 강제한다.** 문서로만 두면 코드가 커질수록 지켜지지 않는다 — 린트 설정은 스캐폴드 단계에서 반드시 포함한다.

- **React/Node**: 언어(체크리스트 1)에 맞는 템플릿을 각 디렉토리에 `eslint.config.mjs`로 복사하고 `"lint": "eslint ."` 스크립트를 등록한다 — **TS면** `~/.claude/jyp/scaffolds/templates/eslint.config.client.mjs` / `eslint.config.server.mjs`, **JS면** `eslint.config.client-js.mjs` / `eslint.config.server-js.mjs`(TS 전용 규칙인 `any` 금지만 빠지고 나머지 강제는 동일 — 2026-07-17 검증). 강제되는 규칙: `any` 금지, 순환 의존, `=== 200` 비교, hex·팔레트 색상, 네이티브 alert/confirm, 토큰 스토리지 저장, axios 직접 import, 환경변수 폴백(`||`·`??`·변환·구조 분해 기본값), `console.error(err)` 한 줄, SQL에 요청 값 직접 보간.
  - 설치 (⚠ **eslint와 `@eslint/js`의 메이저를 맞춘다** — 최신 `@eslint/js`는 eslint 10을 요구해 `ERESOLVE`로 설치가 깨진다. 2026-07-14 실측. ⚠ **TS 프로젝트는 TypeScript를 6.0.x로 먼저 고정한다** — typescript-eslint(8.72)가 TS 7을 지원하지 않아(peer `<6.1.0`) 최신 Vite 템플릿·`npm i -D typescript` 그대로면 `ERESOLVE`. 2026-10-19 실측):
    ```bash
    # TS 프로젝트만 — 먼저 실행
    npm i -D typescript@~6.0.3
    # client (JS면 typescript-eslint 제외)
    npm i -D eslint@10 @eslint/js@10 typescript-eslint eslint-plugin-react-hooks eslint-plugin-import-x globals eslint-import-resolver-typescript
    # server (JS면 typescript-eslint 제외)
    npm i -D eslint@10 @eslint/js@10 typescript-eslint eslint-plugin-import-x globals eslint-import-resolver-typescript
    ```
  - **import 규칙은 `eslint-plugin-import-x`** — 원조 `eslint-plugin-import`는 ESLint 10을 지원하지 않고 ESLint 9는 2026-08-06 지원 종료다(2026-10-21 확인). 규칙 이름은 `import-x/no-cycle`.
  - **`eslint-import-resolver-typescript`가 있어야 순환 의존 규칙이 동작한다** — 템플릿의 `settings`(TS 파서·리졸버)가 없던 이전 판은 TS에서 **순환을 하나도 잡지 못했고**(JS는 `@/` 별칭 순환을 놓쳤다), 2026-07-17 검증도 이 규칙은 빠져 있었다. 2026-10-19 수정 후 4종 모두 상대경로·`@/` 별칭 순환 검출, 오탐 없음(실측). 2026-10-21 ESLint 10 + import-x로 바꾼 뒤 4종 × 전 규칙 위반 검출·정상 무오탐 다시 확인(TS는 `import-x/parsers`를 빼면 순환 0건 — 실측).
- **Java/Spring**: Spotless(google-java-format) + Checkstyle을 `check`에 연결, 패키지 순환은 ArchUnit `ArchitectureTest` — 설정은 `~/.claude/jyp/scaffolds/templates/build.gradle`·`checkstyle.xml` (spring.md 7절). ⚠ **`.gitattributes`(`* text=auto eol=lf`)를 반드시 함께 생성**한다 — 없으면 Windows에서 CRLF를 기대해 정상 코드가 `spotlessCheck`에서 실패한다 (2026-07-14 실측).
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

## 운영 정보
<!-- 운영 개시 전에 채운다 — /deploy-check가 <미정>이 남아 있으면 배포 불가로 판정한다. 해당이 없으면 "해당 없음" -->
| 항목 | 값 | 근거 |
|---|---|---|
| 운영 개시일 | <미정> | 정기 점검 기한의 기준 (YYYY-MM-DD) |
| 런타임·DB 버전과 지원 종료일 | <미정> | general.md 8-1절 — 예: Node 26 (2029-04-30) / Java 25 (2031-09-30) / MariaDB 11.4 (2029-05-29). 종료 6개월 전 업그레이드 계획 |
| 운영 서버·DB 식별자 | <미정> | 체크리스트 25, testing.md 6-1절 |
| 가동 감시 — 헬스 URL·감시 주체·연락처 | <미정> | ops.md 7절 |
| 운영 감시 URL·알림 수신자 | <미정> | batch.md 3-1절 — 수신자는 개발팀 |
| 백업 사본 위치·보관 기간 | <미정> | ops.md 6절, 체크리스트 36 |
| 백업 키·시크릿 원본 보관처 | <미정> | ops.md 1·6절 — 백업 사본과 다른 곳 |
| 호스트 OS 관리 주체·패치 주기 | <미정> | ops.md 8절 |
| 보안 패치 덮어쓰기와 사유 | <미정> | ops.md 5-1절 — Spring이면 build.gradle의 덮어쓰기 목록, Node면 "해당 없음" |

## 정기 점검
<!-- 하고 나면 마지막 수행일(YYYY-MM-DD)을 고친다 — /deploy-check·/work-log가 기한 지난 항목을 보고한다.
     기한 = 마지막 수행일(없으면 운영 개시일) + 주기. 해당이 없으면 주기에 "해당 없음" -->
| 점검 | 주기 | 마지막 수행일 | 근거 |
|---|---|---|---|
| 복구 리허설 — 백업 복원 + 배포 모드 기동 확인 | 분기 1회 | <미수행> | ops.md 6절 |
| 의존성 취약점 수동 검사 — 원격 저장소 없는 프로젝트만 | 월 1회 | <미수행> | ops.md 5-1절 |
| 개인정보 접속기록 점검 — 개인정보 처리 시 | <미정> | <미수행> | features/personal-data.md — 주기는 내부 관리계획에서 정한다(고시에 없음) |
| 내부 관리계획 이행 점검·유출 대응 모의훈련 — 개인정보 처리 시 | 연 1회 | <미수행> | features/privacy-breach.md, 안전성 확보조치 기준 제4조④ |

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
# 환경 파일 — .env만 적으면 .env.production·.env.development·.env.local이 커밋된다 (ops.md 1절, 2026-10-21 실측)
.env
.env.*
!.env.example
*.log
```
- Node 표준 gitignore에는 같은 세 줄이 있지만 **Gradle·Java 표준에는 `.env` 규칙이 없다** — Spring 서버·모노레포 루트에서 특히 빠뜨린다.

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
# 테스트 DB (체크리스트 21 — 사용 시). 호스트에서 테스트를 돌리므로 HOST는 127.0.0.1, PORT는 db-test의 노출 포트
TEST_DB_HOST=127.0.0.1
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
# refresh 쿠키 Secure — HTTPS 운영이면 true. HTTP 사내망에서 true면 쿠키가 저장되지 않아 새로고침마다 로그아웃 (features/session-control.md 3-2절)
COOKIE_SECURE=false
# access 토큰(JWT) 서명 키 — 필수. 32바이트 이상 랜덤, 개발·운영 서버는 서로 다른 값 (auth.md 2절). 생성: openssl rand -base64 48
JWT_SECRET=
# 사용자가 접속하는 주소 — 메일 알림 링크 등 (features/notification.md 3-3절, 알림 메일을 보내는 프로젝트만)
APP_BASE_URL=
# 인증 코드 HMAC 키 — 자체 가입·재설정 프로젝트만 (features/account-lifecycle.md 3-4절). 생성: openssl rand -base64 32
TOKEN_HMAC_KEY=
# 2단계 인증 비밀 암호화 키(32바이트 base64) — 2단계 인증 프로젝트만 (features/mfa.md 3-4절). 생성: openssl rand -base64 32. 분실하면 모든 등록이 무효
MFA_ENC_KEY=
# 백업 (배포 모드 — ops.md 6절). 키 생성: openssl rand -base64 32 — 잃으면 백업을 복원할 수 없다. 원본은 패스워드 매니저(ops.md 1절), 백업 사본과 같은 곳에 두지 않는다
BACKUP_DIR=/srv/backup/<프로젝트명>
BACKUP_KEY=
BACKUP_KEEP_DAYS=30
# 백업 파일 소유자 = 배포 계정 (id -u / id -g) — 다른 호스트로 복사하는 계정
BACKUP_UID=1000
BACKUP_GID=1000
# 디스크 사용률 기준(%) — 백업 실행 때 재서 넘으면 DISK_CHECK 실패 → 배치 감시 빨간불 (ops.md 8절)
DISK_ALERT_PCT=85
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
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 26        # LTS — Dockerfile의 node 이미지와 같은 메이저 (general.md 8-1절)
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
      - uses: actions/checkout@v7
      - uses: actions/setup-java@v6
        with:
          distribution: temurin
          java-version: 25        # LTS — build.gradle toolchain·Dockerfile과 같은 버전 (general.md 8-1절)
      - run: chmod +x gradlew
      - run: ./gradlew check --no-daemon      # spotlessCheck + checkstyle + test

  docker:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: docker build -t ci-client-check client/
      - run: docker build -t ci-server-check server/

  # 비밀값 검사 — 이력 전체에서 키·토큰·개인 키를 찾는다 (ops.md 1절). PR·push마다 막는다
  secrets:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0        # 이력 전체 — 기본(1)이면 지운 파일에 남은 비밀값을 못 본다 (실측)
      - run: |
          curl -sSfL https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz | tar -xz -C "$RUNNER_TEMP" gitleaks
          "$RUNNER_TEMP/gitleaks" git --redact --no-banner .   # --redact: CI 로그에 비밀값을 다시 찍지 않는다
```

- 단일 구조 프로젝트는 해당 스택 job 하나 + docker job으로 축소 (`working-directory` 제거, `docker build .`). 서버가 Node면 test-server도 Node job 형태로 하되 **`services:`와 `env:` 블록은 그대로 유지**한다. Node 서버의 워커별 테스트 DB는 root로 만든다 — **`MARIADB_ROOT_PASSWORD`를 `TEST_DB_PASSWORD`와 같게 둔다**(dev compose의 db-test도 같다, testing.md 0절).
- **테스트 DB를 쓰지 않기로 했으면(체크리스트 21-b) `services:`·`env:` 블록을 제거**한다 — 대신 쿼리 목킹으로 테스트한다.
- Python 프로젝트는 `setup-python` + `pip install -e .[dev]` + `pytest`로 대체.
- docker job은 이미지 빌드 성공만 검증한다 — Dockerfile이 깨진 채 배포 시점까지 가는 것을 방지 (push/실행은 하지 않음).
- secrets job은 gitleaks(MIT) 실행 파일을 직접 받는다 — 공식 Action은 조직 계정에서 라이선스 키를 요구한다. 버전을 올릴 때 URL의 두 곳(`v8.30.1`·`8.30.1`)을 함께 바꾼다(`check-versions.mjs`가 앞쪽을 추적). 비공개 저장소는 GitHub의 비밀값 검사가 유료라 이 job이 유일한 자동 검사다.
- **Actions는 메이저 태그로 고정하고, 실행 런타임이 Node 24인 메이저를 쓴다** (2026-10-21 확정). Node 20 런타임 액션(`checkout@v4`·`setup-node@v4`·`setup-java@v4`·`login-action@v3`)은 2026-06-16부터 Node 24로 강제 실행되며 매 실행 경고가 붙고, 러너의 Node 20은 2026-09-23 제거 일정이다(actions/runner `Constants.cs`). 메이저가 바뀌면 Dependabot(아래 dependabot.yml)이 PR로 알린다.

### .github/workflows/release.yml

배포 태그(`v*`) push 시 이미지를 빌드해 ghcr.io로 push한다 — 서버는 pull만 (docker.md 5절 배포 절차의 2단계). **push 전에 취약점 검사(아래 audit.yml)를 통과해야 한다**:

```yaml
name: release
on:
  push:
    tags: ['v*']
jobs:
  audit:
    uses: ./.github/workflows/audit.yml   # high 이상 취약점이 있으면 이미지를 만들지 않는다 (ops.md 5-1절)
  build-push:
    needs: audit
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v7
      - uses: docker/login-action@v4
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

### .github/workflows/audit.yml

운영에 실리는 의존성의 알려진 취약점 검사 — **release가 호출해 high 이상(CVSS 7.0+)이면 배포를 막고, 주 1회 예약 실행으로 배포가 없어도 알린다** (ops.md 5-1절). 정의는 이 파일 하나다:

```yaml
# 의존성 취약점 검사 (ops.md 5-1절) — release.yml이 이미지 push 전에 호출 + 주 1회 예약 + 수동
# PR·push마다 돌리지 않는다 — 결과가 코드가 아니라 새 취약점 공개에 달려 있어, 무관한 PR이 빨개진다
name: audit
on:
  workflow_call:
  workflow_dispatch:
  schedule:
    - cron: '23 0 * * 1'      # 매주 월 09:23 KST — 예약 실행은 기본 브랜치 기준, 실패 알림은 이 cron을 마지막으로 고친 사람에게
jobs:
  audit-client:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: client } }
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 26
      # 운영에 실리는 의존성만(--omit=dev) — 빌드 도구(vite·eslint)의 취약점은 Dependabot 알림으로 받는다
      - run: npm audit --omit=dev --audit-level=high

  audit-server:               # Spring 서버 — Node 서버면 audit-client와 같은 형태로 working-directory만 server
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: server } }
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-java@v6
        with:
          distribution: temurin
          java-version: 25
      # osv-scanner는 build.gradle을 읽지 못한다 — 실제 해석된 운영 의존성(전이 포함)을 잠금 파일로 적어서 넘긴다
      - run: |
          chmod +x gradlew
          ./gradlew -q -I gradle/osv-lock.gradle dependencies --configuration runtimeClasspath --write-locks --no-daemon
      - run: |
          curl -sSfL -o "$RUNNER_TEMP/osv-scanner" https://github.com/google/osv-scanner/releases/download/v2.7.0/osv-scanner_linux_amd64
          chmod +x "$RUNNER_TEMP/osv-scanner"
          rc=0
          "$RUNNER_TEMP/osv-scanner" scan source -L gradle.lockfile --format json > "$RUNNER_TEMP/osv.json" || rc=$?
          [ "$rc" -le 1 ] || exit "$rc"   # 0 없음 · 1 있음 — 그 밖(128 잠금 파일 없음 등)은 도구 오류로 실패
          # osv-scanner에는 등급 기준 옵션이 없다 — 결과의 max_severity(CVSS)로 high 이상만 거른다. 등급 미상은 경고만
          jq -r '.results[]?.packages[]? | .package as $p | .groups[] | [($p.name + "@" + $p.version), (.max_severity // ""), (.ids | join(","))] | @tsv' \
            "$RUNNER_TEMP/osv.json" > "$RUNNER_TEMP/found.tsv"
          awk -F'\t' '$2 == "" { print "::warning::등급 미상 " $1 " " $3 }' "$RUNNER_TEMP/found.tsv"
          awk -F'\t' '$2 != "" && $2 + 0 >= 7.0 { print "::error::" $1 " CVSS " $2 " " $3; bad = 1 } END { exit bad }' "$RUNNER_TEMP/found.tsv"
```

- 단일 구조 프로젝트는 `working-directory`를 지우고 스택에 맞는 job 하나만 남긴다.
- `server/gradle/osv-lock.gradle`은 `~/.claude/jyp/scaffolds/templates/osv-lock.gradle`을 복사한다 — 로컬 검사(ops.md 5-1절)도 같은 파일을 쓴다.
- 실패하면: 고칠 수 있는 버전이 나와 있으면 올린다(Spring은 Boot 관리 버전 덮어쓰기 — `build.gradle` 템플릿의 예), 아직 없으면 영향 여부를 판단해 사유를 CLAUDE.md에 적는다. 막힌 배포를 풀려고 검사를 끄지 않는다.

### .github/dependabot.yml

GitHub 원격 프로젝트에 생성하고, **저장소 Settings의 보안 설정(Dependabot alerts·security updates, Gradle이면 Automatic dependency submission)을 함께 켠다** — 이 파일만으로는 버전 갱신 PR만 온다 (ops.md 5-1절):

```yaml
# 의존성 갱신 PR — 주 1회. 취약점 알림·보안 PR은 저장소 설정에서 켠다 (ops.md 5-1절)
version: 2
updates:
  - package-ecosystem: npm
    directories: ["/client", "/server"]   # Node 서버만 /server — Spring 서버면 ["/client"]
    schedule: { interval: weekly }
    groups:
      minor-patch:                        # 메이저가 아닌 갱신은 PR 하나로 — 패키지마다 PR이 열리면 아무도 안 본다
        update-types: [minor, patch]
  - package-ecosystem: gradle             # Spring 서버만
    directory: /server
    schedule: { interval: weekly }
    groups:
      minor-patch:
        update-types: [minor, patch]
  - package-ecosystem: github-actions     # .github/workflows의 uses: 메이저 갱신
    directory: /
    schedule: { interval: weekly }
  # Docker 이미지는 넣지 않는다 — 태그 고정 + 재빌드로 패치, 메이저 전환은 LTS 정책 결정 (ops.md 5-1절)
```

- 단일 구조 프로젝트는 `directories`를 `["/"]`(또는 `directory: /`)로.
- 메이저 갱신 PR은 하나씩 열린다 — CI가 깨지면(예: TypeScript 메이저가 ESLint 호환 범위 밖) 닫고 사유를 CLAUDE.md에 적는다.

## 주의

- 이미 파일이 있는 폴더에는 생성하지 않는다. 먼저 사용자에게 확인한다.
- 요청받지 않은 예제 코드, 샘플 파일을 만들지 않는다. 빈 구조까지만 (프레임워크 CLI 산출물의 데모 제거는 반대로 필수 — 조정표).
- `docs/REFACTORING_BACKLOG.md`는 스캐폴드 시점에 만들지 않는다 — 첫 개선 항목을 발견하는 시점에 backlog 템플릿(`~/.claude/jyp/templates/backlog.md`)으로 생성한다.
