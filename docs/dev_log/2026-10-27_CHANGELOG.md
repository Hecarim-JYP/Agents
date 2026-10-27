# 변경 이력 — 2026-10-27

> 작업 베이스: 2026-10-21 11차 검토 커밋 2498847 이후.
> 실제 개발 중 훅 때문에 시간이 크게 늘어난 문제 세 가지(사용자 보고)를 재현하고 고쳤다.

---

## 1. 훅 성능 결함 3건 (fix)

### 1-1. 원인 — 재현으로 확인

| # | 보고된 문제 | 원인 | 재현 |
|---|---|---|---|
| ① | 시간 초과를 "테스트 실패"로 처리해 턴을 막음 | `execSync`의 timeout 오류(`ETIMEDOUT`)를 테스트 실패와 같은 `catch`에서 받아 exit 2 | 한도를 5초로 줄인 복사본 — `[test] 턴 종료 전 테스트 실패 — 고치고 종료하세요: spawnSync /bin/sh ETIMEDOUT`. 고칠 것이 없는데 Claude가 한 번 더 이어서 작업한다 |
| ② | 시간 초과가 나도 테스트가 뒤에서 계속 돎 | `execSync`의 timeout은 `/bin/sh`만 죽인다 | Vitest: `npm test`(ppid 1)·`vitest`·워커가 훅 종료 뒤에도 생존. Gradle: `gradle-wrapper.jar` 클라이언트(ppid 1)가 살아 있어 데몬의 테스트 JVM이 48초 뒤에도 계속 돎 |
| ③ | 편집 훅이 편집마다 프로젝트 전체를 lint | `npm run -s lint`(템플릿 기준 `eslint .`)를 그대로 실행 | 파일 400개 표본에서 편집 1회당 3.8초 |

Gradle 보충 실측: 클라이언트의 프로세스 그룹에 SIGINT·SIGTERM·SIGKILL 중 무엇을 보내도 데몬이 2초 안에 빌드를 취소하고 테스트 JVM을 끝냈다. 데몬 자체는 남는다(재사용 대상). 즉 **클라이언트까지 끝내면 충분하다**.

### 1-2. 변경

- `hooks/run-command.mjs` (신규, 훅으로 등록하지 않는 공용 모듈 — install이 `hooks/*.mjs`를 복사하므로 설치 경로가 같다)
  - `spawn` + 직접 관리하는 시간 한도. POSIX는 `detached`로 새 프로세스 그룹을 만들어 `kill(-pid)`(SIGTERM → 3초 → SIGKILL), Windows는 `taskkill /T /F`
  - 결과를 `ok / fail / timeout / error`로 나눠 돌려준다. 시간 초과와 실패를 구분하는 것이 ①의 전제다
  - `notifyUser()` — exit 0 + stdout JSON `systemMessage`로 사용자에게만 경고한다(공식 문서: "Warning message shown to the user", Stop에서 버려지지 않음)
- `hooks/stop-test.mjs`: 실패만 exit 2. 시간 초과·실행 불가는 exit 0 + 경고. 한도 270초는 등록 timeout(300초)보다 짧게 유지
- `hooks/post-edit-check.mjs`
  - lint 스크립트가 **단일 eslint 호출이고 경로 외 옵션이 `--max-warnings`뿐**이면, 설치된 ESLint로 **편집한 파일만** 검사한다(`--no-warn-ignored`는 ESLint 9+일 때). 그 밖의 lint 스크립트(다른 도구, `-c` 지정, `&&` 연결)는 의미를 다 옮길 수 없어 기존처럼 스크립트 전체를 돈다. 프로젝트 전체 lint는 CI(test.yml)의 몫이다
  - 명령 여러 개가 남은 시간(170초)을 나눠 쓴다. 시간 초과는 막지 않고 경고만 한다
- `scripts/test-hooks.mjs` (신규) + CI: `verify.yml`에 `test-hooks` job, `verify-windows.yml`에 스텝 추가(Windows의 taskkill 경로는 Linux와 달라서 따로 확인)
- 문서: OVERVIEW 4-8절 표·문제 해결, 저장소 CLAUDE.md 검증(훅) 항목, testing.md 6-4절 근거 문구

### 1-3. 검증

| 확인 | 결과 |
|---|---|
| `test-hooks.mjs` 16항목 (판정·마커·시간 초과·프로세스 종료·파일 단위 lint·대체 경로) | 통과 |
| **대조군**: 같은 시험을 수정 전 훅(2498847)에 | **9건 실패** — 시험이 결함을 실제로 잡는다 |
| 실제 Vitest 5.0.5 | 시간 초과 → exit 0 + 경고, 남은 프로세스 0 / 통과 → exit 0 / 실패 → exit 2 + `합계가_맞다` 출력 |
| 실제 Gradle(Spring 템플릿 표본) | 시간 초과 → exit 0 + 경고, 클라이언트·테스트 JVM 0 / 통과 → exit 0 / 실패 → exit 2 + `BrokenTest > 합계가_맞다 FAILED` |
| 실제 ESLint 10.13 + 템플릿 `eslint.config.server-js.mjs`, 파일 400개 | 편집 1회 **3.8초 → 0.5초**(3회 측정). `no-unused-vars`·`import-x/no-cycle` 위반은 파일 단위에서도 exit 2, `dist/`(무시 대상)는 exit 0 |
| `install.sh` 재실행 후 설치본(`~/.claude/hooks/`)으로 실행 | 공용 모듈 import 정상, settings.json 등록 2건 유지 |
| check-refs · check-rules-sync | 통과 |
| Windows(`taskkill` 경로) | verify-windows run 12(windows-latest, Node 24) — `test-hooks.mjs` 16항목 통과(시간 초과 뒤 손자 프로세스까지 종료 포함) |
| CI | verify run 59(`test-hooks` job 포함)·verify-windows run 12 성공 (커밋 15b1618) |
| 작업 기기 재현 — 수정 전(2498847) 설치 → `git pull` → `install.sh` | 설치본 시험: 수정 전 **9건 실패** → pull·install 뒤 **통과**, `run-command.mjs` 설치됨, settings.json 훅 등록 1건씩(중복 없음) |
| 설치본 Windows 시험 (`test-hooks.mjs "$env:USERPROFILE\.claude\hooks"`, verify-windows에 상설 스텝 추가) | run 14 — install.ps1이 설치한 사본 16항목 통과 (커밋 70a4728) |

### 1-4. 남은 것 (이번에 하지 않음)

- typecheck는 여전히 편집마다 프로젝트 전체(`tsc --noEmit`)를 돈다. 파일 단위로는 tsconfig 기준 검사가 안 된다
- 실패 → 이어진 작업 → `stop_hook_active`로 건너뛴 턴에서 다시 생긴 마커는 다음 턴 끝에 테스트를 한 번 더 돌린다(수정 확인이 한 턴 늦어지는 대신 생략되지는 않는 동작이라 유지)
- Spring 테스트 직렬 실행(Gradle·JUnit 기본값) — 실측: 같은 표본 19초 → JUnit 클래스 병렬 8초. DB 테스트 잠금 규칙과 함께 정해야 해 별도로 진행한다

---

## 2. Spring 테스트 클래스 병렬 실행 (feat)

### 2-1. 배경

Spring 템플릿에 병렬 설정이 없어 Gradle·JUnit 기본값(테스트 JVM 1개, 병렬 꺼짐)으로 클래스가 하나씩 차례로 돌았다 — 종료 훅이 매 턴 이 직렬 `gradlew test`를 돌린다. Node(Vitest)는 기본이 파일 단위 병렬이라 해당 없음.

### 2-2. 병렬만 켜면 깨지는 것 (실측, Boot 4.1.1·JUnit 6·Java 25, 4코어 표본)

| 경우 | 잠금 없이 병렬 (3회) |
|---|---|
| 같은 테스트 DB 테이블을 쓰는 `@SpringBootTest` 두 클래스 | 3회 모두 실패 — `expected: <3> but was: <8>` |
| 같은 컨트롤러의 `@WebMvcTest` 두 클래스 | 같은 `@MockitoBean` 인스턴스를 받아(직렬 실행에서도 identityHashCode 동일 — 컨텍스트 캐시 공유) 상대의 stub·초기화에 덮여 9~10건 실패 |

### 2-3. 변경

- `scaffolds/templates/build.gradle`: test 블록에 JUnit 스레드 병렬(클래스끼리 동시, 같은 클래스의 메서드는 차례대로). 포크 병렬(`maxParallelForks`)은 포크마다 JVM·컨텍스트를 새로 띄워 이득이 작아 쓰지 않는다(19초 → 13초, JUnit 병렬 8초)
- `spring.md` 7절: 병렬 규칙 (STRICT, 2026-10-27) — 테스트 DB·`@SpringBootTest`·DB 슬라이스 클래스는 `@ResourceLock("test-db")`, `@WebMvcTest`는 컨트롤러당 한 클래스(`@Nested`로 나눔). `ArchitectureTest` 코드에 두 규칙을 강제하는 테스트 추가(Spotless 적용 후 형태 그대로 — 복사만으로 `check` 통과)
- `testing.md` 0절 구성 행에 연결, `dev-rules.md` 테스트 줄에 금지 항목명 + 요약 확인일 2026-10-27

### 2-4. 검증

| 확인 | 결과 |
|---|---|
| 규칙을 지킨 표본 — 병렬 3회 / 직렬 2회 | 병렬 11.1~11.6초, 3회 모두 통과 / 직렬 20.3~20.8초. DB 테스트끼리는 겹치지 않고 나머지와는 겹침(결과 XML 시작 시각) |
| `ArchitectureTest` 위반 검출 | 잠금 없는 `DbRaceATest`·`DbRaceBTest` 나열 / 같은 컨트롤러 `@WebMvcTest` 3개 나열 / `@JdbcTest`(jdbc-test 의존성 추가)도 검출 — 애너테이션을 이름으로 찾아 의존성이 없는 프로젝트에서도 컴파일된다 |
| 순환 의존 대조군 (`cyc.a` ↔ `cyc.b`) | `noCycles() FAILED`로 `check` 실패 — 기존 검사 유지 |
| 문서 코드를 그대로 꺼내 최종 템플릿과 합친 새 표본 | `spotlessApply` 없이 `./gradlew check` 통과 |
| 종료 훅(설치본) — 병렬 설정 표본 | 실패 테스트 → exit 2 + `BrokenTest > 합계가_맞다 FAILED` / 정상 → exit 0 |
| check-refs · check-rules-sync | 통과 |

### 2-5. 남은 것

- **기존 Spring 프로젝트에는 install로 반영되지 않는다** — 템플릿이라 새 프로젝트에만 적용된다. 기존 프로젝트는 build.gradle 3줄 + ArchitectureTest 두 테스트 + DB 테스트 잠금을 직접 옮긴다
- Node(Vitest)도 파일 단위 병렬이 기본이라, 테스트 DB를 쓰는 테스트 파일끼리 같은 문제가 생길 수 있다 — 이번 범위 밖(확인·규칙 미정)
- 테스트 JVM 힙 기본값 512MB — 컨텍스트가 많은 프로젝트에서 부족하면 `maxHeapSize`(build.gradle 주석에 안내)

---

## 3. Node(Vitest) 테스트 — 워커마다 테스트 DB (feat)

### 3-1. 문제 (재현)

Vitest는 테스트 파일을 워커(프로세스)마다 병렬로 돌린다(기본값). 테스트 DB 하나를 공유하면 파일마다 하는 데이터 초기화가 다른 파일의 데이터를 지운다 — Vitest 5.0.5·MariaDB 11.4, 같은 테이블을 초기화·삽입하는 파일 6개: **18개 중 16~17개 실패**(`expected 3 to be 2`, 3회).

### 3-2. 방법 비교 (DB 테스트 파일 6 + 단위 테스트 파일 4, 4코어)

| 방법 | 결과 | 소요 |
|---|---|---|
| 현재 (공유) | 16~17건 실패 | 5.5초 |
| A. `fileParallelism: false` | 통과 | 12.5초 |
| B. DB 테스트만 직렬 (`*.db.test.*` + projects) | 통과 — 이름을 빠뜨리면 다시 깨지고 린트로 못 잡는다 | 10.1초 |
| **C. 워커마다 테스트 DB (채택)** | **통과** | **5.6~6.2초** |

### 3-3. 변경

- 템플릿 3종 신설 (`scaffolds/templates/`) — Express 서버 + 테스트 DB 사용(체크리스트 21-a)일 때 복사
  - `vitest.config.server.mjs` → `server/vitest.config.mjs`: `pool: 'forks'`, globalSetup·setupFiles 연결, 저장소 루트 `.env`를 `process.loadEnvFile`로 읽음(이미 있는 환경변수가 우선 — 실측)
  - `vitest-test-db.global.mjs` → `server/test/setup/test-db.global.mjs`: 워커 수(`maxWorkers`)만큼 `{TEST_DB_NAME}_{n}` 생성(있으면 유지)·권한(root = `TEST_DB_PASSWORD`) → 프로젝트의 `npm run migrate`를 DB마다(미적용분만). `TEST_DB_*`가 하나라도 없으면 실패
  - `vitest-test-db.worker.mjs` → `server/test/setup/test-db.worker.mjs`: 테스트 파일마다 앱의 `DB_*`를 `{TEST_DB_NAME}_{VITEST_POOL_ID}`로 덮어씀 — 앱 코드는 운영과 같은 `DB_*`만 읽는다
  - ⚠ Vitest 5(Vite 모듈 러너)는 globalSetup 안의 오류 스택을 소스맵으로 바꾸다 스스로 실패한다 — mysql2 접속 오류는 catch 전에 `code.charCodeAt is not a function`으로 죽고, 던진 오류는 "No test files found"만 남겼다. 설정 동안 `Error.prepareStackTrace`를 끄고 원인을 `[test-db]`로 먼저 찍는다
- **ESLint 서버 템플릿 결함 수정**: Node 전역(`process`·`console`)이 `**/*.js`(TS는 `**/*.ts`)에만 있어 `.mjs`가 `no-undef`로 실패했다(TS 템플릿 대조군 16건). JS 템플릿은 대상을 `**/*.{js,mjs}`로(사용자 정의 규칙도 `.mjs`에 적용), TS 템플릿은 `**/*.{js,mjs}`에 Node 전역 블록 추가
- `.env.example`에 `TEST_DB_HOST=127.0.0.1`(환경변수 폴백 금지 규칙 — 템플릿이 기본값을 두지 않는다. CI env에는 이미 있음)
- 문서: testing.md 0절(규칙 STRICT 2026-10-27 — Node·Spring 방식 차이와 실측), default.md(Express 생성 절차·test.yml 안내 — `MARIADB_ROOT_PASSWORD` = `TEST_DB_PASSWORD`), express.md 7절(앱은 `DB_*`만, 테스트 분기 금지), dev-rules 금지 항목명, OVERVIEW 템플릿 인덱스

### 3-4. 검증 (스캐폴드와 같은 구조 — 루트 `.env`·`migrations/`, `server/`에 앱·러너·테스트)

| 확인 | 결과 |
|---|---|
| 대조군: 공유 테스트 DB | 22개 중 16~17개 실패 (2회) |
| 템플릿 적용 | 3회 모두 22개 통과, 5.9~6.2초. 워커 DB 3개 생성, 각 `schema_migrations`에 2건(재실행해도 중복 없음), 개발 DB 이름(`probe_dev`)으로는 아무것도 만들지 않음 |
| CI형 (`.env` 없이 job env만) | 통과 |
| 환경변수 우선순위 (`.env` 비밀번호 틀림 + env 정상) | 통과 — env 우선 / 대조: `.env`만 틀리면 실패 |
| `--maxWorkers=2` · `--no-file-parallelism` | 통과 |
| 실패 경로 — 설정 없음 · `TEST_DB_HOST` 없음 · 비밀번호 틀림 · DB 미기동 · 마이그레이션 SQL 오류 | 모두 exit 1 + `[test-db] 테스트 DB 준비 실패: …` 한 줄로 원인 (마이그레이션은 러너 출력 포함) |
| ESLint — JS 서버 템플릿, `eslint .` (템플릿 3종 + 앱·러너·테스트) | 통과. `.mjs`의 폴백·`console.error` 한 줄 위반 검출. 기존 `.js` 동작(파일 400개 통과·순환 검출) 유지 |
| ESLint — TS 서버 템플릿 | 수정 전 `no-undef` 16건(대조군) → 수정 후 통과, `.ts` 위반 검출 유지 |
| 종료 훅(설치본) | 정상 → exit 0(6초) / 실패 테스트 → exit 2 + `행 수가_맞다` |
| check-refs · check-rules-sync · verify-templates.sh | 통과 |

### 3-5. 남은 것

- Windows에서 globalSetup의 `npm run migrate` 실행(`shell: true`)은 이 환경에서 확인하지 못했다 — **미검증**
- 기존 프로젝트에는 install로 반영되지 않는다(템플릿) — 파일 3개 복사 + `.env`에 `TEST_DB_HOST` + ESLint 설정의 `.mjs` 대상 추가
- (무관) `check-versions`: Spring Boot 4.1.2 출시로 템플릿 4.1.1이 낡음 1건 — 다음 주 정기 실행이 실패한다

---

## 4. Spring Boot 4.1.1 → 4.1.2 (chore)

- 계기: `check-versions` — `org.springframework.boot 4.1.1 → 4.1.2` (외부 출시, 다음 주 정기 실행이 실패할 항목)
- Boot 4.1.2가 관리하는 버전 (Maven Central BOM): Tomcat 11.0.24 → **11.0.27**, Jackson 3.1.5 → **3.1.7**, Flyway 12.4.0(그대로), JUnit Jupiter 6.0.3(그대로)
- 변경
  - 템플릿 `build.gradle`: 플러그인 4.1.2, **Tomcat 덮어쓰기 삭제** — Boot가 같은 11.0.27을 관리(`check-versions` "덮어쓰기 삭제"). Jackson 덮어쓰기 3.1.8은 유지(Boot 3.1.7 < 3.1.8 — 템플릿 규칙: Boot가 이 값 이상을 관리하면 지운다)
  - 현재 고정값 서술만 갱신: build.gradle 머리 주석, spring.md 0·7절("Boot 4.1.2 실빌드 검증"), deploy compose의 Flyway 주석. 날짜가 붙은 과거 실측 기록(4.1.1)은 그대로 둔다
- 검증 (Java 25, 템플릿 그대로 + spring.md ArchitectureTest 코드 + 병렬 규칙 표본)

| 확인 | 결과 |
|---|---|
| `./gradlew check bootJar` | 통과 (테스트 클래스 9개) — 첫 시도는 Maven Central 429(요청 과다)로 의존성 내려받기 실패, 재시도 통과 |
| 실제 해석 버전 (`dependencyInsight`) | spring-boot 4.1.2 · tomcat-embed-core 11.0.27 · jackson-databind 3.1.8 |
| jar 기동 | `/actuator/health` → `UP` |
| 병렬 실행 | DB 테스트끼리 겹치지 않고 나머지와 겹침 (결과 XML 시작 시각) |
| 대조군 — DB 테스트 잠금 제거 / `cyc.a` ↔ `cyc.b` 순환 | `dbTestsHoldTestDbLock() FAILED` / `noCycles() FAILED`, 되돌리면 `check` 통과 |
| `check-versions` | 고정값 86건, 낡음 0건 |
| 의존성 취약점 (OSV) | 이 환경에서는 OSV API가 프록시에 막혀(403) CI로 확인 — `template-audit` run 8 통과(spring-boot 4.1.2·jackson-databind 3.1.8로 해석된 운영 의존성 70개, 알려진 취약점 없음), 대조군(log4j-core 2.14.1) 검출 정상 |

---

## 5. 기존 프로젝트 업그레이드 명령 `/project-upgrade` (feat)

### 5-1. 배경

install은 `~/.claude`만 갱신한다 — 프로젝트에 복사해 둔 템플릿(build.gradle·eslint 설정 등)은 그대로 남아, 1~4부의 개선이 기존 프로젝트에는 들어가지 않는다. 이관 목록을 사람이 손으로 옮기는 대신 명령 하나로 한다.

### 5-2. 구성

- `skills/project-upgrade/upgrade.mjs` — 단계마다 "해당 여부 → 이미 적용 → 적용"을 판정(멱등). 기본은 미리보기, `--apply`로 적용(**git 작업 트리가 깨끗해야 한다** — 업그레이드 변경과 기존 미커밋 변경이 섞이지 않게). 템플릿 코드는 설치 경로의 템플릿·spring.md에서 읽는다(사본 없음). CRLF·BOM 보존
  - 2026-10-27 묶음: A lint 스크립트 형태 확인 / B1 ESLint `.mjs` Node 전역(JS·TS) / B2 워커별 테스트 DB(파일 3개·`.env(.example)`의 `TEST_DB_HOST`·compose·CI·`TEST_DB_*` 직접 읽는 코드 점검) / C1 Boot 4.1.2(Tomcat 덮어쓰기와 근거 주석 정리·CLAUDE.md 운영 정보) / C2 테스트 병렬(build.gradle·ArchitectureTest 교체 또는 덧붙이기·DB 테스트에 `@ResourceLock`)
  - 판단이 필요한 것은 [수동]: 같은 컨트롤러 `@WebMvcTest` 합치기, 기존 vitest 설정과 합치기, CI env, lint 스크립트 단순화
- `skills/project-upgrade/SKILL.md` — 미리보기 → 적용 → [수동] 처리 → 검증(`gradlew spotlessApply`·`check` 2회 / `npm run lint`·`npm test` 2회) → 단계별 커밋 제안
- `scripts/test-upgrade.mjs` + CI(verify.yml `test-upgrade`, verify-windows 스텝) — 예전 템플릿 형태 표본 20항목
- 저장소 CLAUDE.md: 기존 프로젝트에도 필요한 변경이면 이 스크립트에 날짜 묶음 단계를 추가한다(MANDATORY), 검증 항목 추가. OVERVIEW·README·install 안내에 명령 추가

### 5-3. 검증

| 확인 | 결과 |
|---|---|
| 예전 템플릿(2498847)으로 만든 Spring 프로젝트 | 미리보기: 적용 예정 5 · 수동 1(같은 컨트롤러 `@WebMvcTest`), 파일 변경 없음 → 적용 → 수동 처리 → `spotlessApply` + `check` **2회 통과**(DB 테스트끼리 직렬·나머지 병렬). build.gradle은 머리 주석 외에 현재 템플릿과 같음. 재실행: 전부 이미 적용 |
| 사용자 규칙이 있는 ArchitectureTest | 기존 규칙 2개 유지 + 병렬 규칙 2개 덧붙임(쓰는 import만) → `check` 통과(테스트 4개) |
| 예전 템플릿 Node 서버(Express·테스트 DB) | 적용 전 공유 DB 22개 중 18개 실패 → 적용(+ CI env 수동 처리) → `npm run lint` 통과(예전 ESLint 템플릿은 `scripts/migrate.mjs`조차 `no-undef` 12건), `npm test` **2회 22개 통과**, 재실행: 전부 이미 적용 |
| 작업 트리에 미추적 파일 | `--apply` 거부(exit 2) — 실제로 표본 안에 로그를 만들었다가 걸렸다 |
| 설치본(`$HOME/.claude/skills/project-upgrade/upgrade.mjs`, 설치 경로 템플릿) | 문서의 명령 그대로 동작 |
| `test-upgrade.mjs` 20항목 | 통과. 대조군(Tomcat 삭제 단계를 끈 스크립트) → 2건 실패로 검출 |

---

## 6. 정리

- 저장소 CLAUDE.md 검증 절의 문서 참조 수 "193곳" → "720곳(2026-10-27)" — 실제 check-refs 출력과 달라 낡아 있었다. 현재 수는 실행 출력의 "참조 N건"으로 보게 적었다
- 기존 프로젝트 업그레이드: 사용자가 기존 프로젝트 전부에 `/project-upgrade`를 수행했다 (2026-10-27)

---

## 7. `/project-upgrade` 스크립트 결함 2건 (fix) — 사용자 보고(기존 프로젝트에서 실행 중 발견)

| # | 결함 | 증상 | 수정 |
|---|---|---|---|
| 1 | 하위 프로젝트를 고정 이름(`server/`·`client/`·루트)으로만 찾았다 | 하위 폴더 이름이 다른 저장소(예: `*-server/`·`*-web/`)의 루트에서 exit 2. 하위 폴더를 인자로 주면 그 폴더를 루트로 써서 CLAUDE.md·`.github`·compose를 하위에서 찾아 **조용히 "해당 없음"**이 됐다 | 저장소 루트 = `git rev-parse --show-toplevel`(저장소 단위 파일은 항상 여기서). 하위 프로젝트 = 시작 폴더와 그 한 단계 아래의 `package.json`·`build.gradle` 폴더 전부. `.env(.example)`은 프로젝트 폴더 → 저장소 루트 순, vitest 설정의 `.env` 경로는 실제 위치에서 계산. compose는 루트의 `docker-compose*.yml` 전부 |
| 2 | eslint 설정에 `globals.node` 글자가 있으면 Node 서버로 봤다 | 설정 파일에만 Node 전역을 주는 Vite React 클라이언트가 서버로 오판돼 B1 [수동]이 남고, 다시 돌려도 없어지지 않았다(없애려면 의미 없는 설정 변경뿐) | 서버 판정은 의존성으로만(express·fastify·koa·@nestjs/core·@hapi/hapi). **B1은 증상 기반** — 프로젝트의 ESLint를 실제로 돌려 `.mjs`(B2가 만들 파일은 `--stdin`으로 미리)에서 `no-undef`가 나는지로 판정. 안 나면 "해당 없음", 나면 템플릿 형태일 때 적용·아니면 [수동] + 파일 목록. ESLint를 못 돌리면(미설치·설정 로드 실패) 기존처럼 템플릿 형태로 판정 |

- 함께 고친 것: BOM 처리 정규식에 보이지 않는 U+FEFF 문자가 그대로 들어가 있던 것을 `﻿` 이스케이프로. `.env`가 프로젝트 폴더에 있을 때 상대 경로가 `./.env`가 아니라 `.env`로 계산되던 것(보강한 시험이 검출 — 동작은 같았지만 템플릿 표기와 달랐다)
- SKILL.md 1단계: 저장소 루트에서 실행, 폴더 이름과 무관하게 탐색, 저장소 단위 파일은 루트 기준

### 검증

| 확인 | 결과 |
|---|---|
| 보고된 구조 재현(`lims-server/`=Express·eslint 없음, `lims-dev/`=Vite React·설정 파일에만 Node 전역, 루트 CLAUDE.md) | 수정 전: 루트 exit 2 / 인자 우회 시 클라이언트 B1 [수동]. 수정 후: **루트에서 인자 없이 exit 0**, 두 하위 프로젝트 모두 표에(A 해당 없음·이미 적용, B1·B2 해당 없음), [수동] 0건, 2회 실행 결과 동일, 파일 변경 없음 — 보고서의 기대 결과와 같다 |
| `test-upgrade.mjs` | 32항목 통과(기존 20 + 신규 12: 위 구조, 하위 폴더 Spring의 루트 CLAUDE.md 갱신(루트·인자 둘 다), 프로젝트 폴더 `.env`, 루트 테스트 DB + 클라이언트, B1 증상 판정 3종). **대조군**: 수정 전 스크립트는 신규 10건 실패 |
| 실제 ESLint 10.13 (예전 템플릿 Node 서버 표본) | 예전 템플릿 설정 → 적용 예정(`no-undef: scripts/migrate.mjs` + B2가 만들 파일 3개) / Vite식 설정(`npx eslint scripts/migrate.mjs` exit 0) → 해당 없음 / `.mjs`에 규칙이 걸리는 비템플릿 설정(exit 1) → [수동] + 파일 목록 |
| 회귀 — 예전 템플릿 Node 서버에 적용 | `npm run lint` 통과, `npm test` 2회 22개 통과(vitest 설정 `.env` 경로 `../.env`) |
| check-refs · check-rules-sync | 통과 |
