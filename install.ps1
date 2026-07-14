# JYP Agents 설치 스크립트
# 이 저장소의 에이전트, 템플릿, 컨벤션, 스캐폴드, 규칙, 스킬을 ~/.claude 에 복사한다.
# 사용법: 저장소 루트에서  .\install.ps1

$ErrorActionPreference = "Stop"

$claudeDir = Join-Path $HOME ".claude"
$agentsDir = Join-Path $claudeDir "agents"
$jypDir    = Join-Path $claudeDir "jyp"

New-Item -ItemType Directory -Force $agentsDir | Out-Null

# 저장소에서 삭제/이름변경된 파일이 설치 경로에 잔존하지 않도록 비우고 새로 복사
if (Test-Path $jypDir) { Remove-Item -Recurse -Force $jypDir }

# -Recurse 필수: scaffolds/templates/ 같은 하위 폴더까지 복사한다
foreach ($sub in "templates", "conventions", "scaffolds", "rules", "schemas", "profiles") {
    New-Item -ItemType Directory -Force (Join-Path $jypDir $sub) | Out-Null
    Copy-Item (Join-Path $PSScriptRoot "$sub\*") (Join-Path $jypDir $sub) -Recurse -Force
}
Copy-Item (Join-Path $PSScriptRoot "agents\*.md") $agentsDir -Force

# 스킬 설치 — 이 저장소의 스킬 폴더만 교체 (사용자의 다른 스킬은 보존)
$skillsDir = Join-Path $claudeDir "skills"
New-Item -ItemType Directory -Force $skillsDir | Out-Null
foreach ($skill in Get-ChildItem (Join-Path $PSScriptRoot "skills") -Directory) {
    $dest = Join-Path $skillsDir $skill.Name
    if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
    Copy-Item $skill.FullName $dest -Recurse
}

# 훅 설치 — 이 저장소의 훅 스크립트만 교체 (사용자의 다른 훅은 보존)
$hooksDir = Join-Path $claudeDir "hooks"
New-Item -ItemType Directory -Force $hooksDir | Out-Null
Copy-Item (Join-Path $PSScriptRoot "hooks\*.mjs") $hooksDir -Force

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
Write-Host "  스킬                  -> $skillsDir  (/work-log, /deploy-check, /paper-test, /new-project)"
Write-Host "  훅                    -> $hooksDir  (post-edit-check, stop-test)"
Write-Host ""
Write-Host "이제 어느 폴더에서든 Claude Code에서 다음처럼 사용할 수 있습니다:"
Write-Host '  "dev-claude로 새 프로젝트 세팅해줘"'
Write-Host '  "doc-claude로 주간 보고서 작성해줘"'
