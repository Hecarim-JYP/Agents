# compose 템플릿 검증 — Docker가 설치된 PC에서 실행한다.
# 임시 폴더에 템플릿을 조립하고 .env를 채운 뒤, 두 모드의 compose 병합·변수 치환을 검증한다.
# 컨테이너를 띄우지 않고 이미지도 받지 않는다 (docker compose config만 실행).
#
# 사용법: 저장소 루트에서  .\scripts\verify-templates.ps1

$ErrorActionPreference = "Stop"

$repo = Split-Path $PSScriptRoot -Parent
$work = Join-Path ([System.IO.Path]::GetTempPath()) ("compose-verify-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory -Force $work | Out-Null
New-Item -ItemType Directory -Force (Join-Path $work "proxy") | Out-Null
New-Item -ItemType Directory -Force (Join-Path $work "migrations") | Out-Null

Copy-Item (Join-Path $repo "scaffolds\templates\docker-compose*.yml") $work
Copy-Item (Join-Path $repo "scaffolds\templates\Caddyfile") (Join-Path $work "proxy")

# 검증용 .env — 실제 값이 아니라 치환이 되는지만 본다.
# ⚠ BOM 없이 쓴다: PowerShell의 Set-Content -Encoding utf8은 BOM을 붙이는데,
#    BOM이 있으면 compose가 첫 줄의 키를 인식하지 못한다.
$envText = @'
COMPOSE_PROJECT_NAME=verify
COMPOSE_PATH_SEPARATOR=:
WEB_PORT=5173
API_PORT=3000
DB_PORT=3306
HTTP_PORT=80
HTTPS_PORT=443
DB_HOST=db
DB_NAME=verify
DB_USER=verify
DB_PASSWORD=verify
DB_ROOT_PASSWORD=verify
TEST_DB_NAME=verify_test
TEST_DB_USER=verify
TEST_DB_PASSWORD=verify
TEST_DB_PORT=3307
SITE_ADDRESS=:80
IMAGE_PREFIX=ghcr.io/example/verify
DEPLOY_TAG=v0.0.1
INTERNAL_API_URL=
INTERNAL_API_KEY=
'@
[System.IO.File]::WriteAllText((Join-Path $work ".env"), $envText, [System.Text.UTF8Encoding]::new($false))

# 개발 모드는 build 컨텍스트(client/·server/)가 필요하다 — 검증용 빈 Dockerfile
foreach ($svc in "client", "server") {
    $d = Join-Path $work $svc
    New-Item -ItemType Directory -Force $d | Out-Null
    [System.IO.File]::WriteAllText((Join-Path $d "Dockerfile"), "FROM alpine:3.20 AS builder`nRUN true`n", [System.Text.UTF8Encoding]::new($false))
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host ""
    Write-Host "docker CLI가 없어 검증은 실행하지 못했습니다. 검증 폴더는 준비했습니다:" -ForegroundColor Yellow
    Write-Host "  $work"
    Write-Host ""
    Write-Host "Docker가 있는 PC로 이 폴더를 복사한 뒤, 폴더 안에서 다음 두 줄을 실행하세요:"
    Write-Host '  $env:COMPOSE_FILE="docker-compose.yml:docker-compose.dev.yml";    docker compose config' -ForegroundColor Cyan
    Write-Host '  $env:COMPOSE_FILE="docker-compose.yml:docker-compose.deploy.yml"; docker compose config' -ForegroundColor Cyan
    Write-Host ""
    Write-Host "각 명령이 오류 없이 병합 결과를 출력하면 통과입니다."
    exit 0
}

Push-Location $work
$failed = $false
$env:COMPOSE_PATH_SEPARATOR = ":"   # Windows 기본 구분자는 ';' — .env와 동일하게 ':'로 통일
foreach ($mode in @(
    @{ Name = "개발 모드"; Files = "docker-compose.yml:docker-compose.dev.yml" },
    @{ Name = "배포 모드"; Files = "docker-compose.yml:docker-compose.deploy.yml" }
)) {
    $env:COMPOSE_FILE = $mode.Files
    Write-Host "`n[$($mode.Name)] $($mode.Files)" -ForegroundColor Cyan
    $out = docker compose config 2>&1
    if ($LASTEXITCODE -eq 0) {
        $svcs = ($out | Select-String "^  (\w[\w-]*):" | ForEach-Object { $_.Matches[0].Groups[1].Value }) -join ", "
        Write-Host "  OK — 병합·치환 정상 (서비스: $svcs)" -ForegroundColor Green
    } else {
        Write-Host "  FAIL" -ForegroundColor Red
        $out | Select-Object -First 15 | ForEach-Object { Write-Host "    $_" }
        $failed = $true
    }
}
Remove-Item Env:\COMPOSE_FILE
Pop-Location

Write-Host "`n검증 폴더: $work"
if ($failed) {
    Write-Host "결과: 실패 — 위 오류를 templates/에 반영해야 합니다." -ForegroundColor Red
    exit 1
}
Remove-Item -Recurse -Force $work
Write-Host "결과: 통과 — 두 모드 모두 compose 병합·변수 치환 정상" -ForegroundColor Green
