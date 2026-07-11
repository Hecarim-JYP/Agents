# 새 프로젝트 스캐폴드 (JYP)

사용자가 "새 프로젝트 시작/세팅"을 요청하면 이 문서의 절차대로 생성한다.

## 생성 절차

1. **확인**: 프로젝트명(폴더명), 목적 한 줄과 함께 아래 **시작 결정 체크리스트**를 사용자와 확정한다. 미정 항목은 목적을 듣고 추천한다.
2. **생성**: 아래 기본 구조를 만들고, 언어별 조정표에 따라 변형한다.
3. **초기화**: `git init` 후 첫 커밋 (`chore: 프로젝트 초기 구조 생성`)
4. **보고**: 생성된 구조를 트리로 보여주고, 다음 단계(의존성 설치 등)를 안내한다.

## 시작 결정 체크리스트

컨벤션 곳곳의 "프로젝트 시작 시 결정" 항목을 모은 목록. 확정값은 생성되는 CLAUDE.md의 "프로젝트 참고사항"에 기록한다.

| # | 결정 항목 | 기본값 | 근거 문서 |
|---|---|---|---|
| 1 | 언어/스택 | TypeScript (react-ts / Express TS) | react.md·express.md 0절 |
| 2 | 구조 | 풀스택이면 모노레포(client/+server/) | 아래 모노레포 절 |
| 3 | UI 모드 | 업무 시스템 모드 | design.md 4절 |
| 4 | 다크모드 지원 | 프로젝트별 결정 | design.md 3절 |
| 5 | 브랜드 색 (`:root` 변수) | shadcn 기본 → 프로젝트 색 | design.md 2절 |
| 6 | DB 종류 / 시간대 | MariaDB/MySQL / Asia/Seoul | database.md 1절 |
| 7 | API 응답 봉투 계약 | 단일 봉투 (모든 헬퍼 `data` 키) | express.md 2절 |
| 8 | 테스트 파일 위치 | `tests/` 미러링 | testing.md 4절 |
| 9 | HTTPS 가능 여부 (사내망 제약) | 프록시 자동 HTTPS (Caddy) | docker.md 7절 |
| 10 | GitHub 원격/CI 사용 여부 | 사용 (test.yml 생성) | 아래 CI 절 |

## 기본 구조

```
<프로젝트명>/
├── README.md          # 아래 초기 내용 참조
├── CLAUDE.md          # 아래 초기 내용 참조
├── .gitignore         # 언어에 맞는 표준 gitignore
├── .env.example       # 환경 변수가 필요한 프로젝트만
├── Dockerfile         # 멀티스테이지 빌드 — 규칙: conventions/docker.md
├── .dockerignore      # node_modules, .env*, .git 등
├── docker-compose.yml           # 공통 정의 (+ dev/prod override 파일)
├── .github/
│   └── workflows/
│       └── test.yml   # CI — push/PR마다 테스트 자동 실행 (아래 초기 내용 참조)
├── docs/              # 설계 문서, 결정 기록
│   ├── dev_log/       # 작업 이력 ("작업 정리" 명령이 changelog를 여기에 생성)
│   └── incidents/     # 장애 기록 (운영 프로젝트만 — incident 템플릿)
├── migrations/        # DB 사용 프로젝트만 — 규칙: conventions/migration.md
├── src/               # 소스 코드 (언어별 조정표 참조)
├── tests/             # 테스트 코드 (testing.md — Vitest/pytest, npm test로 실행)
└── scripts/           # 빌드/배포/유틸 스크립트
```

## 풀스택 모노레포 구조 (client + server)

웹 서비스(프론트+백엔드)는 **한 저장소에 client/·server/를 두는 모노레포**를 기본으로 한다:

```
<프로젝트명>/
├── README.md / CLAUDE.md / .gitignore / .env.example
├── docker-compose.yml           # client·server·db 통합 기동 (+ dev/prod override)
├── .github/workflows/test.yml   # client·server 디렉토리별 job 분리
├── docs/                        # 공유 (dev_log/, incidents/, 설계 문서)
├── migrations/                  # DB 마이그레이션 (공유)
├── client/                      # React (react-ts) — 자체 package.json, Dockerfile
└── server/                      # Express TS — 자체 package.json, Dockerfile, src/ 계층 구조
```

- 패키지 관리는 client/·server/ 각자 개별 수행 (루트 package.json 없이 시작 — 필요해지면 워크스페이스 도입).
- Dockerfile은 각 서비스별로, compose가 전체를 조립한다 (docker.md).
- CLAUDE.md·docs·migrations는 루트에서 공유 — "작업 정리"도 저장소 단위 1회.

## 언어별 조정표

| 언어 | 조정 내용 |
|---|---|
| Python | `pyproject.toml` 추가, `src/<패키지명>/` 레이아웃, `src/<패키지명>/__init__.py`. 테스트: **pytest** |
| Node/Express 서버 | **TypeScript 기본** — `package.json`(`"type": "module"`), `tsconfig.json`(`strict: true`), 개발 `tsx watch` / 배포 `tsc` 빌드. JavaScript는 사용자가 명시적으로 요청할 때만. 계층 구조는 `conventions/express.md` 1절. 테스트: **Vitest + supertest**, `npm test` 스크립트 등록 |
| React/Next.js | **TypeScript 기본** — Vite는 `react-ts` 템플릿, Next.js는 `create-next-app --typescript`. `tsconfig.json`은 `strict: true` 고정. JavaScript(JSX)는 사용자가 명시적으로 요청할 때만. 프레임워크 CLI 산출물 위에 CLAUDE.md와 docs/만 추가. 스타일링: **Tailwind CSS + shadcn/ui** 셋업(`conventions/design.md` — UI 모드와 다크모드 지원 여부를 사용자에게 확인해 CLAUDE.md에 기록). 테스트: **Vitest + Testing Library**, `npm test` 스크립트 등록 |
| 기타 | 해당 언어 커뮤니티의 표준 레이아웃을 조사해서 따르고, CLAUDE.md/docs/는 항상 추가. 테스트 도구는 해당 언어 표준 채택 |

## 초기 파일 내용

### README.md
```markdown
# <프로젝트명>

<목적 한 줄>

## 시작하기
<!-- 설치 및 실행 방법 — 구현되는 대로 채운다 -->

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
<!-- 이 프로젝트만의 규칙, 주의점을 여기에 추가 -->

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

### .github/workflows/test.yml
GitHub 원격 저장소를 쓰는 프로젝트에 생성 (사내 전용/무원격이면 생략하고 사용자에게 고지):

```yaml
name: test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm test
  docker:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: docker build -t ci-build-check .
```

- Python 프로젝트는 `setup-python` + `pip install -e .[dev]` + `pytest`로 대체.
- 모노레포(client/server 분리)는 test·docker 모두 디렉토리별 job으로 분리 (`working-directory` / `docker build client/` 등).
- docker job은 이미지 빌드 성공만 검증한다 — Dockerfile이 깨진 채 배포 시점까지 가는 것을 방지 (push/실행은 하지 않음).

## 주의

- 이미 파일이 있는 폴더에는 생성하지 않는다. 먼저 사용자에게 확인한다.
- 요청받지 않은 예제 코드, 샘플 파일을 만들지 않는다. 빈 구조까지만.
- `docs/REFACTORING_BACKLOG.md`는 스캐폴드 시점에 만들지 않는다 — 첫 개선 항목을 발견하는 시점에 backlog 템플릿(`~/.claude/jyp/templates/backlog.md`)으로 생성한다.
