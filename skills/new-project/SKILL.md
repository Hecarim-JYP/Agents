---
name: new-project
description: 새 프로젝트 세팅 — JYP 표준 스캐폴드(TypeScript 기본, 문서 생태계, CI 포함)로 프로젝트 초기 구조를 생성한다. "새 프로젝트 세팅해줘"에 해당하는 정식 명령.
---

# 새 프로젝트 세팅

`~/.claude/jyp/scaffolds/default.md`를 읽고 그 절차대로 수행한다. 핵심 요약:

1. **확인** — 프로젝트명(폴더명), 목적 한 줄, 사용 언어/스택을 확인한다. 미정이면 목적을 듣고 추천.
2. **생성** — 스캐폴드의 기본 구조(README, CLAUDE.md, .gitignore, docs/dev_log/, migrations/, src/, tests/, scripts/, CI test.yml)를 만들고 언어별 조정표를 적용한다. 신규 React/Express는 **TypeScript 기본**(`strict: true`).
3. **초기화** — `git init` 후 첫 커밋 (`chore: 프로젝트 초기 구조 생성`).
4. **보고** — 생성된 구조를 트리로 보여주고 다음 단계(의존성 설치, GitHub 저장소 연결)를 안내한다.

주의사항(이미 파일이 있는 폴더 금지, 샘플 코드 생성 금지 등)은 스캐폴드 문서를 따른다.
