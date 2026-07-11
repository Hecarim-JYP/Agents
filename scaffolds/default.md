# 새 프로젝트 스캐폴드 (JYP)

사용자가 "새 프로젝트 시작/세팅"을 요청하면 이 문서의 절차대로 생성한다.

## 생성 절차

1. **확인**: 프로젝트명(폴더명), 목적 한 줄, 사용 언어를 확인한다. 언어가 미정이면 목적을 듣고 추천한다.
2. **생성**: 아래 기본 구조를 만들고, 언어별 조정표에 따라 변형한다.
3. **초기화**: `git init` 후 첫 커밋 (`chore: 프로젝트 초기 구조 생성`)
4. **보고**: 생성된 구조를 트리로 보여주고, 다음 단계(의존성 설치 등)를 안내한다.

## 기본 구조

```
<프로젝트명>/
├── README.md          # 아래 초기 내용 참조
├── CLAUDE.md          # 아래 초기 내용 참조
├── .gitignore         # 언어에 맞는 표준 gitignore
├── .env.example       # 환경 변수가 필요한 프로젝트만
├── .github/
│   └── workflows/
│       └── test.yml   # CI — push/PR마다 테스트 자동 실행 (아래 초기 내용 참조)
├── docs/              # 설계 문서, 결정 기록
│   └── dev_log/       # 작업 이력 ("작업 정리" 명령이 changelog를 여기에 생성)
├── src/               # 소스 코드 (언어별 조정표 참조)
├── tests/             # 테스트 코드 (testing.md — Vitest/pytest, npm test로 실행)
└── scripts/           # 빌드/배포/유틸 스크립트
```

## 언어별 조정표

| 언어 | 조정 내용 |
|---|---|
| Python | `pyproject.toml` 추가, `src/<패키지명>/` 레이아웃, `src/<패키지명>/__init__.py`. 테스트: **pytest** |
| Node/Express 서버 | **TypeScript 기본** — `package.json`(`"type": "module"`), `tsconfig.json`(`strict: true`), 개발 `tsx watch` / 배포 `tsc` 빌드. JavaScript는 사용자가 명시적으로 요청할 때만. 계층 구조는 `conventions/express.md` 1절. 테스트: **Vitest + supertest**, `npm test` 스크립트 등록 |
| React/Next.js | **TypeScript 기본** — Vite는 `react-ts` 템플릿, Next.js는 `create-next-app --typescript`. `tsconfig.json`은 `strict: true` 고정. JavaScript(JSX)는 사용자가 명시적으로 요청할 때만. 프레임워크 CLI 산출물 위에 CLAUDE.md와 docs/만 추가. 테스트: **Vitest + Testing Library**, `npm test` 스크립트 등록 |
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
```

- Python 프로젝트는 `setup-python` + `pip install -e .[dev]` + `pytest`로 대체.
- 모노레포(client/server 분리)는 디렉토리별 job으로 분리.

## 주의

- 이미 파일이 있는 폴더에는 생성하지 않는다. 먼저 사용자에게 확인한다.
- 요청받지 않은 예제 코드, 샘플 파일을 만들지 않는다. 빈 구조까지만.
- `docs/REFACTORING_BACKLOG.md`는 스캐폴드 시점에 만들지 않는다 — 첫 개선 항목을 발견하는 시점에 backlog 템플릿(`~/.claude/jyp/templates/backlog.md`)으로 생성한다.
