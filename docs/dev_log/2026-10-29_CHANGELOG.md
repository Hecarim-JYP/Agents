# 변경 이력 — 2026-10-29

> 작업 베이스: 2026-10-27 커밋 55660ed 이후.
> 핵심 주제: **① Node 26 LTS 진입 확인 ② Node 24와 같은 동작인지 재실측 ③ 기본값 24 → 26 전환**
> 예약 작업 "Node 26 LTS 전환 재검증"(2026-10-20 사용자 결정: "Node는 24로 먼저, 10-28 LTS 진입 후 26으로")으로 수행했다.

---

## 1. Node 26 LTS 진입 확인

기존: 기본값은 Node 24였다. 2026-10-20 대조 때 Node 26은 아직 Current였고, 24는 2026-10-20에 유지보수 단계로 넘어갔다.
변경: `nodejs.org/dist/index.json`의 v26.13.0(2026-10-28)이 `lts: "Lithium"`이다. Node.js Release 일정(`nodejs/Release` schedule.json)에서 v26은 LTS 2026-10-28, 유지보수 2027-10-20, **지원 종료 2029-04-30**이다(v24는 2028-04-30).

---

## 2. 재실측 — Node 24.22.2와 26.13.0을 같은 표본으로 비교

두 버전을 공식 배포본에서 받아 `SHASUMS256.txt`로 검증한 뒤, 2026-10-20과 같은 묶음을 양쪽에서 돌렸다. **모든 항목이 같다. 26에서만 다르게 동작하는 것과 새 경고(Deprecation·Experimental)는 없다.**

| 묶음 | 방법 | 결과 (24 / 26) |
|---|---|---|
| 레시피 6종 (t1·t3·t4·order·mail·unsub3) | 같은 lockfile로 버전마다 새 `npm ci`(bcrypt·sharp 네이티브 포함), Redis 6390 | 6종 모두 exit 0, 출력 동일(시간·포트만 지운 diff). 오류 응답 형식·rate limit(메모리·Redis)·zod·file-type 위장 판별·bcrypt·sharp 픽셀 상한·trust proxy·웹훅 rawBody·DKIM/SPF/DMARC 판정이 같다 |
| Vite 클라이언트 (React TS) | `npm ci` → `npm run build` → `npm run lint` → `npm test` | 전부 exit 0. 빌드 산출물 파일명 해시까지 같다, Vitest 1/1 |
| 훅·업그레이드·ESLint 템플릿 | `scripts/test-hooks.mjs`·`test-upgrade.mjs`·`test-eslint-templates.mjs`(실제 패키지 설치) | 16 / 47 / 116항목 — 두 버전 같은 수로 통과 |
| docker.md 2-1절 런타임 단계 | `node:24-slim`·`node:26-slim` 빌드 → `--health-interval=2s` 실행 → `docker stop` | 둘 다 healthy(2~3초), `node`(uid 1000) 실행, 업로드 폴더 소유자 `node`, `NODE_ENV=production`, SIGTERM → exit 0(약 0.2초, 종료 로그 출력). 이미지 안 Node는 v26.13.0 |
| docker.md 2-1절 builder 단계 명령 | 이미지 안에서 `npm ci` → `npm run build` → 업로드 폴더 생성 | 둘 다 성공 |
| 이미지 내용 (문서의 실측 서술) | `fc-list`·`/ms-playwright`·chromium 유무 | 둘 다 없음 — pdf-output.md·seo.md 서술이 26에서도 그대로 사실 |
| 저장소 검사 | check-refs·check-rules-sync (Node 26) | 통과 |

- 이 환경의 컨테이너는 프록시·CA 설정이 없어 `docker build` 안의 `npm ci`가 레지스트리에 닿지 못한다(두 버전 같은 지점에서 실패 — 버전과 무관). 그래서 이미지는 10-20처럼 런타임 단계만, 의존성은 호스트에서 설치해 복사했다(레지스트리 접근 두 줄만 바꿈). builder 단계 명령은 컨테이너를 호스트 네트워크·프록시·CA로 따로 실행해 확인했다.

---

## 3. 기본값 24 → 26

`node scripts/check-versions.mjs`가 "node 24 → 26"으로 가리킨 곳 **15곳 전부**를 고쳤다. 10-21 기준 11곳에, 그 뒤 생긴 워크플로(eslint-templates·template-audit)와 verify.yml의 job이 더해졌다. 고친 뒤 check-versions는 **0건**이다(보류 5건은 MariaDB 11.4 의도된 고정).

| 파일 | 내용 |
|---|---|
| `conventions/docker.md` | 고정 원칙의 예시와 2-1절·2-3절 Dockerfile의 `node:24-slim` 4곳 → `node:26-slim` |
| `conventions/features/pdf-output.md` · `seo.md` | 이미지 실측 서술의 `node:24-slim` → `node:26-slim` (26에서 재측정해 같음을 확인) |
| `scaffolds/default.md` | test.yml·audit.yml 템플릿의 `node-version: 24` → `26`. CLAUDE.md 템플릿 "운영 정보" 예시 `Node 24 (2028-04-30)` → `Node 26 (2029-04-30)` |
| `.github/workflows/verify.yml`(4곳)·`verify-windows.yml`·`eslint-templates.yml`·`template-audit.yml` | 이 저장소 CI의 `node-version: '24'` → `'26'` |

- 고치지 않은 것: general.md 8-1절 정책 문구(값이 없다). 날짜가 붙은 실측 기록("실측 2026-10-20 (Node 24.22 …)")은 당시 조건이라 그대로 둔다. default.md의 "실행 런타임이 Node 24인 Actions 메이저"는 액션 자체의 런타임 이야기라 대상이 아니다. pdf-output.md의 "Playwright 이미지 — Node 24"는 그 이미지에 든 Node다.
- 기존 프로젝트로 옮기는 단계(`/project-upgrade`)는 넣지 않는다. general.md 8-1절은 지원 종료 6개월 전에 업그레이드를 계획하라고 한다 — Node 24 프로젝트는 2027-10-30 전후로 계획하면 되고, 각 프로젝트 CLAUDE.md의 "운영 정보" 지원 종료일이 그 시점을 알린다.

**변경 파일**
- `conventions/docker.md`, `conventions/features/pdf-output.md`, `conventions/features/seo.md`, `scaffolds/default.md`
- `.github/workflows/verify.yml`, `verify-windows.yml`, `eslint-templates.yml`, `template-audit.yml`

---

## 4. 검증

| 확인 | 결과 |
|---|---|
| check-versions | 낡음 0건 (고정값 92건, 보류 5건) |
| check-refs · check-rules-sync (Node 26) | 통과 |
| verify-templates.sh | 통과 — 두 모드 compose 병합·변수 치환 정상 |
| install.sh | exit 0, 바꾼 문서의 설치본이 저장소와 같음 |
| 인코딩 | 바꾼 파일에 BOM·CRLF 없음, `*.ps1` BOM 유지 |
| CI (push 후) | verify·verify-windows·eslint-templates·template-audit — Node 26으로 실행 |

---

## 커밋 코멘트

```
@@ 2026-10-29 @@
Node 26 LTS 진입 확인·재실측 후 기본값을 24에서 26으로

■ 실측 (24.22.2 / 26.13.0 동일)
- 레시피 6종(새 npm ci), Vite 빌드·lint·Vitest, 훅·업그레이드·ESLint 템플릿 시험
- node:26-slim 런타임 healthy·non-root·SIGTERM, builder 단계 명령, 이미지 내용

■ 기본값 전환
- check-versions가 가리킨 15곳 + CLAUDE.md 템플릿 지원 종료일 예시(2029-04-30)
```
