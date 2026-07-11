# JYP Agents

Claude Code에서 사용하는 나만의 맞춤형 에이전트(페르소나) 모음.
템플릿과 규칙을 이 저장소에서 버전 관리하고, 어느 프로젝트에서든 동일한 방식으로 일하게 한다.

## 구성

| 경로 | 내용 |
|---|---|
| `agents/dev-claude.md` | 개발용 페르소나 — 기능 구현, 버그 수정, 프로젝트 세팅 |
| `agents/doc-claude.md` | 문서용 페르소나 — 업무 보고서, 기술 문서, 기획/제안서, 자료 요약 |
| `templates/` | doc-claude가 사용하는 문서 템플릿 4종 |
| `rules/` | 프로젝트 CLAUDE.md에 import해서 쓰는 규칙 파일 |
| `install.ps1` | `~/.claude`에 에이전트와 템플릿을 설치 |

## 설치

```powershell
git clone https://github.com/<계정>/jyp-agents.git
cd jyp-agents
.\install.ps1
```

에이전트는 `~/.claude/agents/`에, 템플릿은 `~/.claude/jyp-templates/`에 복사된다.
전역 설치이므로 어느 폴더에서 Claude Code를 열어도 사용할 수 있다.

## 사용법

### 방법 1: 서브에이전트로 호출

Claude Code 대화에서 에이전트 이름을 지목하면 된다:

```
dev-claude로 로그인 기능 구현해줘
doc-claude로 이번 주 주간 보고서 써줘
doc-claude로 이 PDF 내용 정리해줘
```

### 방법 2: 프로젝트 전체에 규칙 적용

특정 프로젝트에서 항상 규칙을 적용하고 싶으면, 그 프로젝트의 `CLAUDE.md`에 import 한 줄을 추가한다:

```markdown
@C:/Users/USER/JYP/Agents/rules/dev-rules.md
```

이러면 서브에이전트를 부르지 않아도 메인 Claude가 항상 그 규칙대로 일한다.

## 수정/관리

1. 이 저장소에서 에이전트나 템플릿 파일을 수정
2. `.\install.ps1` 재실행으로 `~/.claude`에 반영
3. `git commit` + `git push`로 버전 관리

## 새 페르소나 추가하기

1. `agents/새이름.md` 생성 — 맨 위 frontmatter에 `name`과 `description`(언제 이 에이전트를 쓰는지) 작성, 본문에 규칙 작성
2. 필요하면 `templates/`에 전용 템플릿 추가
3. `.\install.ps1` 실행
