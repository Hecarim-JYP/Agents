#!/usr/bin/env bash
# JYP Agents 설치 스크립트 (Mac/Linux)
# 이 저장소의 에이전트, 템플릿, 컨벤션, 스캐폴드, 규칙을 ~/.claude 에 복사한다.
# 사용법: 저장소 루트에서  ./install.sh

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAUDE_DIR="$HOME/.claude"
AGENTS_DIR="$CLAUDE_DIR/agents"
JYP_DIR="$CLAUDE_DIR/jyp"

mkdir -p "$AGENTS_DIR"

# 저장소에서 삭제/이름변경된 파일이 설치 경로에 잔존하지 않도록 비우고 새로 복사
rm -rf "$JYP_DIR"

for sub in templates conventions scaffolds rules; do
  mkdir -p "$JYP_DIR/$sub"
  cp "$REPO_DIR/$sub/"*.md "$JYP_DIR/$sub/"
done
cp "$REPO_DIR/agents/"*.md "$AGENTS_DIR/"

echo ""
echo "설치 완료:"
echo "  에이전트                    -> $AGENTS_DIR  (dev-claude, doc-claude)"
echo "  템플릿/컨벤션/스캐폴드/규칙 -> $JYP_DIR"
