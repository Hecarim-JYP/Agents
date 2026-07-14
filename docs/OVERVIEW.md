# JYP Agents 전체 기능 통합 가이드

> 최종 수정: 2026-07-13 | 버전: 1.1 | 대상 독자: 이 저장소를 처음 보는 개발자, 그리고 전체 구조를 한눈에 복기하려는 관리자(박진영)

## 1. 개요

이 저장소는 **Claude Code를 "일관된 방식으로 일하는 개발 조직"처럼 만들기 위한 자산 모음**이다. 에이전트 페르소나, 작업 규칙, 코딩 컨벤션, 표준 DB 스키마, 문서 템플릿, 슬래시 커맨드(스킬), 자동 검증 훅을 하나의 git 저장소에서 버전 관리하고, `install.ps1`/`install.sh` 한 번으로 `~/.claude`에 설치한다. 설치 후에는 **어느 폴더에서 Claude Code를 열어도** 동일한 규칙·절차·품질로 작업이 수행된다.

핵심 설계 철학 세 가지:

1. **SSOT(단일 출처) 계층 구조** — 규칙은 한 곳에만 존재한다. 에이전트 정의는 규칙 파일을 가리키기만 하고, 규칙 파일은 컨벤션·스킬을 가리키기만 한다. 같은 내용을 두 곳에 쓰면 반드시 어긋나므로(드리프트), 요약·중복 기재를 금지한다.
2. **설치 경로 기준 참조** — 모든 내부 참조는 저장소 클론 위치가 아니라 설치 경로(`~/.claude/jyp/` 등) 기준이다. 다른 기기에서도 클론 → 설치 스크립트 실행만 하면 동일하게 동작한다.
3. **규칙에는 근거를 병기** — 모든 STRICT 규칙에는 "어떤 버그·사고에서 나온 규칙인지"를 함께 적는다. 근거 없는 규칙은 지켜지지 않는다.

## 2. 빠른 시작

```powershell
git clone https://github.com/<계정>/jyp-agents.git
cd jyp-agents
.\install.ps1        # Windows
./install.sh         # Mac/Linux
```

설치 후 Claude Code에서 바로 사용:

```
dev-claude로 로그인 기능 구현해줘        # 개발 페르소나 호출
doc-claude로 주간 보고서 써줘            # 문서 페르소나 호출
/new-project                             # 새 프로젝트 세팅
/work-log                                # 작업 정리
/deploy-check                            # 배포 준비 점검
/paper-test                              # 통합 테스트 (정적 추적)
```

특정 프로젝트에 규칙을 상시 적용하려면 그 프로젝트의 `CLAUDE.md`에 한 줄 추가:

```markdown
@~/.claude/jyp/rules/dev-rules.md
```

## 3. 구조

### 3-1. 저장소 구조

```
Agents/
├── agents/            # 페르소나 2종 (dev-claude, doc-claude)
├── rules/             # 작업 규칙 2종 — 페르소나와 프로젝트 CLAUDE.md가 참조하는 SSOT
├── conventions/       # 코딩 컨벤션 17종 (범용 → 스택별 → 운영까지)
├── skills/            # 슬래시 커맨드 4종 (new-project, work-log, deploy-check, paper-test)
├── profiles/          # 프로젝트 생성 프리셋 (project-default.md — 결정 항목의 기본 답안)
├── scaffolds/         # 새 프로젝트 초기 구조 스펙 (default.md + templates/ 실물 파일)
├── schemas/           # DB 기초 테이블 표준 DDL 7종
├── templates/         # 문서 템플릿 8종 (doc-claude용 6 + 개발용 2)
├── hooks/             # 자동 검증 훅 스크립트 2종 (post-edit-check, stop-test)
├── docs/              # 저장소 자체 문서 (이 파일)
├── install.ps1        # Windows 설치 스크립트
├── install.sh         # Mac/Linux 설치 스크립트
└── README.md
```

### 3-2. 설치 경로 매핑

| 저장소 경로 | 설치 위치 | 소비 주체 |
|---|---|---|
| `agents/*.md` | `~/.claude/agents/` | Claude Code 서브에이전트 시스템 |
| `rules/`, `conventions/`, `scaffolds/`, `schemas/`, `templates/`, `profiles/` | `~/.claude/jyp/{각 폴더}/` | 규칙·컨벤션 참조 (`@` import 및 작업 중 읽기) |
| `skills/*/` | `~/.claude/skills/` | 슬래시 커맨드 |
| `hooks/*.mjs` | `~/.claude/hooks/` | settings.json의 훅 설정이 실행 |

설치 스크립트는 `~/.claude/jyp/`를 비우고 새로 복사하므로(삭제·이름변경 파일 잔존 방지), 저장소 수정 → 재설치 → 커밋이 표준 관리 사이클이다. 스킬과 훅은 **이 저장소의 것만 교체**하고 사용자의 다른 스킬·훅은 보존한다.

### 3-3. SSOT 참조 계층

```
프로젝트 CLAUDE.md ──@import──> rules/dev-rules.md ──참조──> conventions/*.md  (작업 유형별로 읽음)
agents/dev-claude.md ──"읽어라"──┘                └──참조──> skills/*/SKILL.md (명령 절차)
skills/new-project ──"SSOT는 여기"──> scaffolds/default.md ──"기본 답안"──> profiles/project-default.md
                                              └──"복사해서 시작"──> scaffolds/templates/*
conventions/database.md ──"복사해서 시작"──> schemas/*.sql
conventions/*.md ──"도구로 강제"──> scaffolds/templates/eslint.config.* (CI·훅이 실행)
```

- `dev-claude.md`는 규칙을 한 줄도 직접 담지 않는다 — `dev-rules.md`를 읽으라는 지시만 있다.
- `dev-rules.md`는 컨벤션의 핵심만 한 줄씩 요약·링크하고, 세부는 각 컨벤션 파일이 담는다.
- `new-project` 스킬은 절차를 요약하지 않는다 — `scaffolds/default.md`만 갱신하면 되도록 드리프트를 차단한다.
- **이 문서(OVERVIEW)도 컨벤션 내용을 요약하지 않는다** (2026-07-14) — 인덱스와 링크만 둔다. 요약본을 두 곳에 두면 반드시 어긋난다.
- 프로젝트에 CLAUDE.md가 있으면 **그 프로젝트 고유 규칙이 공통 규칙보다 우선**한다.

## 4. 상세 설명

### 4-1. 에이전트 (페르소나 2종)

#### dev-claude — 개발 전담

새 프로젝트 세팅, 기능 구현, 버그 수정, 리팩토링 등 **코드를 작성·수정하는 모든 작업**에 사용한다. 정의 파일은 14줄뿐이며, 실질 내용은 "작업 시작 전 `~/.claude/jyp/rules/dev-rules.md`를 읽고 전체를 따르라"는 SSOT 지시다. 컨벤션과 스킬은 해당 작업 유형에 착수하는 시점에 읽는다(예: SQL 작성 전 `sql.md`).

#### doc-claude — 문서 전담

업무 보고서, 기술 문서, 기획/제안서, 자료 요약·정리에 사용한다. 핵심 규칙:

- **템플릿 필수**: 문서 종류에 맞는 템플릿(`~/.claude/jyp/templates/`)의 구조를 따른다. 섹션을 임의로 생략·순서 변경 금지 — 쓸 내용이 없으면 "해당 없음" 표기.
- **두괄식**: 핵심 결론이 항상 맨 위. 첫 문단만 읽어도 전체 파악 가능해야 한다.
- **근거 표기**: 요약·정리 시 출처(파일명, URL, 페이지) 필수. 원문에 없는 해석은 `[추정]` 표시.
- **수치 우선**: "많이 개선" 대신 "30% 단축". 수치가 없으면 없다고 쓴다.
- 파일명: `YYYY-MM-DD_문서제목.md`.

### 4-2. 규칙 (rules 2종)

#### dev-rules.md — 개발 작업 규칙 (개발 규칙의 SSOT)

dev-claude가 읽고, 프로젝트 CLAUDE.md가 `@`로 import하는 파일. 주요 내용:

- **소통**: 설명은 한국어, 결론부터 보고 (무엇을 했는지 → 왜 → 다음 할 일).
- **작업 절차** (2026-07-13 강화 — 신중함 > 속도, 간단한 작업은 판단력 발휘): 요구사항 정리 + **추측 금지**(가정 명시, 여러 해석이면 모두 제시, 모호하면 질문) → 접근 방법 공유(더 간단한 접근이 있으면 반대 의견, 다단계는 `단계 → 검증` 계획 명시) → 기존 스타일 준수(요구하지 않은 리팩토링 금지) → **검증 가능한 목표로 변환해 통과까지 반복**("버그 수정" = 재현 테스트 통과, 검증 못 했으면 "검증 안 됨" 명시) → 변경 파일·핵심 변경·검증 결과 보고.
- **단순성과 수정 범위**(STRICT, 2026-07-13 추가): 문제를 해결하는 최소한의 코드만(요청 이상 기능·일회용 추상화·요청 없는 유연성·불가능 시나리오 에러 처리 금지), "선임 엔지니어 테스트"(복잡하면 간소화, 200줄→50줄 가능하면 재작성), 수정은 외과적으로(모든 변경은 요청과 직결, 인접 코드 "개선" 금지), 내 변경이 만든 미사용 요소만 제거(기존 미사용 코드는 언급만). ⚠ **이 규칙은 "되돌리기 쉬운 결정"에만 적용**(patterns.md 0절 — 스키마·계약·경계는 반대로 시작 시 확장 여지 확보).
- **컨벤션 라우팅**: 작업 유형별로 어떤 컨벤션 파일을 적용할지 매핑 (범용 general → 구조 patterns → 스택별 sql/database/express/react → 운영 testing/ops/migration/docker/auth/api/design).
- **코드**: 새 의존성 사전 보고, 파일 헤더 주석(작성자 `[박진영]` 고정), doc comment(`@param`) 필수, 에러 처리 필수, 하드코딩 금지.
- **Git**: 커밋 메시지 `타입: 한글 요약`(feat/fix/refactor/docs/chore/test), 커밋 하나 = 논리적 변경 하나, main = 항상 배포 가능, 요청 없이 push 금지.
- **명령 라우팅**: "작업 정리"·"배포 준비"·"통합 테스트"·"새 프로젝트 세팅" 요청 시 해당 스킬 파일을 읽고 그 절차를 그대로 수행 (절차 중복 정의 금지).
- **CLAUDE.md 운영**: Critical Pitfalls는 번호 레지스트리(번호 재사용 금지), 규칙에 STRICT/MANDATORY 마커 + 확정 날짜 + ✅/❌ 예시 + 근거 병기.
- **분석·검증 안전**: 모든 주장에 `파일:라인` 근거, 분석 서브에이전트는 읽기 전용, 발견은 ①확인된 버그 ②의심 ③정상 확인 3분류.
- **금지**: 검증 없이 "완료" 보고, 실패 테스트 은폐, 무단 파일 삭제·강제 push.

#### doc-rules.md — 문서 작업 규칙

doc-claude 규칙의 프로젝트 import용 축약판 — 템플릿 준수, 추측 금지(모호하면 질문, 복수 해석은 병기 — 2026-07-13 추가), 두괄식, 근거 표기, 수치 우선, 금지사항.

### 4-3. 스킬 (슬래시 커맨드 4종)

자연어("작업 정리해줘")와 슬래시 커맨드(`/work-log`)가 동일하게 동작하는 정식 명령. 절차의 SSOT는 각 SKILL.md다.

#### /new-project — 새 프로젝트 세팅

절차의 SSOT는 `scaffolds/default.md`(4-5절 참조)이며 스킬 파일은 그리로 위임만 한다. 핵심 주의: 이미 파일이 있는 폴더에는 생성 전 사용자 확인, 요청받지 않은 샘플 코드 생성 금지.

#### /work-log — 작업 정리

작업 단위 = **현재 브랜치의 커밋되지 않은 변경 전체**(`git status` + `git diff HEAD`, untracked 포함). "이번 세션에서 건드린 파일"만 정리하는 것 금지. 5단계:

1. **changelog 작성/갱신** — `docs/dev_log/YYYY-MM-DD_CHANGELOG.md` (템플릿: `templates/changelog.md`, 같은 날짜 파일은 누적/갱신)
2. **memory 최신화** — 확정된 사용자 선호·프로젝트 사실만 (코드/git으로 알 수 있는 내용은 저장 안 함)
3. **CLAUDE.md 갱신** — 새 컨벤션·Pitfall·아키텍처 변경 반영
4. **백로그 동기화** — **발견 ≠ 완료 (STRICT)**: `git diff` 근거가 있는 것만 `☑`, 일부 처리는 `◐`, 신규 발견은 항목 추가
5. **요약 보고** — 커밋/푸시는 명시적 요청 시에만

#### /deploy-check — 배포 준비

9항목 체크리스트를 순서대로 수행하고 ✅/❌/– 표로 보고. **실패 항목이 있으면 배포 불가 판정.** 실제 배포는 사용자 승인 후에만.

1. 테스트 전체 실행 (실패 시 즉시 중단)
2. 프로덕션 빌드 + Docker 이미지 빌드 (태그 = 배포 태그 일치 확인)
3. `npm audit` — high 이상 취약점
4. 미적용 마이그레이션·순서·멱등성 확인
5. 신규 환경변수의 `.env.example`·운영 반영 대조
6. 보안 체크리스트 (ops.md 5절 — 첫 배포는 전 항목, 이후는 변경 영역만)
7. changelog 최신 여부 (아니면 /work-log 먼저 제안)
8. main 병합 상태 + 배포 태그 제안
9. 서버 디스크·이미지 정리 상태 (ops.md 8절 — 접근 불가 시 "–" + 배포 시 확인 안내)

#### /paper-test — 통합 테스트 (정적 추적)

앱을 실행하지 않고 **코드를 읽어** 계층 간 계약을 검증한다(paper execution). 검증 대상마다 구체적 가상 시나리오(입력값·권한·상태)를 세우고 화면 → API → 컨트롤러 → 서비스 → 쿼리 → DB → 응답까지 따라간다. 절차: 인벤토리 구축(사용자 확인) → CLAUDE.md 규칙을 계약 체크리스트로 → **읽기 전용 에이전트 fan-out**(수정 금지) → 라운드 분할 → 백로그 반영. 출력은 ①확인된 버그 ②의심 ③정상 확인 3분류 + 근거(`파일:라인`) 필수. 런타임·실DB·동시성은 검증 불가함을 반드시 고지.

### 4-4. 컨벤션 (17종)

**각 컨벤션의 내용을 여기에 요약하지 않는다 (2026-07-14 확정)** — 요약을 두면 원문과 어긋나는 드리프트가 반드시 생긴다(실제로 "보안 체크리스트 9항목" 같은 불일치가 발생했다). 이 절은 **무엇이 어디 있는지를 찾는 인덱스**이고, 내용의 단일 출처는 각 파일이다.

적용 순서는 계층적이다: **범용 → 구조 → 스택별 → 횡단 → 운영**. 기존 코드베이스 스타일·언어 커뮤니티 표준이 항상 우선한다.

| 층 | 파일 | 무엇을 정하는가 |
|---|---|---|
| 범용 | [general.md](../conventions/general.md) | 네이밍·함수/파일 크기·폴더 구조·에러 처리·주석(파일 헤더 `[박진영]`)·의존성. 메타 규칙: **도구로 강제 가능한 규칙은 도구로** |
| 구조 | [patterns.md](../conventions/patterns.md) | **0절 설계 우선순위**(되돌리기 비용으로 확장성↔단순성 조정, 다중 인스턴스 가정) · 계층 분리 · 책임 배치 · 응답/에러 계약 · 신뢰 경계 · 상태 변경(조건부 갱신) · 공용화 3회 규칙 |
| 스택 | [sql.md](../conventions/sql.md) | SQL 스타일 · 소프트삭제 · 쿼리 함수 · 안전 규칙 · **8절 동시성 제어**(낙관적 락·조건부 UPDATE·FOR UPDATE) |
| 스택 | [database.md](../conventions/database.md) | 스키마 표준(PK·공통 컬럼·`version`·타입·인덱스) · **논리 FK**(제약 미선언) · DDL 규칙 · 멀티테넌트 · 타 DB 매핑 |
| 스택 | [express.md](../conventions/express.md) | Express/Node 계층·asyncHandler·zod 경계 검증·트랜잭션(서비스 소유)·신뢰값 주입·파일 업로드 |
| 스택 | [spring.md](../conventions/spring.md) | Spring Boot 계층·Bean Validation·`@RestControllerAdvice`·`@Transactional` 함정·Flyway(기동 시 자동 실행 끄기)·Spotless/Checkstyle |
| 스택 | [react.md](../conventions/react.md) | React 구조·네이밍·권한 게이트·API 호출(try/catch)·목록 화면·공용 API 클라이언트(`baseURL='/api'`)·라우팅 가드 |
| 스택 | [design.md](../conventions/design.md) | Tailwind + shadcn/ui · 시맨틱 토큰(hex 금지) · 다크모드 · 업무/서비스 UI 모드 · 접근성 · **8절 셋업 레시피** |
| 횡단 | [api.md](../conventions/api.md) | REST 설계 · `/api` 프리픽스 · 상태코드(201·409) · 페이징 · **snake_case 필드 = 컬럼명(계약)** · **5절 응답 봉투 계약** |
| 횡단 | [auth.md](../conventions/auth.md) | **0절 인증 소스**(자체/사내 위임/SSO) · 비밀번호 · 토큰(메모리+httpOnly) · RBAC + 데이터 스코프 3종 · 감사 · 스택 매핑 |
| 횡단 | [integration.md](../conventions/integration.md) | 사내·외부 API 연동 — BFF(프론트 직접 호출 금지) · `external/` 계층 · 타임아웃 5초 · 쓰기 재시도 금지 · `/health` 격리 |
| 횡단 | [i18n.md](../conventions/i18n.md) | 다국어 — 문구 키 강제 · fallback 사슬 · `_i18n` 번역 테이블 · `Intl` 포맷 |
| 횡단 | [testing.md](../conventions/testing.md) | **0절 테스트 DB 결정** · 테스트 우선순위 · 도구 표준 · **게이트+기록**(미작성이면 보고·changelog·백로그) |
| 운영 | [migration.md](../conventions/migration.md) | 번호·멱등성·DDL/DML 분리 · 2단계 배포(API 계약 파괴 포함) · **러너 원칙/도구**(Node 커스텀·JVM Flyway) |
| 운영 | [docker.md](../conventions/docker.md) | Dockerfile(스택별) · 설정 주입 · **compose 모드 2개·명령 1개** · DB 위치·접속 매트릭스 · 태깅/롤백/CD · 프록시 · **7-2절 한 호스트 공존** |
| 운영 | [ops.md](../conventions/ops.md) | 환경 분리·시크릿 · 배포 원칙 · 로깅 · 장애 대응 · **보안 체크리스트** · 백업/복구 리허설 · 모니터링 · 호스트 관리 |
| 운영 | [batch.md](../conventions/batch.md) | 정기 배치 — **구현 전 방식 확정(MANDATORY)** · 실행 방식 3택 · 멱등 작성 · 실행 이력 + 실패 알림 필수 |

- **강제 수준 마커**: STRICT(위반 금지) / MANDATORY(필수 적용)가 붙은 규칙은 근거(어떤 버그에서 나왔는지)와 확정 날짜를 함께 담고 있다.
- **도구로 강제되는 규칙**은 스캐폴드의 린트 설정(`scaffolds/templates/eslint.config.*.mjs`, Spotless/Checkstyle)이 CI·훅에서 검사한다 — 문서를 다 읽지 않아도 위반이 빨간불로 드러난다.
### 4-5. 스캐폴드 (scaffolds/ + profiles/)

`/new-project`의 절차 SSOT. 세 층으로 구성된다 — 내용은 각 파일이 단일 출처다.

| 구성 | 역할 |
|---|---|
| [profiles/project-default.md](../profiles/project-default.md) | **사내 표준 프로필** — 결정 항목의 기본 답안. 매번 묻는 것은 **[확인] 4개**(프로젝트명·목적 / 인증 소스 / 사내 API 연동 / 특수 요구)뿐이고 나머지는 [고정]으로 적용한다. 프로젝트마다 같은 예외를 반복하면 프로필을 고친다 |
| [scaffolds/default.md](../scaffolds/default.md) | 절차(확인 → 생성 → `.env` 자동 생성 → git init → 보고) · **시작 결정 체크리스트 23항목**(프로필의 근거이자 미적용 시 전체 목록) · 기본/모노레포 구조 · 기초 테이블 · 스택별 조정표 · **린트 강제** · 초기 파일 전문(README·CLAUDE.md·.env.example·test.yml·release.yml) |
| [scaffolds/templates/](../scaffolds/templates/) | **실물 파일 템플릿** — docker-compose 3종(base/dev/deploy) · Caddyfile · nginx.conf · ESLint 설정 2종. docker.md 규칙(`${VAR:?}` 폴백 금지 · base 최소 · migrate/batch는 `profiles: tools`)이 이미 반영돼 있어 즉흥 작성을 금지한다. 검증: `scripts/verify-templates.ps1` (임시 폴더에 조립 후 두 모드의 `docker compose config` 실행 — 2026-07-14 통과) |

- 주의: 파일 있는 폴더에 생성 금지, 요청 없는 샘플 코드 금지(단, CLI 데모 잔재 제거는 필수), 백로그는 첫 발견 시점에 생성.

### 4-6. 표준 스키마 (schemas/ 7종)

database.md 규칙(PK 네이밍, 공통 컬럼, 논리 FK + 인덱스, utf8mb4)의 **살아있는 레퍼런스**이자, 새 프로젝트의 첫 마이그레이션 원본.

| 파일 | 테이블 | 역할 |
|---|---|---|
| `00_schema_migrations.sql` | schema_migrations | `npm run migrate` 러너의 적용 기록 (Node 전용 — JVM은 Flyway 자체 테이블) |
| `01_auth.sql` | role, permission, role_permission, user, login_history | RBAC 표준 구현 (auth.md 4절). 자체 로그인 기준 — 위임·SSO면 user 조정(auth.md 0절) |
| `02_common_code.sql` | common_code_group, common_code | 상태값·구분값을 데이터로 관리 — 매직 넘버 금지의 표준 구현 |
| `03_files.sql` | files | 원본/저장 파일명 분리(경로 트래버설 차단), 파일-메타 쌍 보장 |
| `04_audit_log.sql` | audit_log | 권한 변경 등 책임 추적 행위 기록 |
| `05_company.sql` | company | 멀티테넌트(다중 법인) 기준 테이블 — 멀티테넌트 프로젝트만 복사 (database.md 3절) |
| `06_batch_history.sql` | batch_history | 배치 실행 이력 — 정기 배치가 있는 프로젝트만 복사 (batch.md 3절) |

### 4-7. 템플릿 (templates/ 8종)

**doc-claude용 6종**: `report.md`(업무 보고 — 핵심 요약/진행 현황 표/완료/진행/이슈/계획/요청), `tech-doc.md`(기술 문서 — 개요/빠른 시작/구조/상세/설정/문제해결/참고), `proposal.md`(기획·제안 — 한 줄 요약/배경/제안/기대 효과/실행 계획/리스크/의사결정 요청), `summary.md`(자료 정리 — 핵심 요약/주요 내용+원문 위치/시사점/비교/출처), `incident.md`(장애 기록 — 요약/영향/타임라인/원인/조치/재발 방지/교훈), `handover.md`(인수인계 — 시스템 개요/구성·접속/배포/정기 작업/자주 발생 문제/미해결/문서 위치).

**개발용 2종**:
- `changelog.md` — /work-log가 생성하는 변경 이력 형식. 기존→변경 서술 + 변경 파일 목록 + 맨 끝 커밋 코멘트 블록.
- `backlog.md` — `docs/REFACTORING_BACKLOG.md`의 형식. ID 체계(SEC/BE/FE/DB/TEST/OPS/DEAD), 필수 필드(심각도·작업량·상태·근거·문제·제안), **발견 ≠ 완료(STRICT)** 규칙, 상태 범례(☐/◐/☑/⊘), P0 요약표, 오탐·문서 불일치 부록.

### 4-8. 훅 (hooks/ 2종)

`~/.claude/settings.json`에 등록되어 **규칙을 "기대"에서 "강제"로** 바꾸는 자동 검증 계층. Node 스크립트이며, 지원 스택이 아니면 조용히 통과한다.

| 파일 | 이벤트 | 동작 |
|---|---|---|
| `post-edit-check.mjs` | PostToolUse (Write\|Edit) | 코드 수정 직후 프로젝트 루트를 찾아(모노레포 대응) 검사 실행 — **Node**: `lint`·`typecheck` 스크립트 / **JVM**(2026-07-14 추가): `spotlessCheck`·`compileJava`. 실패 시 exit 2로 Claude에게 피드백 |
| `stop-test.mjs` | Stop | 턴 종료 시 테스트 실행 — Node `npm test` / JVM `./gradlew test`. 실패하면 턴 종료를 막는다 |

설계 포인트: post-edit 훅이 임시 마커 파일(세션 ID 기준)을 남기고 stop 훅이 소진하는 방식이라 **코드를 수정한 턴에만 테스트가 실행**된다(질문만 한 턴에는 안 돌아감). `stop_hook_active` 확인으로 무한 루프를 방지한다.

⚠ 훅은 프로젝트에 `lint` 스크립트(또는 Spotless 설정)가 **있어야** 의미가 있다 — 스캐폴드가 린트 설정을 반드시 포함하는 이유다(scaffolds/default.md 린트 절).

**등록은 install이 자동으로 한다** (2026-07-14 — `scripts/register-hooks.mjs`): `~/.claude/settings.json`에 우리 훅 항목만 병합하며, 사용자의 다른 설정·다른 훅은 보존하고, 재실행해도 중복되지 않는다(스크립트 파일명으로 식별해 갱신). 파일이 깨진 JSON이면 **덮어쓰지 않고 중단**한다 — 다른 설정이 사라지는 것을 막기 위함. Node가 없으면 등록을 건너뛰고 안내한다(훅 자체가 Node로 실행되므로).

### 4-9. 문서 생태계 (프로젝트마다 생성되는 3층 구조)

이 저장소의 규칙이 각 프로젝트에 만들어내는 문서 체계:

| 문서 | 역할 | 관리 규칙 |
|---|---|---|
| `CLAUDE.md` | 헌법 — 프로젝트 고유 규칙, 다중화 전환 목록, Critical Pitfalls | Pitfalls는 번호 레지스트리(재사용 금지), STRICT 마커 + 날짜 + 예시 + 근거, 비대해지면 위성 분리. 단일 인스턴스 의존 항목은 "다중화 전환 목록"에 즉시 기록(patterns.md 0-3절) |
| `docs/dev_log/YYYY-MM-DD_CHANGELOG.md` | 작업 이력 | /work-log가 생성·누적, changelog 템플릿 |
| `docs/REFACTORING_BACKLOG.md` | 개선 과제 SSOT | 발견 즉시 추가, 발견 ≠ 완료(STRICT), backlog 템플릿 |
| `docs/incidents/YYYY-MM-DD_요약.md` | 장애 기록 (운영 프로젝트) | incident 템플릿, 백로그와 상호 링크 |

## 5. 설정

| 항목 | 값 | 위치 |
|---|---|---|
| 페르소나 설치 경로 | `~/.claude/agents/` | install 스크립트 |
| 규칙·컨벤션·스키마·템플릿·스캐폴드·프로필 | `~/.claude/jyp/{폴더}/` | install 스크립트 (하위 폴더까지 재귀 복사) |
| 스킬 | `~/.claude/skills/{스킬명}/` | install 스크립트 (저장소 스킬만 교체) |
| 훅 스크립트 | `~/.claude/hooks/*.mjs` | install 스크립트 (mjs만 복사) |
| 훅 등록 | `hooks.PostToolUse` / `hooks.Stop` | **install 스크립트가 자동 등록**(2026-07-14) — `scripts/register-hooks.mjs`가 `~/.claude/settings.json`에 우리 훅 항목만 병합한다. 다른 설정·사용자의 다른 훅은 보존, 재실행해도 중복되지 않음(멱등), 파일이 깨진 JSON이면 덮어쓰지 않고 중단 |

## 6. 문제 해결 (Troubleshooting)

- **수정한 규칙이 반영 안 됨** → 저장소 수정 후 `install.ps1` 재실행을 잊은 경우가 대부분. 설치 경로(`~/.claude/jyp/`)가 소비 지점이다.
- **훅이 발화하지 않음** → install 실행 시 "훅 등록 완료" 메시지가 나왔는지 확인(안 나왔으면 Node 미설치이거나 settings.json이 깨진 JSON이다). `/hooks` 메뉴에서 등록 상태 확인, `node --version` 동작 확인.
- **훅이 거슬림(대형 프로젝트에서 lint가 느림)** → `/hooks`에서 일시 비활성화하거나, `post-edit-check.mjs`를 파일 단위 lint로 튜닝.
- **스킬이 목록에 없음** → `~/.claude/skills/{이름}/SKILL.md` 존재 확인, frontmatter의 `name`/`description` 확인.

## 7. 참고 자료

- `README.md` — 설치·사용법 요약 (이 문서의 축약판)
- `rules/dev-rules.md` — 개발 규칙 SSOT (컨벤션 라우팅의 진입점)
- `profiles/project-default.md` — 프로젝트 생성 시 결정 항목의 기본 답안
- `scaffolds/default.md` — 새 프로젝트 절차 SSOT
- `conventions/database.md` 8절 — 타 DB 채택 시 치환 매핑
- `templates/backlog.md` 운영 규칙 — "발견 ≠ 완료" 원칙의 원문
