# 변경 이력 — 2026-07-17

> 작업 베이스 커밋 5ceac8d(2026-07-16) 이후 18커밋 (세션이 07-18 새벽까지 이어짐 — 마지막 1커밋).
> 사용자가 실무 적용 중 발견한 3건(auth 잠금·docker non-root 충돌·localhost 헬스체크)에서 출발해,
> 컨벤션 17개 전수 리뷰 + 실기동 검증으로 확장한 정비.
> 핵심 주제: **① 인증 책임 재정의 ② 컨테이너 non-root 완결·프록시 선택제 ③ 언어 선택제 ④ 배치·마이그레이션 정합 ⑤ 자동 검증 신설**

---

## 1. 인증 — 잠금 책임 재정의 (12799ed, e5f7213, 514eb2c)

기존: 위임(b) 채택 시 잠금 컬럼을 제거하고 시도 제한을 구현하지 않도록 지시 — "잠금은 사내 책임"이라는 단정이 인증 소스에 잠금이 있다는 검증 안 된 가정 위에 있었고, 같은 지시가 4곳(auth.md 0·1절, 01_auth.sql, default.md 2곳)에 복제돼 있었다.
변경: 분기 기준을 "인증 소스에 잠금이 있는가"(남의 사정)에서 **"자격증명이 우리를 거치는가"(우리 구조)**로 교체. (b)는 우리 로그인 화면이 ID/PW를 받으므로 잠금 컬럼 유지 + 시도 제한 구현, (c) SSO만 제거. 잠금 범위는 **우리 로그인만**(사내 계정을 잠그면 그 사람 업무 전체가 멈춘다), 우리 임계값은 인증 소스보다 낮게(우리가 먼저 끊으면 시도가 사내에 도달하지 않는다).

**검토 후 폐기한 설계** — IP 단위 rate limit: 사내 NAT 뒤에서 IP는 개인이 아니라 집단을 가리켜, 한 사람의 실패로 무고한 전원이 막히는 연대책임이 된다. spraying 방어는 로그인 시점 차단이 아니라 **비밀번호가 정해지는 시점**(흔한 비밀번호 차단 목록 — (a) 전용)으로 옮겼다. 위임·SSO에서는 비밀번호 정책에 간섭하지 않는다(형식 검증 포함 — 인증 소스보다 엄격하면 사내에서 되는 계정이 우리만 실패).

해시 파라미터 최소선 신설: bcrypt cost 12+(프레임워크 기본 10은 미달), argon2id m=19MiB·t=2·p=1, bcrypt 72바이트 절단 경고(한글 24자).

**변경 파일**: `conventions/auth.md`(0·1·6절), `schemas/01_auth.sql`, `scaffolds/default.md`(체크리스트 19·기초 테이블)

---

## 2. 컨테이너 — non-root 완결·프록시 선택제 (02f5c32, 7a27fdb, d42ad4f, cabf300, 4a5efea)

기존: 2절 non-root STRICT와 2-3절 예시(`nginx:1.27` + `EXPOSE 80`)가 리눅스 특권 포트 제약상 동시 만족 불가 — 2-3절만 `USER` 지시어가 없던 것이 그 증거. HEALTHCHECK `127.0.0.1` 규칙은 2-3절 구석에만 있어 Node·Spring 예시는 `localhost`. 프록시는 Caddy 고정에 "도메인 확보 시 값 교체만으로 자동 HTTPS" 약속 — **사내망 서버는 ACME(HTTP-01) 검증이 도달하지 못해 도메인이 있어도 거짓**.
변경:
- 정적 컨테이너 `nginxinc/nginx-unprivileged:1.27-alpine` + 8080 + `USER 101`(숫자 UID — K8s runAsNonRoot 통과 조건). 포트 상수·Caddyfile·nginx.conf 연쇄 수정.
- HEALTHCHECK `127.0.0.1` 고정을 2절 공통 원칙으로 승격 — "Node는 듀얼스택이라 문제없다"를 "우연히 통과한다"로 교정(실측: Node는 `[::]:3000` 소켓 하나, IPv4 리슨 없음 — 듀얼스택 소켓 덕에 받아질 뿐).
- **볼륨 마운트 지점은 이미지에서 실행 사용자 소유로 선생성** — 빈 named volume은 root 소유로 생성되어 non-root 앱의 첫 쓰기가 EACCES(실컨테이너 재현). 헬스체크는 통과하므로 "로컬은 되는데 운영에서 업로드만 죽는" 형태.
- **프록시 선택제**(체크리스트 15 확장): 사내망 전용(기본)=nginx-unprivileged(`nginx-proxy.conf` 신규 — 실기동 검증), 외부 노출+도메인=Caddy 권장(자동 HTTPS가 실제로 동작하는 유일한 경우), 외부+nginx도 허용(certbot 운영 기록 조건). 기본 구성의 root 컨테이너 0. non-root STRICT 범위 명시: 우리가 빌드하는 이미지+프록시, 벤더 이미지는 벤더 권한 설계(실측: MariaDB root는 초기화 1초 미만, 데몬은 mysql(999)).
- 베이스 이미지 "버전 고정"의 입도 정의: 최소 메이저 고정, DB만 마이너까지, digest 고정 안 함(재현성은 CI 태그 이미지가 보장).

**변경 파일**: `conventions/docker.md`, `conventions/ops.md`(10번), `scaffolds/templates/nginx-proxy.conf`(신규)·`Caddyfile`·`nginx.conf`·`docker-compose.deploy.yml`, `profiles/project-default.md`, `scripts/verify-templates.ps1`, `rules/dev-rules.md`, `README.md`, `docs/OVERVIEW.md`

---

## 3. 개발 모드를 컨테이너 실행 기준으로 정합 (7c2204a)

기존: 7절 Vite 프록시 지침(`loadEnv`로 `API_PORT` 읽기)이 호스트 실행 전제 — dev override는 client를 컨테이너로 띄우므로 `localhost`는 자기 자신이고 루트 `.env`는 빌드 컨텍스트 밖. 지침대로 하면 개발 모드 `/api/*` 전멸. 4-1 표의 `env_file: .env`는 템플릿에 없고 불필요(시크릿까지 통째 주입).
변경: 프록시 대상 = **compose 서비스명 + 내부 포트 상수**(`http://server:3000` — Caddyfile과 같은 규약, 개발·배포가 같은 방식으로 라우팅). dev의 server도 배포와 같은 **non-root**(`user: node` — builder에 uploads 선생성 전제. client는 Vite 캐시가 root 소유 node_modules에 써 EACCES 실측, Spring은 builder에 비루트 사용자 없음 — 둘 다 배포 모드 로컬 검증이 잡는다). **Windows bind mount 파일 이벤트 미전달** 함정 문서화(폴링 전환 — 이걸 모르면 개발자가 컨테이너 개발을 포기해 dev/prod parity가 마찰로 무너진다).

**변경 파일**: `conventions/docker.md`(4-1·7절), `scaffolds/templates/docker-compose.dev.yml`

---

## 4. 언어(TS/JS)를 기본값 없는 시작 결정으로 (f20d2fe, c35c4fd)

기존: 체크리스트 1은 "반드시 묻는다"인데 프로필이 같은 항목을 [고정]으로 답해 실제로는 묻지 않았다(프로필이 체크리스트를 무력화 — 프록시 Caddy 고정과 같은 구조). 백엔드 언어는 묻는 자리 자체가 없었다.
변경: 언어를 프로필 [확인]으로 이동, **기본값 제거**(프론트·백엔드 대칭). react.md·express.md 0절의 "TS 기본"을 "시작 시 확인"으로 — 기존 근거(TS의 컴파일 타임 강제)는 폐기하지 않고 "선택의 판단 재료"로 격하.

파급 정리(1차 수정에서 "TypeScript" 단어만 grep해 파일명·도구·확장자를 놓친 것을 2차로 정리): **JS용 ESLint 템플릿 2종 신설**(tseslint 계층만 제거, 커스텀 규칙 전부 유지 — JS에서 빠지는 것은 `any` 금지뿐), design.md `@` alias TS/JS 분기(`jsconfig.json`), express.md 실행/빌드 JS 경로(`node --watch`), react.md 네이밍 확장자 분리, testing.md `*.test.*`.

**변경 파일**: `profiles/project-default.md`, `conventions/react.md`·`express.md`·`design.md`·`testing.md`, `scaffolds/default.md`, `scaffolds/templates/eslint.config.client-js.mjs`·`eslint.config.server-js.mjs`(신규), `skills/new-project/SKILL.md`, `docs/OVERVIEW.md`

---

## 5. 배치 알림·마이그레이션 정합 (3d76468, 21af847)

기존: batch.md 3절이 알림 주체를 ops.md 7절에 위임 — 7절은 헬스 폴링(서버 생존)만 다뤄 배치 실패는 그 경로에 나타나지 않는다. "알림이 없는 배치는 배포하지 않는다"를 지켰다고 믿으면서 실제 경로는 0인 상태(1절과 같은 "받는 쪽에 기능이 없는 위임"). Flyway는 3곳이 서로 다른 방식(STRICT 금지 / 기동 시 옵션 제시 / 템플릿은 독립 컨테이너)이었고, 별도 실행의 근거 "동시 실행 경쟁 방지"는 부정확(Flyway가 DB 락으로 스스로 방지).
변경:
- 배치 알림 **2층 방어**: 층1 = 배치가 실패를 스스로 알림, 층2 = `batch_history` 조회 엔드포인트를 감시 도구가 폴링(cron 미기동·이미지 실패·OOM은 층2만 잡는다). **`/health`에 넣는 것 STRICT 금지**(배치 실패 → 앱 재시작 루프). 수신자는 개발팀(배치 실패는 남이 판단해줄 수 없다). ops.md 7절에 경계 표시.
- 마이그레이션 별도 실행의 근거 교체: 백업 확인·잠금 시간 조정·2단계 배포가 모두 분리를 전제 + Flyway 락 사실을 명시적으로 인정("~와는 별개 문제다"). migration.md 표를 템플릿 현실(독립 컨테이너)로 정합.

**변경 파일**: `conventions/batch.md`, `conventions/ops.md`, `conventions/docker.md`(5절), `conventions/spring.md`(0절), `conventions/migration.md`(5절)

---

## 6. 문서 정비 소품 (061d0fc, 316440e, 5d31c6b, 9f0f2d7)

- testing.md 도구 표에 Java/Spring 행 추가 — Java 전제 규칙은 여러 곳에 있는데 표에만 없었다.
- react.md 3절 예시가 7절 SSOT 규칙(`err.response?.data?.message` 접근식 복제 금지)을 스스로 위반 → `getErrorMessage()` 유틸로 교정. 사람들이 복사하는 것은 예시다.
- 다국어 조정 지시에 `user.locale` 추가 — i18n.md 4절이 요구하는데 스캐폴드 경로에 없어 fallback 사슬 첫 층이 조용히 빠졌다.
- **dev-rules 요약에서 구체 값 제거**(07-18): "bcrypt/argon2"가 auth.md 개정 후에도 낡은 채 남음 — 요약에는 값 금지·STRICT와 결정 항목명만(CLAUDE.md에 규칙화). 2026-07-14 OVERVIEW 인덱스 축소와 같은 구조가 dev-rules에 남아 있던 것.

---

## 7. 자동 검증 신설 — check-refs.mjs (21dd244)

기존: 문서 간 "X.md N절" 참조 193건의 정합을 사람 정독에만 의존.
변경: `scripts/check-refs.mjs` 신설 — 절 정의를 수집해 모든 참조를 대조, 깨지면 exit 1(CI·훅 연결 가능). general.md 9절("준수를 보장하는 것은 문서가 아니라 CI의 빨간불")을 저장소 자신에게 적용. 검증: 현재 통과(193건), 일부러 넣은 깨진 참조 2종(없는 절/없는 파일) 검출 확인. 한계 명시: **내용 모순은 못 잡는다**(Flyway 3곳 불일치는 절 번호가 전부 유효했다) — 그 층은 규율+실사용+주기 리뷰가 방어선.

**변경 파일**: `scripts/check-refs.mjs`(신규), `CLAUDE.md`(검증 절), `docs/OVERVIEW.md`

---

## 8. 실기동 검증 총괄 (Docker 29.6.1, 2026-07-17)

문서 수정과 별개로 실제 기동으로 확인한 것:

| 검증 | 결과 |
|---|---|
| 배포 모드 종단 (compose 4컨테이너) | 전부 healthy, 라우팅 4종(`/`·딥링크·`/api`·`/health`), 업로드 쓰기, X-Forwarded-For 전달, proxy UID 101, 프록시만 포트 노출 |
| 개발 모드 (실제 Vite 컨테이너) | `server:3000` 프록시 도달, dev non-root 업로드 쓰기, 폴링 핫리로드(`usePolling` — 호스트 수정 → 컨테이너 감지) |
| Spring (Boot 4.1.0, 2-2절 그대로) | 빌드·uid 999·healthy(127.0.0.1)·볼륨 쓰기·`[::]:8080` 듀얼스택 |
| MariaDB 권한 | 기동 3초 시점 이미 전 프로세스 UID 999 — root는 초기화 순간뿐 |
| ESLint 4종 (TS/JS × client/server) | 위반 18종 전부 검출, 정상 코드 오탐 0, UI 선호값 localStorage 허용 확인 |
| nginx 프록시 (신규 템플릿) | 라우팅 3종 + 헤더 전달, UID 101 |

**검토 후 철회한 지적** — deploy의 migrate/batch 변수 `:?` 가드 누락(F): 실검증 결과 base의 가드가 전체 config 로드 시 항상 먼저 평가되어 "조용히 빈 값" 시나리오가 성립하지 않음. 가드 추가는 오히려 중복.

---

## 커밋 코멘트

```
@@ 2026-07-17 @@
컨벤션 전수 정비 — 인증 책임 재정의·컨테이너 non-root 완결·프록시/언어 선택제·자동 검증 신설 (18커밋)

■ 인증
- 위임 시 잠금·시도 제한을 우리 책임으로 (기준: 자격증명이 우리를 거치는가)
- IP rate limit 검토 후 폐기(NAT 연대책임) → 흔한 비밀번호 차단으로 대체
- 해시 파라미터 최소선 (bcrypt cost 12 / argon2id)

■ 컨테이너
- 정적·프록시 non-root 완결, 볼륨 소유권 선생성(EACCES 재현·수정), HEALTHCHECK 127.0.0.1 승격
- 프록시 선택제 (사내망 nginx-unprivileged / 외부 노출 Caddy — ACME 도달성 기준)
- 개발 모드 정합 (서비스명 프록시·dev non-root·폴링)

■ 시작 결정
- 언어 TS/JS 기본값 제거 + JS ESLint 템플릿 2종 (프로필-체크리스트 충돌 해소)

■ 배치·마이그레이션
- 배치 알림 2층 방어 (ops 7절 위임 제거, /health 금지), Flyway 근거 교체·표 정합

■ 검증
- check-refs.mjs 신설 (참조 193건), 배포/개발/Spring 실기동, ESLint 4종 실측
```
