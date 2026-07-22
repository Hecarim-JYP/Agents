#!/usr/bin/env bash
# JYP Agents 설치 스크립트 (Mac/Linux)
# 이 저장소의 에이전트, 템플릿, 컨벤션, 스캐폴드, 규칙, 스킬을 ~/.claude 에 복사한다.
# 사용법: 저장소 루트에서  ./install.sh

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUDE_DIR="$HOME/.claude"
AGENTS_DIR="$CLAUDE_DIR/agents"
JYP_DIR="$CLAUDE_DIR/jyp"

mkdir -p "$AGENTS_DIR"

# 저장소에서 삭제/이름변경된 파일이 설치 경로에 잔존하지 않도록 비우고 새로 복사
rm -rf "$JYP_DIR"

# -r 필수: scaffolds/templates/ 같은 하위 폴더까지 복사한다
# ⚠ 이 폴더 목록은 install.ps1의 목록과 동일해야 한다 — 새 자산 폴더 추가 시 두 스크립트를 함께 고친다
for sub in templates conventions scaffolds rules schemas profiles; do
  mkdir -p "$JYP_DIR/$sub"
  cp -r "$REPO_DIR/$sub/"* "$JYP_DIR/$sub/"
done
cp "$REPO_DIR/agents/"*.md "$AGENTS_DIR/"

# 스킬 설치 — 이 저장소의 스킬 폴더만 교체 (사용자의 다른 스킬은 보존)
SKILLS_DIR="$CLAUDE_DIR/skills"
mkdir -p "$SKILLS_DIR"
for skill in "$REPO_DIR/skills/"*/; do
  name="$(basename "$skill")"
  rm -rf "$SKILLS_DIR/$name"
  cp -r "$skill" "$SKILLS_DIR/$name"
done

# 훅 설치 — 이 저장소의 훅 스크립트만 교체 (사용자의 다른 훅은 보존)
HOOKS_DIR="$CLAUDE_DIR/hooks"
mkdir -p "$HOOKS_DIR"
cp "$REPO_DIR/hooks/"*.mjs "$HOOKS_DIR/"

# 훅 등록 — settings.json에 우리 훅 항목만 병합 (다른 설정·다른 훅은 보존)
if command -v node >/dev/null 2>&1; then
  node "$REPO_DIR/scripts/register-hooks.mjs"
else
  echo "  node가 없어 훅 등록을 건너뜁니다 — 훅은 Node로 실행되므로 Node 설치 후 install을 다시 실행하세요."
fi

# 구버전 설치 경로 정리
OLD_TEMPLATES_DIR="$CLAUDE_DIR/jyp-templates"
if [ -d "$OLD_TEMPLATES_DIR" ]; then
  rm -rf "$OLD_TEMPLATES_DIR"
  echo "구버전 경로 제거: $OLD_TEMPLATES_DIR"
fi

echo ""
echo "설치 완료:"
echo "  에이전트                    -> $AGENTS_DIR  (dev-claude, doc-claude)"
echo "  템플릿/컨벤션/스캐폴드/규칙 -> $JYP_DIR"
echo "  스킬                        -> $SKILLS_DIR  (/work-log, /deploy-check, /paper-test, /new-project)"
echo "  훅                          -> $HOOKS_DIR  (post-edit-check, stop-test — settings.json 등록까지 자동)"
echo ""
echo "이제 어느 폴더에서든 Claude Code에서 다음처럼 사용할 수 있습니다:"
echo '  "dev-claude로 새 프로젝트 세팅해줘"'
echo '  "doc-claude로 주간 보고서 작성해줘"'
