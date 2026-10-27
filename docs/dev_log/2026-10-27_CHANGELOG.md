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
