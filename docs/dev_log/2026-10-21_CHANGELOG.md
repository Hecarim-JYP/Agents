# 변경 이력 — 2026-10-21

> 작업 베이스: 2026-10-20 3부(6차) 커밋 41de905 이후.
> 6차 권고안의 **B(2차 출처 → 원문)** 를 마저 진행했다. 사용자가 클라우드 환경(Default) 네트워크 접근을 **제한됨 + 허용 도메인**으로 바꿔 `www.law.go.kr`·`eur-lex.europa.eu`·`*.token.awswaf.com`(EUR-Lex 브라우저 확인 토큰)을 허용했다.

---

## 1. 정보통신망법 시행령 별표 6 원문 반영 (docs)

- 출처: 국가법령정보센터 별표 파일(PDF) — 「영리목적의 광고성 정보의 명시사항 및 명시방법(제61조제3항 관련)」 <개정 2021. 1. 5.>, 현행 시행령(legalize-kr 2026 시행본)에 붙은 파일
- `marketing-message.md` 1-2절 신설 — 매체별 표(공통·전자우편·음성 외 전자적 전송매체·음성·팩스)
- 원문으로 새로 확인해 반영한 요건:
  - 전자우편: 제목 첫머리 `(광고)`, 본문에 전송자 명칭·전자우편주소·전화번호·주소, **수신거부 안내문과 간편 선택 기술 조치를 한글과 영문으로**
  - 문자·푸시(음성 외): 첫머리 `(광고)` + 전송자 명칭·전화번호(또는 주소), **끝부분에 무료 수신거부 방법 + 비용 무료 명시**
  - 공통: `(광고)`에 빈칸·부호를 끼운 변형 금지, 수신거부 때 연락처 외 정보 요구 금지
- 함정 3행 추가(변형 표기, 한글만 안내, 수신거부 시 추가 정보 요구), 검증 포인트 갱신

## 2. GDPR·ePrivacy·한국 적정성 결정 원문 반영 (docs)

- 출처: EUR-Lex — GDPR(OJ L 119, 영문판), ePrivacy 지침 2002/58/EC 통합본(2009-12-19), 집행위원회 이행결정 (EU) 2022/254
- EUR-Lex는 AWS WAF 브라우저 확인을 거친다 — curl은 빈 202, Chromium(Playwright)으로 열어 확인 토큰을 받은 뒤 본문을 받았다(세션 프록시 경유, TLS 검증 유지)
- `gdpr.md` 1-1절을 원문 확인으로 교체:

| 항목 | 원문 |
|---|---|
| 지역 적용 | 제3조 ② — EU 안의 정보주체에게 재화·서비스 제공(지급 불문) 또는 EU 안 행동 모니터링 |
| 역내 대리인 | 제27조 ①②③ — 예외는 간헐적 + 특수 범주·범죄 정보 대규모 처리 아님 + 저위험(모두), 또는 공공기관 |
| 적정성 결정 | (EU) 2022/254 제1조 — 개인정보 보호법 적용 기관, **제외: 선교 목적 종교단체·후보 추천 목적 정당·신용정보법상 금융위 감독 대상의 개인신용정보 처리** |
| 권리 요구 응답 | 제12조 ③④ — 지체 없이, 늦어도 1개월, 2개월 연장 가능(1개월 안에 사유 통지), 미조치 시 감독기관 민원·사법 구제 안내 |
| 유출 — 감독기관 | 제33조 ①④⑤ — 지체 없이·가능하면 72시간, 저위험이면 면제, 넘기면 지연 사유, 단계적 제공, 모든 유출 기록 |
| 유출 — 정보주체 | 제34조 ①③ — 높은 위험이면 지체 없이, 암호화 등 예외 |
| 쿠키 | ePrivacy 제5조 ③ — 정보 제공 + 동의, 전송·명시 요청 서비스에 꼭 필요한 경우만 예외 |

- `gdpr.md` 3-3절에 **한국 vs GDPR 유출 대응 비교표** — 정보주체 통지는 한국이 더 넓고(모든 유출 72시간), 기관 신고는 GDPR이 더 넓다(저위험이 아닌 모든 유출)
- `privacy-breach.md`·`catalog.md`의 "원문 미확인" 표시 교체
- EDPB 지침 3/2018 — `edpb.europa.eu`는 모든 문서를 `www.edpb.europa.eu`로 308 리다이렉트해 두 호스트를 모두 허용한 뒤 원문(v2.1, 28쪽 PDF)을 받았다. gdpr.md 1-1절 "우연한 제공" 행을 원문으로 교체: 의도적 겨냥에만 적용(예 10 — 미국 전용 앱을 유럽 여행 중 사용 → 적용 안 됨), 위치 기반 맞춤 광고는 행동 모니터링(예 9), 모니터링 예시 목록(행태 광고·마케팅 목적 위치 추적·쿠키/핑거프린팅). **이로써 gdpr.md의 2차 출처 표시는 모두 없어졌다**

## 검증

| 항목 | 결과 |
|---|---|
| `check-refs.mjs` | 통과 |
| `install.sh` 임시 HOME | 설치본 = 저장소 |
| 인코딩 | 변경 파일 BOM·CRLF 없음 |
| `install.ps1` 실행 | **미수행** — PowerShell 없음 |
| main 반영 | fast-forward로 push — 1차 d207320(6차 10-20 커밋 포함), 2차 EDPB 반영 커밋 |

## 커밋 코멘트

```
@@ 2026-10-21 @@
6차 B — 2차 출처를 원문으로 (별표 6 · GDPR · ePrivacy · 한국 적정성 결정)

■ 별표 6: 메일 수신거부 안내 한글·영문 병기, 문자 끝부분 무료 거부 방법, (광고) 변형 금지
■ GDPR: 권리 요구 1개월(+2개월), 감독기관 72시간(저위험 면제), 정보주체는 높은 위험일 때
■ 한국 적정성 결정 제외 범위(금융위 감독 개인신용정보 등), ePrivacy 쿠키 동의
```

---
---

# 2부 — 7차: 정비 (템플릿 버전 점검 · 레시피 목록 단일화)

> 사용자 요청 "7차 내용 보고해" → 권고안(레시피 3+1종·업체 문서 원문화·버전 점검) → "상용 웹앱 개발에 필요한 내용이 맞는지부터 다시 검토해봐, 너무 오버하는 것 같은데" → 재검토 결과 **새 레시피·업체 문서 원문화는 빼기**(재고·예약은 sql.md 8절과 중복, 집계는 프로젝트별, 제조번호·사용기한은 업무 로직, 업체 문서는 착수 시 재확인 규칙이 이미 있음) → "1번·2번만, 레시피는 늘 유연하게 추가할 수 있어야 한다"
> 레시피 추가를 제한하는 규칙은 만들지 않았다 — 오히려 추가할 때 고칠 곳을 줄였다(2절).

## 1. 템플릿 고정 버전 점검 (fix)

| 대상 | 고정값 | 현행 (2026-10-21) | 조치 |
|---|---|---|---|
| Spring Boot · dependency-management · Spotless · Checkstyle · ArchUnit · Gradle | 4.1.1 · 1.1.7 · 8.10.4 · 14.3.0 · 1.5.1 · 9.8.2 | 같음 (Boot 4.2는 마일스톤) | 유지 |
| MyBatis 스타터 · QueryDSL 포크 | 4.1.0 · 7.7 | 같음 | 유지 |
| TypeScript | `~6.0.3` 고정 | 최신 7.0.2, typescript-eslint 8.72 peer `<6.1.0` 그대로 | **고정 유지**(사유 그대로 유효) |
| **ESLint** | **9** + `eslint-plugin-import` | **10.13.0** — **ESLint 9는 2026-08-06 지원 종료**(eslint.org version-support 원본), `eslint-plugin-import` 2.32(2025-06 이후 출시 없음)는 peer `~^9`로 10 미지원 | **ESLint 10 + `eslint-plugin-import-x` 4.17.1**로 교체 |
| nginx · MariaDB · Caddy · Playwright 이미지 | 1.30 · 11.4 · 2 · v1.64.1 | 1.30.6 안정판 · 11.4.13 · 2.11.7 · 1.64.1 | 유지 |
| Flyway 이미지 | 12 | 최신 13.10.3 | **유지** — Spring Boot 4.1.1이 관리하는 Flyway가 12.4.0이라 같은 메이저로 맞춘다(사유를 compose 주석에) |

### ESLint 10 + import-x 검증 (CLAUDE.md "규칙마다 하나씩")

- 템플릿 4종을 저장소에서 그대로 복사한 하네스: 순환(상대경로·`.js` 확장자 경로·`@/` 별칭)·정상 import, `any`, axios 직접 import(+ `shared/api` 허용), `=== 200`, hex·팔레트 색상, alert, 토큰 스토리지, react-hooks, 환경변수 폴백, `console.error(err)`, SQL 템플릿 보간(+ `scripts/` 제외), 정상 코드 → **62건 전부 기대대로**(Node 24.22·26.12 모두)
- 대조군: TS에서 `import-x/parsers`를 빼면 **순환 0건**(조용히 꺼짐), JS에서 TS 리졸버를 빼면 `@/` 별칭 순환을 놓친다 — 템플릿 주석대로
- 설치 순서 그대로(새 폴더): TS = `typescript@~6.0.3` 먼저 → ESLint 묶음, JS = ESLint 묶음만 — 둘 다 ERESOLVE 없음
- 훅(`post-edit-check.mjs`): 위반 파일 exit 2(메시지 포함), 정상 파일 exit 0
- 바뀐 곳: 템플릿 4종(설치 줄·import·`import-x/resolver-next`·`import-x/no-cycle`·사유 주석), scaffolds/default.md 설치 절, CLAUDE.md 검증 규칙의 규칙 이름

## 2. 레시피 목록 단일화 (refactor)

- `dev-rules.md`(모든 프로젝트에 항상 로드): 기능 이름 50개 가까운 나열 → **"기능을 구현하기 전에 catalog.md에서 레시피가 있는지 먼저 확인한다"** 한 줄 (10,817 → 10,118바이트). 목록이 하던 "레시피가 있다"는 신호는 규칙 자체로 대신한다
- `README.md`: 기능 나열 → catalog.md 링크
- `catalog.md` 1절: 레시피를 추가할 때 고칠 곳 = **레시피 파일 + 표 한 줄**(스키마·시작 결정이 있으면 해당 인덱스)
- `CLAUDE.md` SSOT: "레시피 목록은 catalog.md 한 곳에만" (2026-10-21 확정)

## 검증

| 항목 | 결과 |
|---|---|
| ESLint 하네스 | 62/62 (Node 24·26) |
| `verify-templates.sh` | 통과 |
| `check-refs.mjs` | 통과 |
| `install.sh` 임시 HOME | 설치본 = 저장소 (conventions·rules·scaffolds) |
| `install.ps1` 실행 | **미수행** — PowerShell 없음. 회사 PC에서 `git pull` 후 실행 필요 |

## 커밋 코멘트

```
@@ 2026-10-21 (2부) @@
7차 — 정비만 (재검토 결과 새 레시피·업체 문서 원문화는 하지 않음)

■ ESLint 9(2026-08-06 지원 종료) → 10, eslint-plugin-import(10 미지원) → import-x — 템플릿 4종 × 전 규칙 62건 재검증
■ TS 6.0 고정·Flyway 12 고정은 사유 유효(typescript-eslint peer, Boot 관리 버전) — 그대로
■ 레시피 목록은 catalog.md 한 곳 — dev-rules·README 나열 제거, 추가 시 고칠 곳 = 레시피 + 표 한 줄
```

---

# 3부 — 8차: 운영 기본기 정비 (Actions 버전 · 버전 점검 자동화 · 백업 · 의존성 취약점)

> 사용자 요청 "8차 내용 보고해" → 권고안(A Actions 버전 / B 버전 점검 자동화 / C 의존성 취약점·갱신 / D 백업 구현, 새 레시피 없음) → "권고안으로 8차 진행해"
> 기준은 7차 재검토와 같다 — 대부분의 서비스가 부딪히는가, 모르면 운영 사고가 나는가, 기존 컨벤션에 없는가.

## A. CI 템플릿·verify.yml의 Actions 버전 (fix)

- 근거: main CI 로그 실측 *"Node.js 20 is deprecated … forced to run on Node.js 24: actions/checkout@v4, actions/setup-node@v4"*. 고정된 5개가 모두 `using: node20` (각 저장소 action.yml).
- 일정 원문: actions/runner `Constants.cs` — Node 24 기본 2026-06-16, 러너의 Node 20 제거 2026-09-23 (서버 변수로 바뀔 수 있는 기본값).
- 조치: checkout v4→**v7**, setup-node v4→**v7**, setup-java v4→**v6**, login-action v3→**v4** (모두 node24). 메이저마다 바뀐 점(릴리스 노트·README)을 확인했고, 템플릿이 쓰는 입력값(`node-version`, `distribution`·`java-version`, `registry`·`username`·`password`)에는 깨지는 변경이 없다.
- 실행 검증(act 0.2.89, 템플릿을 그대로 넣은 표본 프로젝트):
  - test-client(checkout·setup-node v7 + npm ci·lint·test) 통과
  - test-server(setup-java v6 + MariaDB 서비스 컨테이너) 통과 — setup-java는 adoptium API가 막혀 있어 tool cache의 Temurin 25로 확인
  - docker job 통과
  - release(login-action v4) — ghcr 대신 htpasswd 인증 로컬 레지스트리로 로그인·push 성공
- scaffolds/default.md에 "Actions는 Node 24 런타임 메이저, 메이저 갱신은 Dependabot PR" 규칙 추가.

## B. 버전 고정값 점검 자동화 — `scripts/check-versions.mjs` (feat)

- 근거: 차수마다 하던 수동 점검이 Actions를 놓쳤다(A). CLAUDE.md "도구로 강제할 수 있는 규칙은 도구로"를 적용했다.
- 대상: 템플릿·스캐폴드·Dockerfile 예시(docker.md 등)의 고정값 65건.
  - Actions → git 태그
  - 이미지 → 정책별: Node·Temurin·MariaDB는 LTS, nginx는 짝수 마이너, Caddy·Gradle은 최신 메이저, Playwright는 MCR 최신
  - Gradle 플러그인 → 플러그인 포털
  - Maven 의존성·Checkstyle → Central
  - npm 메이저, Gradle 래퍼
  - LTS·지원 종료일은 endoflife.date 원본 데이터(GitHub raw)로 읽어, API 도메인이 막힌 곳에서도 같은 결과
- 일부러 최신이 아닌 값은 사유를 조회해 비교한다:
  - Flyway 이미지 = Boot가 관리하는 Flyway 메이저
  - TypeScript = typescript-eslint peer가 허용하는 최대 메이저
  - 기계로 확인할 수 없는 MariaDB 11.4 유지는 `HOLDS`에 기한(2027-04-21)과 함께 둔다 → 기한이 지나면 다시 실패
- 검증:
  - 현재 저장소: 0건(보류 5).
  - 저장소 사본에 낡은 값 18종을 넣은 대조군에서 **18건 전부 검출**. Boot를 4.0.6으로 낮추면 Flyway 기대값이 11로 따라 바뀌는 것도 확인했다.
  - `CHECK_TODAY=2026-10-29`로 돌리면 Node 24 고정 8곳이 26으로 검출된다(10-29 예약 작업과 일치).
  - `2027-05-01`이면 보류 기한 만료로 실패한다.
  - 조회 실패도 exit 1이다.
- CI: verify.yml에 `schedule`(매주 월 09:17 KST)·`workflow_dispatch` 추가. check-versions는 예약·수동 실행 때만 돈다 — 외부 릴리스 하나로 무관한 push가 빨개지지 않게. act로 dispatch(두 job 통과)와 push(check-refs만)를 확인했다.

## D. 백업 구현 기본값 — ops.md 6절 + `backup.sh` + compose `backup` 서비스 (feat)

- 근거: ops.md 6절에는 "정기 백업을 설정한다"만 있고 도구·주기·보관·사본 위치·실패 감지가 없었다.
- 법령 원문: 개인정보의 안전성 확보조치 기준(고시 제2026-9호, 2026-07-01 시행) 제7조⑤(개인정보취급자 컴퓨터·보조저장매체 저장 시 암호화), 제11조(10만/100만 명 이상 백업·복구 계획).
- 실측 (MariaDB 11.4.13, 덤프 145MB·60만 행, 잔액 갱신 + 이체 기록을 한 트랜잭션으로 계속 쓰는 중):

| 옵션 | 덤프 중 쓰기 | 복원 후 불변식 |
|---|---|---|
| 기본(`--lock-tables`) | 최대 3.5초 정지, 커밋 1,536건 | 맞음 |
| `--skip-lock-tables` | 계속(7,418건) | **이체 5,707건 어긋남** |
| `--single-transaction` | 계속(7,484건, 최대 간격 0.36초) | 맞음 (2회) |

  - ⚠ 측정 코드 실수 1건을 바로잡았다 — `WHERE id = FLOOR(1+RAND()*100)`은 행마다 RAND()를 다시 계산해 원본부터 불변식이 깨졌다 → 변수로 고친 뒤 재측정.
- 함정 실측:
  - `| gzip`에 pipefail이 없으면 접속 실패에도 exit 0과 20바이트 파일이 남는다(pipefail이면 exit 2).
  - 끊긴 덤프에는 `-- Dump completed`가 없고, 복원하면 ERROR 1064와 함께 앞 테이블만 생긴다.
  - 기본 덤프에서는 프로시저·이벤트가 빠진다(뷰·트리거는 포함).
  - 백업 컨테이너를 root로 돌리면 파일이 root 소유 600이라 배포 계정이 복사할 수 없다.
  - openssl 복호는 변조된 파일도 exit 0으로 통과시킨다 — 잡아내는 곳은 gzip CRC다.
  - mariadb 이미지에는 gpg-agent가 없어 gpg 대칭 암호화를 쓸 수 없다.
  - SQL 파일을 클라이언트로 직접 넣으면 이모지가 ERROR 1366이 된다(덤프 복원은 정상, CHECKSUM 일치).
  - compose v5.6 TTY 손상은 재현되지 않았다 → 함정으로 쓰지 않음.
- 템플릿(템플릿 그대로 조립한 프로젝트에서 실행):
  - 백업 → 검사 → 정식 이름 → 기한 지난 파일 삭제 → `batch_history`에 성공 기록
  - 복원 리허설 명령(`restore <파일> [대상DB]`, 기본 `<DB>_restore`)으로 복원 → CHECKSUM 일치
  - 실패 경로: 틀린 비밀번호 exit 2(정식 파일 없음), 기록 테이블 없음 exit 1, 키·UID 미설정은 compose가 거부
  - MySQL 8.4 이미지에서도 같은 스크립트가 백업·복원·체크섬 일치까지 돈다(`mysqldump` 자동 선택)
- 연결:
  - scaffolds/default.md: `.env.example`에 BACKUP_* 5개, 구조도에 `scripts/backup.sh`, 복사 목록, `06_batch_history.sql` 포함 조건, **시작 결정 체크리스트 36(백업 사본 위치)**
  - 프로필 답안, verify-templates(.sh/.ps1) 검증 env, CLAUDE.md 검증 항목

## C. 생성 프로젝트의 의존성 취약점·갱신 — ops.md 5-1절 + `dependabot.yml` + `osv-lock.gradle` (feat)

- **실측 핵심**(OSV 데이터, 2026-10-21): 템플릿 그대로 Spring Boot 4.1.1(현행 최신) + webmvc만 둔 프로젝트에서 **알려진 취약점 10건(Critical 3)** — Boot가 관리하는 Tomcat 11.0.24(인증 우회 등, 11.0.25에서 수정)와 Jackson 3.1.5.
  - `ext['tomcat.version']`·`ext['jackson-bom.version']` 덮어쓰기 후 재검사 0건.
- osv-scanner 2.7.0:
  - `build.gradle`만으로는 "No package sources found"
  - 검사할 때만 init 스크립트(`osv-lock.gradle`)로 `gradle.lockfile`을 만들면 전이 의존성까지 검사된다(빌드 설정은 바꾸지 않음)
  - 잠금을 켜지 않은 빌드는 남은(일부러 틀리게 고친) 잠금 파일도 무시한다
  - npm은 `npm audit`과 같은 lodash 취약점을 찾았다
- GitHub 원문(github/docs 저장소, 2026-10-20):
  - Dependabot은 npm·gradle·github-actions의 버전·보안 갱신을 지원한다. docker·docker-compose는 버전 갱신만 된다.
  - **Gradle은 dependency graph 정적 분석이 지원되지 않아 "Automatic dependency submission"을 켜야 한다.**
  - 보안 PR은 고정 한도 10개다.
- `dependabot.yml` 템플릿: npm·gradle(메이저가 아닌 갱신은 묶음)·github-actions, 주 1회. Docker는 제외(태그 고정 + 재빌드, 메이저 전환은 LTS 정책).
  - SchemaStore 스키마 검증 통과, 일부러 틀린 값은 검출.
  - ⚠ 실제 동작은 GitHub 저장소에서만 확인 가능 → ops.md에 **미검증** 표시.
- 연결: ops.md 5절 표 9번 → 5-1절, deploy-check 스킬 3단계, scaffolds/default.md(체크리스트 16, 구조도, dependabot.yml 절).

## 검증

| 항목 | 결과 |
|---|---|
| `check-refs.mjs` | 통과 (문서 71 / 참조 666) |
| `check-versions.mjs` | 고정값 65 / 낡음 0 / 보류 5, 대조군 18/18 검출 |
| `verify-templates.sh` | 두 모드 통과 (backup 서비스 포함 tools 프로필 병합도 확인) |
| act | test.yml 3 job · release(로컬 레지스트리) · verify.yml dispatch/push |
| 백업 e2e | MariaDB 11.4 · MySQL 8.4 백업·복원·체크섬, 실패 경로 4종 |
| shellcheck 0.11.0 | `backup.sh` 경고 0 |
| 인코딩 | 변경 파일 BOM·CR 없음, `install.ps1`·`verify-templates.ps1` BOM(+ps1 CRLF) 유지 |
| `install.sh` 임시 HOME | 새 템플릿(backup.sh·osv-lock.gradle)·ops.md·스킬 설치본 = 저장소 |
| `install.ps1` 실행 | **미수행** — PowerShell 없음. 회사 PC에서 `git pull` 후 실행 필요 |

## 커밋 코멘트

```
@@ 2026-10-21 (3부) @@
8차 — 운영 기본기 정비 (새 레시피 없음)

■ CI 템플릿 Actions 전부 Node 20 런타임(매 실행 경고) → checkout·setup-node v7, setup-java v6, login-action v4 — act로 실행 확인
■ 고정 버전 점검을 스크립트로(check-versions.mjs, CI 주 1회) — LTS·안정 계열 정책 + 고정 사유 연동, 대조군 18/18
■ 백업: compose backup 서비스 + backup.sh — --single-transaction(기본 옵션은 3.5초 쓰기 정지, 잠금 없음은 불일치), pipefail·완료 표시 검사·암호화·배포 계정 소유
■ 의존성: 최신 Boot 4.1.1도 Tomcat·Jackson 취약점 10건 → 관리 버전 덮어쓰기, GitHub=Dependabot+자동 의존성 제출, 사내=osv-scanner(init 스크립트 잠금)
```
