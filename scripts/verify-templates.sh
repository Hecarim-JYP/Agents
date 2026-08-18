#!/usr/bin/env bash
# compose 템플릿 검증 — Docker가 설치된 PC에서 실행한다 (Mac/Linux).
# 임시 폴더에 템플릿을 조립하고 .env를 채운 뒤, 두 모드의 compose 병합·변수 치환을 검증한다.
# 컨테이너를 띄우지 않고 이미지도 받지 않는다 (docker compose config만 실행).
# Windows용은 verify-templates.ps1 — 두 스크립트는 동일한 검증을 수행해야 한다.
#
# 사용법: 저장소 루트에서  ./scripts/verify-templates.sh

set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/compose-verify-XXXXXXXX")"
mkdir -p "$work/proxy" "$work/migrations"

cp "$repo"/scaffolds/templates/docker-compose*.yml "$work/"
cp "$repo/scaffolds/templates/nginx-proxy.conf" "$work/proxy/nginx.conf"   # 기본 프록시 (체크리스트 15)

# 검증용 .env — 실제 값이 아니라 치환이 되는지만 본다. BOM 없이 쓴다(compose가 첫 줄 키를 못 읽는 것 방지).
cat > "$work/.env" <<'ENV'
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
ENV

# 개발 모드는 build 컨텍스트(client/·server/)가 필요하다 — 검증용 빈 Dockerfile
for svc in client server; do
  mkdir -p "$work/$svc"
  printf 'FROM alpine:3.20 AS builder\nRUN true\n' > "$work/$svc/Dockerfile"
done

if ! command -v docker >/dev/null 2>&1; then
  echo ""
  echo "docker CLI가 없어 검증은 실행하지 못했습니다. 검증 폴더는 준비했습니다:"
  echo "  $work"
  echo ""
  echo "Docker가 있는 PC로 이 폴더를 복사한 뒤, 폴더 안에서 다음 두 줄을 실행하세요:"
  echo '  COMPOSE_FILE="docker-compose.yml:docker-compose.dev.yml"    docker compose config'
  echo '  COMPOSE_FILE="docker-compose.yml:docker-compose.deploy.yml" docker compose config'
  echo ""
  echo "각 명령이 오류 없이 병합 결과를 출력하면 통과입니다."
  exit 0
fi

cd "$work"
export COMPOSE_PATH_SEPARATOR=":"   # .env와 동일하게 ':'로 통일
failed=0
for mode in "개발 모드:docker-compose.yml:docker-compose.dev.yml" "배포 모드:docker-compose.yml:docker-compose.deploy.yml"; do
  name="${mode%%:*}"
  files="${mode#*:}"
  echo ""
  echo "[$name] $files"
  if out="$(COMPOSE_FILE="$files" docker compose config 2>&1)"; then
    svcs="$(printf '%s\n' "$out" | sed -n 's/^  \([A-Za-z][A-Za-z0-9_-]*\):.*/\1/p' | paste -sd ', ' -)"
    echo "  OK — 병합·치환 정상 (서비스: $svcs)"
  else
    echo "  FAIL"
    printf '%s\n' "$out" | head -n 15 | sed 's/^/    /'
    failed=1
  fi
done

echo ""
echo "검증 폴더: $work"
if [ "$failed" -ne 0 ]; then
  echo "결과: 실패 — 위 오류를 templates/에 반영해야 합니다."
  exit 1
fi
rm -rf "$work"
echo "결과: 통과 — 두 모드 모두 compose 병합·변수 치환 정상"
