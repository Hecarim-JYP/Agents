# JYP Agents 설치 스크립트
# 이 저장소의 에이전트, 템플릿, 컨벤션, 스캐폴드를 ~/.claude 에 복사한다.
# 사용법: 저장소 루트에서  .\install.ps1

$ErrorActionPreference = "Stop"

$claudeDir = Join-Path $HOME ".claude"
$agentsDir = Join-Path $claudeDir "agents"
$jypDir    = Join-Path $claudeDir "jyp"

New-Item -ItemType Directory -Force $agentsDir | Out-Null
foreach ($sub in "templates", "conventions", "scaffolds", "rules") {
    New-Item -ItemType Directory -Force (Join-Path $jypDir $sub) | Out-Null
    Copy-Item (Join-Path $PSScriptRoot "$sub\*.md") (Join-Path $jypDir $sub) -Force
}
Copy-Item (Join-Path $PSScriptRoot "agents\*.md") $agentsDir -Force

# 구버전 설치 경로 정리
$oldTemplatesDir = Join-Path $claudeDir "jyp-templates"
if (Test-Path $oldTemplatesDir) {
    Remove-Item -Recurse -Force $oldTemplatesDir
    Write-Host "구버전 경로 제거: $oldTemplatesDir"
}

Write-Host ""
Write-Host "설치 완료:"
Write-Host "  에이전트              -> $agentsDir  (dev-claude, doc-claude)"
Write-Host "  템플릿/컨벤션/스캐폴드/규칙 -> $jypDir"
Write-Host ""
Write-Host "이제 어느 폴더에서든 Claude Code에서 다음처럼 사용할 수 있습니다:"
Write-Host '  "dev-claude로 새 프로젝트 세팅해줘"'
Write-Host '  "doc-claude로 주간 보고서 작성해줘"'
