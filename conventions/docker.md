# Docker 컨테이너 컨벤션 (JYP)

**모든 서비스는 개발 서버·운영 서버 모두 Docker 컨테이너로 배포·운영한다** (2026-07-11 확정). `ops.md`(배포·운영)를 전제로 한다.

## 1. 기본 원칙

- 서비스 실행 단위 = 컨테이너. 서버에 Node/런타임을 직접 설치해 실행하지 않는다.
- 로컬 개발도 의존 서비스(DB 등)는 docker compose로 기동한다 — "내 PC에선 되는데" 문제를 원천 차단.
- **컨테이너는 무상태(stateless)** — 컨테이너를 지웠다 다시 만들어도 잃는 것이 없어야 한다. 상태(DB 데이터, 업로드 파일)는 볼륨으로 분리한다.

## 2. Dockerfile (STRICT)

```dockerfile
# ✅ 멀티스테이지 — 빌드 도구는 이미지에 남기지 않는다
FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json ./          # 패키지 파일 먼저 → 레이어 캐시 활용
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
USER node                      # non-root 실행 (STRICT)
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://localhost:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
```

- **멀티스테이지 빌드 필수** — 런타임 이미지에 빌드 도구·소스·devDependencies를 남기지 않는다 (이미지 크기·공격 표면 축소).
- **non-root 사용자로 실행** (`USER node`). root 실행 금지.
- `.dockerignore` 필수: `node_modules`, `.env*`, `.git`, `dist`, `uploads`, `*.log` — 특히 `.env`가 이미지에 들어가는 사고 방지.
- 베이스 이미지는 버전 고정(`node:22-slim`), `latest` 금지.
- 서버 앱에는 `/health` 엔드포인트를 만들고 HEALTHCHECK를 연결한다.

## 3. 설정 주입 (STRICT)

- **환경변수는 런타임에 주입한다** — compose의 `env_file`/`environment` 또는 오케스트레이터의 시크릿. **`.env`를 이미지에 굽는 것(COPY) 금지** (근거: 이미지가 유출되면 시크릿도 유출되고, 환경마다 이미지를 다시 빌드해야 한다).
- 같은 이미지가 개발/운영 어디서든 돌아야 한다 — 환경 차이는 전부 주입된 설정으로만.

## 4. compose 구성

- `docker-compose.yml`(공통 정의) + `docker-compose.dev.yml` / `docker-compose.prod.yml`(환경별 override)로 분리한다.
- **개발**: 소스 bind mount + 핫리로드(`tsx watch`), DB 컨테이너 포함, 포트 노출.
- **운영**: 빌드된 이미지 사용(소스 마운트 금지), `restart: unless-stopped`, 필요한 포트만 노출.
- DB 데이터는 **named volume**, 업로드 파일 등 앱 산출물은 volume/bind mount로 영속화하고 백업 대상에 포함(ops.md 6절).
- 서비스 간 통신은 compose 네트워크의 서비스명으로 (`db:3306`) — IP 하드코딩 금지.

## 5. 이미지 태깅과 배포/롤백

- **운영 배포 이미지에 `latest` 태그 사용 금지.** 태그는 git 배포 태그와 연동: `myapp:v1.2.0` (+ 필요 시 커밋 SHA).
- 배포 절차: 이미지 빌드 → 태그 → (레지스트리 push 또는 운영 서버에서 빌드) → `docker compose up -d` → 헬스체크 확인 → 이전 이미지는 즉시 삭제하지 않고 1~2개 보관.
- **롤백 = 직전 태그 이미지로 재기동** — 이것이 ops.md 2절 "롤백 계획"의 구체 수단이다. (DB 마이그레이션이 함께 나갔다면 migration.md 4절의 2단계 배포 여부를 먼저 확인.)
- DB 마이그레이션은 앱 컨테이너 기동에 섞지 않고 **별도 단계로 실행**한다 — 여러 컨테이너가 동시에 마이그레이션을 돌리는 경쟁을 방지.

## 6. 로그

- 컨테이너 앱은 **stdout/stderr로만 로그를 출력**한다 — 파일로 직접 쓰지 않는다 (`docker logs`가 수집). 로그 내용 규칙은 ops.md 3절.
- 운영은 로깅 드라이버 옵션으로 로테이션 설정 (`max-size`, `max-file`) — 디스크 풀 방지.
