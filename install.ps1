# JYP Agents 설치 스크립트
# 이 저장소의 에이전트와 템플릿을 ~/.claude 에 복사한다.
# 사용법: 저장소 루트에서  .\install.ps1

$ErrorActionPreference = "Stop"

$claudeDir    = Join-Path $HOME ".claude"
$agentsDir    = Join-Path $claudeDir "agents"
$templatesDir = Join-Path $claudeDir "jyp-templates"

New-Item -ItemType Directory -Force $agentsDir    | Out-Null
New-Item -ItemType Directory -Force $templatesDir | Out-Null

Copy-Item (Join-Path $PSScriptRoot "agents\*.md")    $agentsDir    -Force
Copy-Item (Join-Path $PSScriptRoot "templates\*.md") $templatesDir -Force

Write-Host ""
Write-Host "설치 완료:"
Write-Host "  에이전트  -> $agentsDir  (dev-claude, doc-claude)"
Write-Host "  템플릿    -> $templatesDir"
Write-Host ""
Write-Host "이제 어느 폴더에서든 Claude Code에서 다음처럼 사용할 수 있습니다:"
Write-Host '  "dev-claude로 이 기능 구현해줘"'
Write-Host '  "doc-claude로 주간 보고서 작성해줘"'
