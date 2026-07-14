# Docker 컨테이너 컨벤션

**모든 서비스는 개발 서버·운영 서버 모두 Docker 컨테이너로 배포·운영한다** (2026-07-11 확정). `ops.md`(배포·운영)를 전제로 한다.

## 1. 기본 원칙

- 서비스 실행 단위 = 컨테이너. 서버에 Node/런타임을 직접 설치해 실행하지 않는다.
- 로컬 개발도 의존 서비스(DB 등)는 docker compose로 기동한다 — "내 PC에선 되는데" 문제를 원천 차단.
- **컨테이너는 무상태(stateless)** — 컨테이너를 지웠다 다시 만들어도 잃는 것이 없어야 한다. 상태(DB 데이터, 업로드 파일)는 볼륨으로 분리한다.

## 2. Dockerfile (STRICT)

공통 원칙 (스택 무관):

- **멀티스테이지 빌드 필수** — 런타임 이미지에 빌드 도구·소스·devDependencies를 남기지 않는다 (이미지 크기·공격 표면 축소).
- **non-root 사용자로 실행**. root 실행 금지.
- `.dockerignore` 필수: `node_modules`/`build 산출물`, `.env*`, `.git`, `uploads`, `*.log` — 특히 `.env`가 이미지에 들어가는 사고 방지.
- 베이스 이미지는 버전 고정, `latest` 금지.
- 패키지/빌드 정의 파일(package.json, gradle 파일)은 소스보다 먼저 COPY한다 — 의존성 레이어 캐시 활용.
- 서버 앱에는 헬스 엔드포인트를 만들고 HEALTHCHECK를 연결한다 — 경로·명령은 아래 스택별 예시.
- **컨테이너 내부 포트는 프로젝트 상수로 고정한다** (Node 3000 / Spring 8080 / 정적 80) — 앱이 `PORT` 환경변수 등으로 내부 포트를 바꾸는 것 금지 (근거: `EXPOSE`·HEALTHCHECK·프록시의 `server:3000` 참조가 따라가지 못해 헬스체크·라우팅이 조용히 깨진다). 포트 변경이 필요한 곳은 **호스트 매핑의 좌변뿐**이다 (4-1절).

### 2-1. Node/Express

```dockerfile
FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://localhost:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
```

### 2-2. JVM / Spring Boot (Gradle)

```dockerfile
FROM eclipse-temurin:21-jdk AS builder
WORKDIR /app
COPY gradlew build.gradle settings.gradle ./
COPY gradle ./gradle
RUN chmod +x gradlew && ./gradlew dependencies --no-daemon
COPY src ./src
RUN ./gradlew bootJar --no-daemon

FROM eclipse-temurin:21-jre AS runtime
WORKDIR /app
COPY --from=builder /app/build/libs/*.jar app.jar
RUN useradd -r app
USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:8080/actuator/health | grep -q UP || exit 1
CMD ["java", "-jar", "app.jar"]
```

- 헬스 경로는 actuator 표준 `/actuator/health` — 직접 만들지 않는다 (spring.md 7절).
- `chmod +x gradlew`는 Windows에서 커밋된 실행 비트 유실 대비다 (spring.md 0절).
- JRE 베이스에 wget/curl이 없으면 설치하거나 `java`로 HTTP 체크하는 한 줄 클래스 사용 — 어느 쪽이든 HEALTHCHECK는 생략하지 않는다.

### 2-3. 정적 프론트 (React 빌드 + nginx) — 표준

**정적 서빙은 client(nginx) 컨테이너가 담당한다 (2026-07-14 확정)** — 프록시(7절)는 HTTPS 종단과 라우팅만 한다. 빌드 산출물이 이미지에 봉인되므로 롤백이 태그 교체만으로 끝난다.

```dockerfile
FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost/ >/dev/null || exit 1
```

- nginx.conf에는 **SPA fallback(`try_files ... /index.html`)을 반드시 포함**한다 — 없으면 새로고침·딥링크가 404가 된다. 템플릿: `~/.claude/jyp/scaffolds/templates/nginx.conf`.

## 3. 설정 주입 (STRICT)

- **환경변수는 런타임에 주입한다** — compose의 `env_file`/`environment` 또는 오케스트레이터의 시크릿. **`.env`를 이미지에 굽는 것(COPY) 금지** (근거: 이미지가 유출되면 시크릿도 유출되고, 환경마다 이미지를 다시 빌드해야 한다).
- 같은 이미지가 개발/운영 어디서든 돌아야 한다 — 환경 차이는 전부 주입된 설정으로만.

## 4. compose 구성

### 4-1. 모드 2개 · 명령 1개 (STRICT — 2026-07-13 재정의)

**환경(로컬/개발서버/운영서버)마다 compose를 만들지 않는다.** 파일은 base + override 2개 = 3개지만 모드는 둘뿐이고, 환경별로 다른 것은 compose 파일이 아니라 **그 환경의 `.env` 값**이다 (근거: 환경별 compose가 늘어나면 관리 비용과 함께 환경 간 차이(parity 붕괴)가 자란다):

| 모드 | 조합 | 쓰는 곳 | 특징 |
|---|---|---|---|
| **개발 모드** | base + `docker-compose.dev.yml` | **로컬 개발 전용** | 소스 bind mount + 핫리로드. 웹서버는 Vite dev server가 겸함(프록시 컨테이너 없음 — 7절) |
| **배포 모드** | base + `docker-compose.deploy.yml` | **개발서버 = 운영서버 = 로컬 배포 검증** | 태그 이미지 + Caddy 프록시(웹서버 포함), `restart: unless-stopped` |

- **배포 모드는 어느 서버에서든 완전히 같은 파일·같은 절차다.** 개발서버와 운영서버의 차이는 `.env` 값(`SITE_ADDRESS`, DB 자격, `DEPLOY_TAG`)뿐 — "개발서버용 compose"를 따로 만드는 것 금지. 배포 모드는 로컬에서도 그대로 띄워 배포 전 검증에 쓴다.
- **기동 명령도 하나로 통일**: 각 환경의 `.env`에 `COMPOSE_FILE`을 지정하면 (compose가 `.env`의 `COMPOSE_FILE`을 읽는다) 명령은 어디서나 `docker compose up -d` 하나다 — `-f` 나열을 환경마다 외우지 않는다:
  - 로컬 `.env`: `COMPOSE_FILE=docker-compose.yml:docker-compose.dev.yml`
  - 서버(개발·운영) `.env`: `COMPOSE_FILE=docker-compose.yml:docker-compose.deploy.yml`
- 서버의 `.env`는 저장소에 커밋하지 않고 서버에만 둔다(시크릿 포함 — ops.md 1절 관리 규칙). `.env.example`이 전체 키의 원본.

파일별 경계 — **base에는 어느 모드에서든 참인 것만 넣는다** (근거: dev 전용 설정이 base에 있으면 배포 모드에 조용히 딸려간다 — base의 `env_file`·`extra_hosts`가 운영까지 따라가 3절 위반 사례):

| 파일 | 담는 것 | 담지 않는 것 |
|---|---|---|
| base | 서비스 목록(컨테이너 DB 채택 시 db 포함), 네트워크, named volume, `depends_on` | `env_file`, 포트 노출, bind mount, `extra_hosts`, `build:`/`image:` 선택 |
| dev override (개발 모드) | `build:`, 소스 bind mount + 핫리로드, `env_file: .env`, 개발 포트 노출, (호스트 DB 사용 시) `extra_hosts: host.docker.internal:host-gateway` | — |
| deploy override (배포 모드) | `image: <태그>`(5절), `restart: unless-stopped`, 설정 주입(3절), 프록시 서비스(7절), 80/443만 노출 | 소스 마운트, dev 전용 설정 |

- DB 데이터는 **named volume**, 업로드 파일 등 앱 산출물은 volume/bind mount로 영속화하고 백업 대상에 포함(ops.md 6절).
- 서비스 간 통신은 compose 네트워크의 서비스명으로 (`db:3306`) — IP 하드코딩 금지.
- **호스트에 노출하는 포트는 전부 `.env` 변수로, 기본값 폴백 없이** (`"${WEB_PORT:?WEB_PORT 미설정}:5173"`) — 다른 로컬 프로젝트와의 충돌(5173, 3306이 단골)을 기동 전에 변수 하나로 피한다. `:-5173` 같은 폴백 금지 (근거: patterns.md 4절 — `.env` 누락이 기동 실패로 즉시 드러나야 한다. 폴백이 있으면 누락된 채 기본 포트로 조용히 떠서 점유 중인 엉뚱한 서비스에 연결되는 버그가 재발한다. `.env`는 스캐폴드가 생성하므로 폴백은 안전망이 아니라 은폐 장치다). 첫 기동 안내에 포트 충돌 가능성을 함께 고지한다.

### 4-2. DB 위치 — 프로젝트 시작 시 결정 (스캐폴드 체크리스트 항목)

"로컬 개발 DB를 어디에 둘 것인가"는 compose·`.env`가 통째로 달라지는 결정이다. 시작 시 확정하고 CLAUDE.md에 기록한다:

| 선택 | compose | `.env`의 DB_HOST | 비고 |
|---|---|---|---|
| (a) 컨테이너 DB (기본) | base에 db 서비스 + named volume (모든 환경 공통), dev override는 DB 포트 노출만 추가 | `db` (서비스명) | "내 PC에선 되는데" 원천 차단 — 1절 원칙 |
| (b) 호스트 로컬 DB | db 서비스 없음, app에 `extra_hosts: host.docker.internal:host-gateway` | `host.docker.internal` | 기존 로컬 DB 재사용 시 |
| (c) 외부 매니지드 DB | db 서비스 없음 | 외부 호스트명 | 운영/스테이징 공용 |

### 4-3. DB 접속 호스트·포트 매트릭스

"어디서 실행하는 코드가 어디의 DB에 붙는가"로 호스트·포트가 달라진다 — 혼동이 반복되는 지점이므로 표로 고정:

| 실행 위치 → DB 위치 | DB_HOST | DB_PORT |
|---|---|---|
| 컨테이너 앱 → 컨테이너 DB | `db` (서비스명) | **컨테이너 내부 포트** (3306) — ports 매핑과 무관 |
| 호스트 직접 실행(테스트 등) → 컨테이너 DB | `localhost` | **호스트에 노출한 포트** (`ports: "${DB_PORT}:3306"` — `DB_PORT=3307`이면 3307) |
| 컨테이너 앱 → 호스트 로컬 DB | `host.docker.internal` | 호스트 DB 포트 (3306) |
| DB 툴(호스트) → 컨테이너 DB | `localhost` | 호스트에 노출한 포트 |

- 핵심: `ports: "3307:3306"`은 **호스트에서 들어올 때만** 3307이다. 컨테이너끼리는 항상 내부 포트.
- **DB 호스트 노출 포트도 시작 시 결정** 대상이다 (기본 3306, 로컬에 다른 MySQL이 있으면 3307 등) — `.env` 변수로 두고 체크리스트에서 확정.

## 5. 이미지 태깅과 배포/롤백

- **운영 배포 이미지에 `latest` 태그 사용 금지.** 태그는 git 배포 태그와 연동: `myapp:v1.2.0` (+ 필요 시 커밋 SHA).
- **deploy override는 `build:`가 아니라 `image:`를 쓴다** — 서버에서 소스 즉석 빌드 금지. 태그는 서버 `.env`의 변수로 주입해 롤백이 변수 하나 되돌리기가 되게 한다:

```yaml
# docker-compose.deploy.yml
services:
  server:
    image: ghcr.io/<계정>/<프로젝트>-server:${DEPLOY_TAG}
    restart: unless-stopped
```
- **이미지는 CI가 빌드해 레지스트리로 push하고, 서버는 pull만 한다 (표준 — 2026-07-13 확정).** 레지스트리 표준: **ghcr.io** (GitHub 저장소와 연동, private 무료 범위). 서버에서 소스를 직접 빌드하는 것은 임시 예외로만 — 3절 "같은 이미지가 어디서든" 원칙이 깨진다(서버별 빌드 산출물이 미묘하게 달라질 수 있다). 예외 사용 시 사유를 CLAUDE.md에 기록.
- 배포 절차 (개발서버·운영서버 동일 — 4-1절):
  1. main에서 배포 태그 push (`git tag v1.2.0 && git push --tags`)
  2. CI(release 워크플로)가 이미지 빌드 → `ghcr.io/<계정>/<프로젝트>-server:v1.2.0` push (스캐폴드가 생성)
  3. 서버에서 `.env`의 `DEPLOY_TAG` 갱신 → `docker compose pull && docker compose up -d`
  4. 헬스체크·기동 로그 확인 (ops.md 2절) → 이전 이미지는 즉시 삭제하지 않고 1~2개 보관
- 서버의 ghcr 로그인(`docker login ghcr.io` — `read:packages` 토큰)은 서버 셋업 시 1회, 토큰 보관 위치는 handover 문서에 기록 (ops.md 1절 시크릿 규칙).
- **롤백 = 직전 태그 이미지로 재기동** — 이것이 ops.md 2절 "롤백 계획"의 구체 수단이다. (DB 마이그레이션이 함께 나갔다면 migration.md 4절의 2단계 배포 여부를 먼저 확인.)
- DB 마이그레이션은 앱 컨테이너 기동에 섞지 않고 **별도 단계로 실행**한다 — 여러 컨테이너가 동시에 마이그레이션을 돌리는 경쟁을 방지. 구현: compose의 `migrate` 서비스(`profiles: ["tools"]`로 자동 기동 제외) → **`docker compose run --rm migrate`**. ⚠ Spring Boot는 Flyway가 **기동 시 자동 실행되는 것이 기본**이므로 `spring.flyway.enabled=false`로 끄고 이 단계로 통일한다 (spring.md 0절).

## 6. 로그

- 컨테이너 앱은 **stdout/stderr로만 로그를 출력**한다 — 파일로 직접 쓰지 않는다 (`docker logs`가 수집). 로그 내용 규칙은 ops.md 3절.
- 운영은 로깅 드라이버 옵션으로 로테이션 설정 (`max-size`, `max-file`) — 디스크 풀 방지.

## 7. 리버스 프록시·HTTPS

- **전제: 스택 1개 = 앱 인스턴스 1개** (2026-07-13 확정). 기본 형태는 프로젝트마다 운영서버 1대 + 개발서버 1대이며, 이때 프록시는 프로젝트 compose에 포함되고 80/443의 주인은 이 프록시다.
- **한 호스트에 스택이 둘 이상 올라가면**(운영+개발 공존, 또는 여러 프로젝트) 이 전제가 깨진다 — 포트뿐 아니라 **compose 프로젝트명·볼륨이 충돌**한다. 대응은 **7-2절**을 따른다.
- 전제에 기대더라도 **앱 프로세스에 상태를 두지 않는다** (patterns.md 0-3절) — 인메모리 캐시·앱 내 스케줄러·로컬 디스크 업로드처럼 단일 인스턴스에 의존하는 항목은 CLAUDE.md의 "다중화 전환 목록"에 기록해, 전제가 깨질 때 손볼 곳이 문서에 남게 한다.
- 컨테이너 앞단에는 **리버스 프록시 1개**를 둔다. 권장: **Caddy**(자동 HTTPS — 인증서 발급·갱신 무설정) 또는 nginx + certbot.
- **80/443 포트는 프록시만 노출**하고, 앱·DB 컨테이너는 compose 내부 네트워크로만 통신한다 (외부 직접 접근 차단).
- **접근 주소는 포트가 아니라 도메인으로 구분한다 — 도메인 유무는 시작 결정 체크리스트에서 확인** (사내 도메인 미확보 상태를 기본으로 시작할 수 있어야 한다). 어느 쪽이든 Caddyfile은 `{$SITE_ADDRESS}` 변수 하나로 전환된다:

| 사내 도메인 | 운영서버 `SITE_ADDRESS` | 개발서버 `SITE_ADDRESS` | HTTPS |
|---|---|---|---|
| 있음 | `erp.company.com` | `erp-dev.company.com` (dev 서브도메인 — 운영과 동일 구조) | Caddy 자동 |
| 없음 (IP 접근) | `:80` | `:80` | 불가 — HTTP 제약을 CLAUDE.md에 기록 (아래) |

- 도메인이 없어도 구성은 동일하다(프록시가 정적 서빙 + `/api` 프록시) — 도메인 확보 시 **`SITE_ADDRESS` 값 교체만으로 HTTPS 전환**되도록 다른 곳에 주소를 하드코딩하지 않는다. 서버 1대 = 프로젝트 1개 전제 덕에 도메인이 없어도 포트 구분(8100번대 블록 등)은 필요 없다 — 80 하나면 된다.
- **DB 포트 노출 정책**: 운영서버는 DB 포트를 호스트에 노출하지 않는다(관리 접속은 SSH 터널). 개발서버는 노출하되 사내망/VPN 범위로 제한. 로컬은 자유(4-3절).
- HTTPS 종단은 프록시에서 처리하고 앱은 내부 HTTP로 받는다 — Express는 `app.set('trust proxy', 1)`로 `X-Forwarded-*`를 신뢰 설정해야 클라이언트 IP·프로토콜 판별이 정상 동작한다.
- **역할 분담 (2026-07-14 확정)**: **프록시 = HTTPS 종단 + 라우팅만**, **정적 서빙 = client(nginx) 컨테이너**(2-3절). 프록시가 같은 출처에서 `/api/*`는 server로, 그 외는 client로 넘기므로 CORS가 원천 해소된다.
- **프록시 서비스와 Caddyfile은 스캐폴드 기본 구성이다 (STRICT)** — 없으면 배포 모드 기동 시 외부 접근 경로가 아예 없다 (근거: 규칙만 있고 스캐폴드에 프록시가 빠져 배포 기동에서 접근 불가·CORS 차단이 발생한 사례).
- 템플릿: **`~/.claude/jyp/scaffolds/templates/Caddyfile`** (compose 3종도 같은 폴더). 라우팅 규약:

| 경로 | 대상 | 비고 |
|---|---|---|
| `/api/*` | `server:3000` | Spring이면 `server:8080` |
| `/health` | `server:3000` | 외부 가동 감시용(ops.md 7절). Spring이면 `/actuator/health`로 rewrite |
| 그 외 | `client:80` | nginx가 SPA fallback 처리 |

- **개발(로컬)도 동일 출처를 유지한다**: 로컬은 프록시 컨테이너 대신 Vite `server.proxy`로 `/api/*`를 서버(컨테이너 노출 포트)로 넘긴다 — 클라이언트 코드는 dev/prod 어디서든 같은 상대 경로(`/api/...`)만 호출하고, CORS 설정 자체가 필요 없어진다. 프록시 대상 포트는 vite.config가 `loadEnv`로 `.env`의 `API_PORT`를 읽는다 — `localhost:3000` 하드코딩 금지 (포트 변수화 원칙 4-1절이 여기서만 깨지는 것 방지).
- 사내망 등 HTTPS 불가 환경이면 그 제약을 프로젝트 CLAUDE.md에 기록한다 (브라우저의 HTTP 제약 — blob 다운로드 차단, secure cookie 불가 등을 설계 시 인지).

## 7-2. 한 호스트에 운영·개발 스택 공존 (2026-07-14 추가)

물리 서버가 하나뿐이라 **운영 스택과 개발 스택을 같은 PC에 함께 띄우는** 경우. 포트만 바꾸면 될 것 같지만, 그것만으로는 **조용히 데이터가 섞인다.**

### 7-2-1. 스택 격리 (STRICT — 가장 먼저)

- **`.env`의 `COMPOSE_PROJECT_NAME`을 스택마다 다르게 지정한다** (`myapp-prod` / `myapp-dev`). compose는 프로젝트명으로 컨테이너·네트워크·**볼륨 이름을 짓는다** — 지정하지 않으면 디렉토리명이 프로젝트명이 되고, **두 스택을 같은 디렉토리에서 `.env`만 바꿔 띄우면 볼륨이 겹쳐 개발 스택이 운영 DB 볼륨을 그대로 붙잡는다** (포트를 아무리 나눠도 막지 못하는 사고).
- **디렉토리도 스택별로 분리**한다: `/srv/myapp-prod`, `/srv/myapp-dev` — 각자 저장소 체크아웃 + 각자 `.env`. 배치 cron(batch.md 1절)도 각 디렉토리 기준으로 등록한다.
- 운영 `.env`와 개발 `.env`의 **DB 자격·DB명을 반드시 다르게** 한다 — 개발 스택이 운영 DB를 가리키는 사고를 값 수준에서도 막는다.

### 7-2-2. 외부 노출 — 두 방식

| | (a) 포트 분리 (사내 도메인 없을 때) | (b) 공용 프록시 (도메인 있을 때 — 권장) |
|---|---|---|
| 구성 | 스택마다 프록시를 두고 호스트 포트를 나눈다: 운영 `HTTP_PORT=80`/`HTTPS_PORT=443`, 개발 `8080`/`8443` | 호스트에 **프록시 1개**를 별도 compose로 상주(80/443 점유), 두 스택은 external network로 조인. 도메인으로 분기(`erp.company.com` / `erp-dev.company.com`) |
| 접근 | `http://<서버IP>` / `http://<서버IP>:8080` | 도메인 |
| HTTPS | 운영만 가능. **개발 스택은 자동 HTTPS 불가** — ACME 인증은 표준 80/443으로만 검증되므로 8443에 붙은 Caddy는 인증서를 못 받는다 | 양쪽 모두 자동 HTTPS |
| 앱 포트 노출 | 프록시만 | 없음(프록시가 내부 네트워크로 접근) |

- 사내 도메인 미확보 상태(체크리스트 15)에서는 **(a)로 시작**하고, 도메인 확보 시 (b)로 전환한다 — 전환 시 각 스택의 프록시를 제거하고 `SITE_ADDRESS`를 도메인으로 바꾸는 것이 전부다.
- (a)에서 개발 스택의 `SITE_ADDRESS`는 `:80`(컨테이너 내부 기준) 그대로 두고 **호스트 매핑만 8080으로** 바꾼다 — 컨테이너 내부 포트는 상수 고정 원칙(2절).

### 7-2-3. 자원·운영 주의

- 운영과 개발이 **같은 CPU·메모리·디스크를 공유**한다 — 개발 스택의 배치·테스트가 운영 성능을 잠식할 수 있다. 개발 스택에 `deploy.resources.limits`로 상한을 두거나, 무거운 작업은 운영 한가한 시간대로 옮긴다.
- 디스크 사용량이 두 배로 늘어난다 — 이미지 정리 규칙(ops.md 8절)을 더 엄격히 적용하되, **롤백용 직전 태그는 스택별로 보존**한다.
- 이 구성 자체를 CLAUDE.md에 기록한다 (프로젝트명·포트·디렉토리 매핑) — 서버에 무엇이 떠 있는지가 문서에 없으면 다음 사람이 개발 스택을 운영으로 착각한다.
