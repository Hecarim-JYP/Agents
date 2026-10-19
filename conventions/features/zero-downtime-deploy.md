# 레시피: 무중단 배포(순차 교체)와 프록시의 컨테이너 재해석 `[대외]`

> 확정: 2026-10-19 | 템플릿: `scaffolds/templates/nginx-proxy.conf`(재해석·연결 타임아웃 내장)·`Caddyfile` | 전제: graceful-shutdown.md(안전 종료), multi-instance.md(상태 외부화), migration.md 4절(2단계 배포) | 짝: static-assets.md(열린 탭의 옛 청크)
> 배포는 컨테이너를 **새로 만든다** — IP가 바뀐다. 프록시는 이름을 **요청할 때마다 다시 해석**해야 하고, 순차 교체는 **새 것을 먼저 띄우고(healthy) 옛 것을 안전 종료로 뺀다**. 정적(client) 컨테이너는 순차 교체하지 않는다.

## 1. 언제 쓰나

- **3-1절(프록시 재해석)은 모든 프로젝트에 해당한다** — 사내 단일 인스턴스도 재배포마다 IP가 바뀔 수 있다. 템플릿에 반영돼 있다.
- 3-3절(순차 교체)은 배포 중 1초 남짓한 점검 안내도 허용되지 않는 대외 서비스, 또는 업무 시간 중 배포가 잦은 시스템.

## 2. 결정 항목 (기본값)

| 결정 | 기본값 | 대안 / 비고 |
|---|---|---|
| server 배포 방식 | **사내: 한 번에 교체** — `docker compose up -d`, 그동안 1~3초 점검 안내 503 (실측) | 대외·무중단 요구: **순차 교체**(3-3절). multi-instance.md 전환 목록을 먼저 끝낸다(배포 순간에는 인스턴스가 2개다) |
| client(정적) 배포 | **항상 한 번에 교체** | 순차 교체 금지 — 4절. 열린 탭은 static-assets.md 3-1절로 처리 |
| 프록시 이름 해석 | **요청 시점 재해석** — nginx `resolver 127.0.0.11 valid=1s` + 변수 `proxy_pass`, `proxy_connect_timeout 2s` (템플릿) | Caddy는 기본 동작 |
| DB 스키마 변경 | **확장 → 코드 전환 → 축소** (migration.md 4절 — 2단계 배포) | 순차 교체 중에는 옛 코드와 새 코드가 **같은 DB를 동시에** 쓴다 |
| HEALTHCHECK 첫 판정 | 순차 교체를 쓰면 server 이미지에 `--start-period=30s --start-interval=2s` 추가 | 기본(`interval=30s`)이면 새 컨테이너가 healthy가 되기까지 31초 (실측). Docker Engine 25 이상 |

## 3. 표준 설계

### 3-1. 프록시 — 이름을 요청 시점에 다시 해석한다 (STRICT, 템플릿 반영)

nginx는 `proxy_pass http://server:3000;`처럼 **이름을 고정으로 쓰면 기동할 때 한 번만 해석**해 IP를 기억한다. 재배포로 컨테이너가 새로 생기면:

| 실측 (2026-10-19, Docker 29.8 · compose 5.6 · nginx-unprivileged 1.27, 스캐폴드 compose 템플릿 그대로) | 결과 |
|---|---|
| client·server를 같은 태그로 함께 재배포 (일반적인 배포) | 두 컨테이너가 **IP를 맞바꿈**(server .3→.4, client .4→.3) → `/api`·화면 모두 **503 고정**, 이후 재배포를 반복해도 풀리지 않음. proxy 재시작으로만 복구 |
| server만 재배포했는데 그 사이 다른 컨테이너가 옛 IP를 차지 (배포 중 migrate·batch 실행과 같은 상황) | 고정 해석: **20초 내내 503** / 재해석: **0.3초 후 200** |
| Caddy 템플릿 그대로, 같은 상황 | 0.3초 후 200 — 연결할 때마다 다시 해석한다 |

```nginx
resolver 127.0.0.11 valid=1s ipv6=off;        # Docker 내장 DNS — 1초마다 다시 묻는다
set $server_upstream http://server:3000;
proxy_connect_timeout 2s;                      # 방금 사라진 IP에 60초 매달리지 않게
location /api/ { proxy_pass $server_upstream; }   # 변수를 써야 요청 시점에 해석한다
```

- **연결 타임아웃을 함께 줄인다** — 옛 컨테이너가 제거된 직후에도 DNS 캐시(`valid`) 동안은 옛 IP가 남는다. 사라진 IP로의 연결은 거부도 없이 응답이 없어 **기본 60초를 매달린다**(실측: 최대 60,057ms, 503 531건). 순차 교체 중 실측 비교:

| DNS 캐시 `valid` | `proxy_connect_timeout` | 최대 응답 | 실패 |
|---|---|---|---|
| 5초 | 기본(60초) | 60,057ms | 503 531건 |
| 1초 | 기본(60초) | 60,056 / 60,061ms | 0 / 0 |
| 5초 | 2초 | 2,010 / 2,009ms | 0 / 503 417건 |
| **1초** | **2초** | **2,006 / 2,009ms** | **0 / 0** ← 템플릿 |

- Spring의 헬스 경로처럼 URI를 바꿀 때는 `proxy_pass $server_upstream/actuator/health;` — 변수 뒤 URI 치환도 동작한다(실측).

### 3-2. 한 번에 교체 (사내 기본)

```bash
sed -i 's/^DEPLOY_TAG=.*/DEPLOY_TAG=v1.4.0/' .env      # ① 태그부터 바꾼다 (4절 — 안 바꾸면 다른 명령이 옛 태그로 되돌린다)
docker compose pull
docker compose run --rm migrate                         # ② 확장 단계 마이그레이션 (migration.md)
docker compose up -d                                    # ③ 바뀐 서비스만 재생성
```

- 실측 (최종 템플릿, 부하 동시 10, 2회): 교체 순간부터 **1~2.5초 동안 점검 안내 503**(394건·651건), 이후 새 버전 정상. 앱이 안전 종료(graceful-shutdown.md)를 하므로 처리 중이던 요청은 끝까지 응답하고, 503 동안의 요청은 프록시가 안내 봉투로 답한다(maintenance-mode.md 3-1절).

### 3-3. 순차 교체 (server — 무중단)

```bash
#!/usr/bin/env bash
# 순차 교체: 새 태그 컨테이너 추가 → healthy 대기 → 1개로 줄이기(compose가 설정과 다른 옛 컨테이너를 안전 종료로 뺀다)
set -euo pipefail
TAG=$1
sed -i "s/^DEPLOY_TAG=.*/DEPLOY_TAG=$TAG/" .env
docker compose pull server
docker compose up -d --no-deps --no-recreate --scale server=2 server
for i in $(seq 1 90); do
  [ "$(docker compose ps server --format '{{.Image}} {{.Health}}' | grep -c ":$TAG healthy")" = 1 ] && break
  [ "$i" = 90 ] && { echo "새 컨테이너가 healthy가 되지 않음 — 중단"; docker compose up -d --no-deps --scale server=1 server; exit 1; }
  sleep 1
done
docker compose up -d --no-deps --scale server=1 server
```

- 실측 (최종 템플릿, 부하 동시 10 — GET·POST 혼합, 3회): **실패 0건**, 새 버전 응답 시작 약 3초. `--scale server=1`은 매번 **새 태그 컨테이너를 남기고** 옛 것을 지웠다(설정과 다른 컨테이너부터 제거).
- 실패 시 위 스크립트는 새 컨테이너를 정리하지 않는다 — 1개로 줄이면 compose가 무엇을 남길지는 설정(태그)에 따른다. 롤백은 `.env`를 직전 태그로 되돌리고 같은 스크립트를 다시 실행한다(docker.md — 롤백 = 직전 이미지).

### 3-4. client(정적) — 한 번에 교체

두 버전의 client가 동시에 떠 있으면 **새 `index.html`을 받은 브라우저가 해시가 다른 새 자산을 옛 컨테이너에 요청**한다 — 실측: 공존 중 화면 열기 60회 중 **33회 JS 404**(흰 화면). client는 `docker compose up -d client`로 한 번에 바꾸고, 이미 열려 있던 탭의 옛 청크 요청은 static-assets.md 3-1절(청크 실패 시 새로고침)이 처리한다.

## 4. 함정 (STRICT)

| 함정 | 증상 | 처방 |
|---|---|---|
| 프록시가 이름을 기동 때만 해석 | 재배포 후 서비스 전체 503 고정 — 컨테이너 IP 맞바꿈 (실측) | 3-1절 (템플릿) |
| 연결 타임아웃 기본값(60초) | 순차 교체 직후 요청이 60초 매달림 (실측) | `proxy_connect_timeout 2s` |
| `.env` 태그를 나중에 바꿈 | 다른 서비스를 재생성하는 compose 명령이 의존 서비스(server)를 **옛 태그로 되돌린다** (실측) | 태그부터 바꾼다 |
| client 순차 교체 | 새 화면이 옛 컨테이너에 새 자산 요청 → 55% 흰 화면 (실측) | 한 번에 교체 |
| 옛 컨테이너를 강제 종료(SIGKILL·`docker kill`) | GET은 nginx가 다른 인스턴스로 재시도하지만 **처리 중이던 POST는 실패** (실측: 3건) | compose scale 축소(안전 종료) 또는 `docker stop -t 30` |
| `docker stop` 기본 대기 10초 | compose의 `stop_grace_period: 30s`가 적용되지 않아 긴 요청이 잘린다 | compose 명령으로 줄이거나 `-t 30` |
| HEALTHCHECK `interval=30s`만 | 순차 교체가 매번 30초 이상 걸린다 (실측 31초) | `--start-period --start-interval` |
| 스키마를 한 번에 바꿈 | 교체 중 옛 코드가 없어진 컬럼을 읽어 500 | 확장→전환→축소 |

## 5. 스택별 구현

| 구성 | Express | Spring |
|---|---|---|
| 안전 종료 | graceful-shutdown.md 5절 코드 | graceful-shutdown.md 5절 (`server.shutdown: graceful` + 대기 상한 20초) |
| HEALTHCHECK | docker.md 2-1절 + `--start-period=30s --start-interval=2s` | docker.md 2-2절 + 같은 옵션 |
| 프록시 | 템플릿 그대로 | 템플릿 + `$server_upstream`을 `http://server:8080`으로 |

## 6. 검증 포인트

- 배포 전 로컬 검증(docker.md 4-1절 배포 모드): 부하 스크립트(동시 10, GET·POST 혼합)를 돌리는 동안 3-2 또는 3-3절 절차를 실행 → **실패 건수·최대 응답 시간**을 기록. 3-3절이면 실패 0, 최대 응답 2초대여야 한다.
- 재배포 후 `docker compose ps`에 server가 1개이고 태그가 `.env`와 같은지.
- /live-test(관찰자 모드): 사용자가 화면을 연 채로 배포 → 다음 화면 이동이 정상인지(static-assets.md 3-1절).
