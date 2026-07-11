# JYP Agents

Claude Code에서 사용하는 나만의 맞춤형 에이전트(페르소나) 모음.
템플릿과 규칙을 이 저장소에서 버전 관리하고, 어느 프로젝트에서든 동일한 방식으로 일하게 한다.

## 구성

| 경로 | 내용 |
|---|---|
| `agents/dev-claude.md` | 개발용 페르소나 — 기능 구현, 버그 수정, 프로젝트 세팅 |
| `agents/doc-claude.md` | 문서용 페르소나 — 업무 보고서, 기술 문서, 기획/제안서, 자료 요약 |
| `templates/` | 문서 템플릿 6종(doc-claude — 보고서·기술문서·기획서·요약·장애기록·인수인계) + 개발 템플릿 2종(changelog, backlog) |
| `conventions/` | 코딩 컨벤션 — general(범용), patterns(구현 패턴), sql, express, react, testing, migration(DB 변경), ops(배포·운영) |
| `scaffolds/` | 새 프로젝트 폴더 구조와 초기 파일 스펙 |
| `rules/` | 프로젝트 CLAUDE.md에 import해서 쓰는 규칙 파일 |
| `skills/` | 슬래시 커맨드 — `/work-log`(작업 정리), `/deploy-check`(배포 준비), `/paper-test`(통합 테스트), `/new-project`(프로젝트 세팅) |
| `install.ps1` | `~/.claude`에 에이전트·템플릿·컨벤션·스캐폴드를 설치 |

## 설치

```powershell
git clone https://github.com/<계정>/jyp-agents.git
cd jyp-agents
.\install.ps1        # Windows
./install.sh         # Mac/Linux
```

에이전트는 `~/.claude/agents/`에, 템플릿·컨벤션·스캐폴드·규칙은 `~/.claude/jyp/`에 복사된다.
전역 설치이므로 어느 폴더에서 Claude Code를 열어도 사용할 수 있다.

## 사용법

### 방법 1: 서브에이전트로 호출

Claude Code 대화에서 에이전트 이름을 지목하면 된다:

```
dev-claude로 로그인 기능 구현해줘
doc-claude로 이번 주 주간 보고서 써줘
doc-claude로 이 PDF 내용 정리해줘
```

슬래시 커맨드로도 호출할 수 있다 (자연어 표현도 동일하게 동작):

```
/new-project      # 새 프로젝트 세팅
/work-log         # 작업 정리 (changelog·memory·CLAUDE.md·백로그 동기화)
/deploy-check     # 배포 준비 체크리스트
/paper-test       # 통합 테스트 (정적 추적)
```

### 방법 2: 프로젝트 전체에 규칙 적용

특정 프로젝트에서 항상 규칙을 적용하고 싶으면, 그 프로젝트의 `CLAUDE.md`에 import 한 줄을 추가한다:

```markdown
@~/.claude/jyp/rules/dev-rules.md
```

이러면 서브에이전트를 부르지 않아도 메인 Claude가 항상 그 규칙대로 일한다.
모든 참조 경로는 저장소 클론 위치가 아니라 **설치 경로(`~/.claude/jyp/`) 기준**이므로, 다른 기기에서도 클론 → `install.ps1` 실행만 하면 동일하게 동작한다.

## 수정/관리

1. 이 저장소에서 에이전트나 템플릿 파일을 수정
2. `.\install.ps1` 재실행으로 `~/.claude`에 반영
3. `git commit` + `git push`로 버전 관리

## 새 페르소나 추가하기

1. `agents/새이름.md` 생성 — 맨 위 frontmatter에 `name`과 `description`(언제 이 에이전트를 쓰는지) 작성, 본문에 규칙 작성
2. 필요하면 `templates/`에 전용 템플릿 추가
3. `.\install.ps1` 실행
