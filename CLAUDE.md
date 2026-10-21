# JYP Agents — 저장소 유지보수 규칙

Claude Code의 규칙·컨벤션·스킬·훅을 버전 관리하는 저장소. **이 문서는 "이 저장소를 고칠 때" 지킬 규칙만 담는다** — 구조·사용법 설명은 [README.md](README.md), 전체 인덱스는 [docs/OVERVIEW.md](docs/OVERVIEW.md)에 있으니 여기에 다시 쓰지 않는다.

⚠ `conventions/`·`rules/`의 내용은 **다른 프로젝트에 적용할 규칙**이고, 이 문서는 **이 저장소 자체의 작업 규칙**이다. 둘을 섞지 않는다. (이 저장소에는 애플리케이션 코드가 없으므로 `rules/dev-rules.md`를 import하지 않는다.)

## 수정 사이클 (MANDATORY)

```
저장소 수정 → .\install.ps1 재실행 → 검증 → 커밋 → push
```

- **`install.ps1` 재실행을 빠뜨리지 않는다.** 규칙의 소비 지점은 저장소가 아니라 설치 경로(`~/.claude/jyp/` 등)다 — 재설치하지 않으면 수정한 규칙이 실제로는 적용되지 않는다. "고쳤는데 반영이 안 된다"의 원인 대부분이 이것이다.
- 다른 기기: `git pull` → `install.ps1` (훅 등록까지 자동).

## SSOT (이 저장소의 존재 이유)

- **같은 내용을 두 곳에 쓰지 않는다.** 규칙 본문은 해당 컨벤션 파일에만 있고, `docs/OVERVIEW.md`는 **인덱스와 링크만** 둔다. 스킬은 절차를 요약하지 않고 스캐폴드를 가리킨다.
- **레시피 목록은 `features/catalog.md` 한 곳에만** 둔다 — `dev-rules.md`·`README.md`에 레시피 이름을 나열하지 않는다 (2026-10-21 확정). 근거: 차수마다 dev-rules 한 줄이 기능 이름 50개 가까이로 불어났고(모든 프로젝트에 항상 로드되는 파일), 레시피 하나를 추가할 때마다 세 곳을 고쳐야 했다.
- **`rules/dev-rules.md`의 컨벤션 요약에는 구체 값(알고리즘명·초·개수·버전)을 쓰지 않는다 — 강한 금지(STRICT)와 결정 항목명만 남긴다** (2026-07-18 확정). 값은 컨벤션이 바뀔 때마다 낡지만 금지는 잘 안 변한다 — 실제로 `bcrypt/argon2` 요약이 원문 개정(argon2id·파라미터 최소선) 후에도 낡은 채 남았다. 컨벤션의 STRICT 항목을 신설·폐기하면 dev-rules 요약을 함께 확인하고, dev-rules 머리 주석의 **요약 확인일**을 올린다 — `scripts/check-rules-sync.mjs`가 CI(push/PR)에서 확인일보다 늦게 확정된 STRICT·MANDATORY를 나열하며 실패한다 (2026-10-21 — 8~10차가 7건을 빠뜨렸다).
  - 근거: 요약본을 두 곳에 두면 반드시 어긋난다. 실제로 OVERVIEW의 컨벤션 요약이 원문과 불일치("보안 체크리스트 9항목" vs 실제 10항목)를 만들어 2026-07-14에 인덱스로 축소했다.
- **도구로 강제할 수 있는 규칙은 도구로 옮긴다** (general.md 9절) — 새 규칙을 쓰기 전에 "ESLint/Checkstyle/CI로 검사할 수 있나?"를 먼저 묻는다. 가능하면 `scaffolds/templates/eslint.config.*.mjs`에 룰로 추가하고 문서에는 근거만 남긴다.
- **되돌리기 어려운 결정**(스키마·API 계약·인증 소스 등)을 새로 발견하면 `scaffolds/default.md`의 시작 결정 체크리스트에 추가한다 — 이 표가 그런 결정들의 레지스트리다.

## 이식성·중립성

- **참조 경로는 클론 위치가 아니라 설치 경로(`~/.claude/jyp/...`) 기준**으로 쓴다. 저장소 안에 `C:\Users\...` 같은 절대 경로를 쓰지 않는다 — 여러 기기에서 클론해 쓴다.
- **컨벤션 문서에 특정 프로젝트명·이슈 ID를 인용하지 않는다.** 근거는 "어떤 버그가 나는지"로 일반화해서 쓴다.
- 규칙에는 **근거(어떤 사고에서 나왔는지) + STRICT/MANDATORY 마커 + 확정 날짜**를 병기한다.

## 인코딩 (반복해서 사고가 난 지점)

| 파일 | 규칙 |
|---|---|
| `install.ps1` | **UTF-8 BOM 필수** — 없으면 PowerShell 5.1에서 한글이 깨진다 (모든 `*.ps1` — `verify-windows.yml`이 5.1 파서로 검사) |
| Actions `shell: powershell`의 `run:` 블록 | **ASCII만** — 러너가 스텝 스크립트를 BOM 없이(또는 콘솔 코드 페이지로) 저장해 5.1이 한글을 깨뜨린다 (actions/runner `ScriptHandler.cs`, 2026-10-21 확인). 한글 설명은 YAML 주석에 |
| `.env`, `settings.json` | **BOM 금지** — BOM이 있으면 compose가 첫 줄 키를 못 읽고, 설정이 조용히 무시될 수 있다 |
| 스크립트·템플릿 | 줄바꿈 LF (`.gitattributes`가 정규화) |

## 검증 (문서로 결정하지 말고 돌려본다)

이 저장소의 산출물은 **실제로 돌려서** 검증한다. 종이 검증만으로는 안 보이는 결함이 반복해서 나왔다(2026-07-14 실검증에서 12건).

- **문서 참조**: `node scripts\check-refs.mjs` (문서끼리 "X.md N절"로 193곳을 가리킨다 — 절을 개편·삭제하면 조용히 깨진다. 절 번호를 건드렸으면 반드시 실행. **CI(`.github/workflows/verify.yml`)가 push/PR마다 자동 실행하지만, 로컬에서 먼저 돌려 잡는 게 빠르다**)
- **compose 템플릿**: `.\scripts\verify-templates.ps1`(Windows) / `./scripts/verify-templates.sh`(Mac/Linux) (임시 폴더 조립 + 두 모드 `docker compose config`)
- **ESLint 템플릿**: 위반 코드를 일부러 만들어 검출되는지 + 정상 코드에서 오탐이 없는지 둘 다 확인 — **규칙마다 하나씩** 확인한다. `import-x/no-cycle`(2026-10-21 이전 `import/no-cycle`)처럼 설정(파서·리졸버)이 없으면 에러 없이 조용히 꺼지는 규칙이 있다 (2026-07-17 검증이 이 규칙을 빠뜨려 TS에서 3개월간 무력이었다 — 2026-10-19 발견)
- **Spring 빌드 템플릿**(`build.gradle`·`checkstyle.xml`): 바꾸면 템플릿 그대로 새 프로젝트를 만들어 `./gradlew check`(정상 통과 + 순환·위반 검출)까지 돌린다
- **버전 고정값**(템플릿·문서의 이미지 태그·플러그인·패키지 메이저·Actions·런타임): `node scripts/check-versions.mjs`로 현행 배포본·LTS 정책(general.md 8-1절)과 대조한다 — **CI(verify.yml)가 주 1회 자동 실행**하고, 차수 작업 때도 로컬에서 돌린다. 새 이미지를 템플릿에 넣으면 스크립트의 `IMAGES`에 정책을 추가하고(안 하면 "규칙 없음"으로 실패), 일부러 최신이 아닌 값은 고정 사유를 조회로 확인하게 하거나 `HOLDS`에 사유·기한과 함께 둔다 — 고정값은 조용히 낡는다(2026-10-19: nginx 1.27·Flyway 10·Spotless 6.25·MyBatis 4.0.x 고정 규칙이 모두 낡아 있었다 / 2026-10-21: CI 템플릿의 Actions가 전부 Node 20 런타임 — 수동 점검 범위 밖이었다)
- **백업 스크립트**(`backup.sh`·compose `backup` 서비스): 바꾸면 템플릿 그대로 조립한 프로젝트에서 백업 → 복원(체크섬 대조)과 실패 경로(DB 비밀번호 오류·기록 테이블 없음·디스크 기준 초과·디스크 가득 참)의 종료 코드를 확인한다
- **취약점 검사 템플릿**(`audit.yml`·`osv-lock.gradle`·`build.gradle`의 보안 패치 덮어쓰기): 바꾸면 act로 표본 프로젝트에 돌려 **취약한 대조군은 실패하고 release가 push하지 않는지 + 깨끗한 쪽은 push까지 가는지** 둘 다 확인한다
- **운영 감시 엔드포인트**(batch.md 3-1절 코드·프록시 템플릿의 `/api/ops/` 제한): 바꾸면 두 스택을 실제 DB에 붙여 판정 시나리오(기록 없음·오래됨·마지막 실패·실행 중 멈춤·정상·outbox)와, 외부 대역에서 우회 경로(대소문자·이중 슬래시·인코딩)까지 403인지 확인한다
- **템플릿 취약점 검사**(`template-audit.mjs`·`template-audit.yml`): 템플릿 `build.gradle`·audit.yml 템플릿을 바꾸면 push 때 자동 실행된다 — 대조군(알려진 취약 의존성)이 검출되는지까지 본다
- **비밀값 검사**(test.yml `secrets` job·`.gitignore` 템플릿): 바꾸면 비밀값을 심은 표본(지운 파일 포함)이 검출되고 템플릿 그대로의 표본은 0건인지 확인한다
- **PowerShell 스크립트**(`*.ps1`): 이 환경에 5.1이 없으면 push 후 `verify-windows.yml`(Windows 러너의 5.1 — 인코딩·install 결과의 install.sh 대조·verify-templates.ps1) 결과로 확인한다 — push·PR마다 자동 실행된다(약 30초)
- **훅**: 깨진 코드로 exit 2(검출), 정상 코드로 exit 0(오탐 없음)을 각각 확인. 훅에 stdin으로 넣는 JSON은 **BOM 없이** 만든다(BOM이면 파싱 실패로 조용히 통과한다)
- 스택별 규칙(Dockerfile·빌드·헬스체크)을 바꾸면 그 스택을 실제로 기동해 확인한다

## Git

- 커밋 메시지: `타입: 한글 요약` (feat/fix/refactor/docs/chore), 커밋 하나 = 논리적 변경 하나.
- **커밋 메시지에 `Co-Authored-By` / `Claude-Session` 트레일러를 붙이지 않는다** (2026-07-14 확정).
- 요청 없이 push하지 않는다. 히스토리 재작성·강제 push는 사용자 확인 필수.

## 작업 정리

`/work-log` — changelog는 `docs/dev_log/YYYY-MM-DD_CHANGELOG.md`에 **같은 날짜면 누적**한다. 이 저장소에는 CLAUDE.md 갱신 대상(프로젝트 규칙)과 백로그가 없으므로 해당 단계는 건너뛴다.
