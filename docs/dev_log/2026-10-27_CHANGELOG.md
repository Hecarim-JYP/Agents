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
| Windows(`taskkill` 경로) | push 후 verify-windows 결과로 확인 — **미수행** |

### 1-4. 남은 것 (이번에 하지 않음)

- typecheck는 여전히 편집마다 프로젝트 전체(`tsc --noEmit`)를 돈다. 파일 단위로는 tsconfig 기준 검사가 안 된다
- 실패 → 이어진 작업 → `stop_hook_active`로 건너뛴 턴에서 다시 생긴 마커는 다음 턴 끝에 테스트를 한 번 더 돌린다(수정 확인이 한 턴 늦어지는 대신 생략되지는 않는 동작이라 유지)
- Spring 테스트 직렬 실행(Gradle·JUnit 기본값) — 실측: 같은 표본 19초 → JUnit 클래스 병렬 8초. DB 테스트 잠금 규칙과 함께 정해야 해 별도로 진행한다
