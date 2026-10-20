# 변경 이력 — 2026-10-20

> 작업 베이스 커밋 a42fc72(10-19 3부 전체 검증) 이후.
> 사용자 요청 "기본적으로 LTS 버전을 활용하도록 하는 게 맞는 것 같은데 검토해봐" → 검토 보고 → 결정 "1. Java 25로 올려 / 2. Node는 24로 먼저, 10-28 LTS 진입 후 26 / 3. 적용해".
> 핵심 주제: **① 런타임·플랫폼 버전 LTS 우선 정책 신설 ② 기본값 Node 22 → 24 · Java 21 → 25 · MySQL 호환 기준 8.0 → 8.4 LTS ③ JRE 25 이미지에 wget이 없어 HEALTHCHECK가 깨질 결함을 선제 정정**

---

## 1. LTS 우선 정책 (feat)

기존: 버전 선택 기준이 없었다 — 기본값이 "LTS이긴 하지만 곧 끝나는 버전"이거나 이미 지원이 끝난 버전으로 남아 있었다.
변경: `general.md` 8-1절 신설 (MANDATORY)
- LTS가 있는 구성요소(Node·Java·MariaDB·MySQL)는 **LTS만** — 기본값은 시작 시점에 **지원 종료가 3년 이상 남은 LTS 중 가장 새것**(이 저장소에서 검증한 값)
- LTS가 없는 구성요소는 지원 중인 최신 정식 마이너(Spring Boot)·안정 계열(nginx 짝수)·현행 메이저. 호환 때문에 낮게 고정하면 사유를 템플릿·CLAUDE.md에 (예: TypeScript 6.0)
- 프로젝트 CLAUDE.md에 **선택 버전과 지원 종료일** 기록, 종료 6개월 전 업그레이드 계획 — 스캐폴드의 CLAUDE.md 템플릿에 항목 추가
- 값은 정책 절에 쓰지 않고 "값이 정해진 곳"만 가리킨다(SSOT) / `dev-rules`에는 항목명만, `CLAUDE.md` 검증 규칙에 LTS 지원 종료일 대조 추가

## 2. 검토 — 지원 기간 대조 (Node.js Release 일정표·endoflife.date 원본, 2026-10-20)

| 구성요소 | 기존 기본값 | 지원 상황 | 조치 |
|---|---|---|---|
| Node | 22 | 유지보수 단계, 2027-04-30 종료 | **24**(2028-04-30) — 26이 10-28 LTS 진입(2029-04-30) 후 재검증해 26으로 |
| 이 저장소 CI | Node 20 | **2026-04-30 이미 종료** | **24** |
| Java | 21 LTS (2029-12-31) | 최신 LTS 25 (2031-09-30) | **25** |
| MySQL(호환 기준) | 8.0으로 검증 | **2026-04-30 이미 종료** | **8.4 LTS**(2032-04-30) 기준, 9.7 LTS(2034-04-30)도 확인 |
| MariaDB | 11.4 LTS (2029-05-29) | 12.3 LTS(2029-06-12)와 2주 차이 | 유지 (출시 2년 넘은 안정성) |
| Spring Boot | 4.1 | LTS 없음 — 4.0은 **2026-12-31 종료**, 4.1은 2027-07-31 | 유지, "최신 정식 마이너" 규칙과 4.0 종료 안내를 spring.md에 |
| nginx | 1.30 | LTS 없음, 짝수 = 안정판 | 유지 |

## 3. 기본값 변경

| 위치 | 기존 | 변경 |
|---|---|---|
| docker.md 2절 Dockerfile (Node 런타임·빌더, 정적 빌더) | `node:22-slim` | `node:24-slim` |
| docker.md 2-2절 Dockerfile (Spring) | `eclipse-temurin:21-jdk/jre` + `wget` HEALTHCHECK | `eclipse-temurin:25-jdk/jre` + **bash `/dev/tcp` HEALTHCHECK** (5절) |
| `scaffolds/templates/build.gradle` | `JavaLanguageVersion.of(21)` | `of(25)` |
| scaffold CI 템플릿 | `node-version: 22` / `java-version: 21` | 24 / 25 (Dockerfile·toolchain과 같은 메이저) |
| `.github/workflows/verify.yml` | `node-version: '20'` | `'24'` |
| spring.md 0절·scaffold 체크리스트 2·스택 조정표·프로필 | Java 21 | Java 25 (LTS) |
| spring.md 0절 Gradle 컨테이너 | `gradle:9-jdk21`, wrapper 9.0 | `gradle:9-jdk25`, wrapper 9.8.2 |
| database.md 1절 | "MySQL 8.0+"(최저선만) | 최저선 유지 + **신규는 지원 중인 LTS만**(MariaDB 템플릿 값, MySQL 8.4+) |
| compose 템플릿 MariaDB | `mariadb:11.4` | 그대로 + LTS·지원 종료일 주석 |

## 4. 실측 (2026-10-20)

| 대상 | 결과 |
|---|---|
| **Node 24.22 · 26.12** (새로 `npm ci`) | 레시피 실측 6종(Express 5 에러 매핑·빈도 제한·Redis 저장소·메일 인증·웹훅 파서·trust proxy 등) **Node 22와 출력 완전 동일** / bcrypt·sharp 네이티브 설치 정상 / Vite 빌드·ESLint·Vitest·훅(정상 0·타입 오류 2) 정상 |
| docker.md 2-1절 런타임 단계 `node:24-slim` | healthy, 실행 사용자 node, SIGTERM 148ms 종료 |
| **Java 25** (Temurin 25.0.4) | 템플릿 `build.gradle` 그대로 `check`·`bootJar` 통과(클래스 major 69) / JRE 25 기동·에러 매핑(201·400·404)·안전 종료 / JdbcClient·MyBatis 4.1.0·JPA + QueryDSL 포크 7.7 실DB 조회 / ArchUnit이 Java 25 클래스를 읽어 순환 검출(못 읽으면 검사가 빈 채 통과할 수 있어 따로 확인) |
| docker.md 2-2절 런타임 단계 `eclipse-temurin:25-jre` | 새 HEALTHCHECK로 healthy, 실행 사용자 app |
| **MySQL 8.4.11 · 9.7.2** | 스키마 26종 39개 테이블 / 앱 계정 트리거 ERROR 1419, 같은 테이블 서브쿼리 UPDATE ERROR 1093, 중복 키 메시지 `테이블.키이름` — 8.0과 같음 / 레시피 SQL(기한 감시·광고 2년 확인·취소 한도) 같은 결과 |
| MariaDB 12.3.3 | 앱 계정으로 스키마 26종·레시피 SQL 정상 (참고 — 기본값은 11.4 유지) |

## 5. 함정 발견 — JRE 25 이미지에는 wget·curl이 없다 (fix)

- `eclipse-temurin:21-jre`에는 `wget`·`curl`이 있지만 **`25-jre`에는 없다**(실측). Java만 25로 올리고 기존 `wget … | grep -q UP` HEALTHCHECK를 두면 **앱이 정상이어도 컨테이너가 계속 `unhealthy`**다.
- 처방: 이미지에 있는 bash의 `/dev/tcp`로 `/actuator/health`를 확인 — 추가 패키지 없이 UP → healthy, DB 미연결로 DOWN → 약 49초 뒤 unhealthy(실측).

**변경 파일**: `conventions/general.md`(8-1절 신설)·`docker.md`·`spring.md`·`database.md`, `features/seo.md`·`consent.md`·`outbox.md`, `rules/dev-rules.md`, `scaffolds/default.md`, `scaffolds/templates/build.gradle`·`docker-compose.yml`·`docker-compose.dev.yml`, `schemas/19_terms_consent.sql`(주석), `profiles/project-default.md`, `.github/workflows/verify.yml`, `CLAUDE.md`

## 6. 예정

- **2026-10-28 Node 26 LTS 진입** — 진입 확인 후 같은 실측(레시피·스캐폴드·Dockerfile)을 Node 26으로 다시 돌리고 기본값을 26으로 올린다. 10-20 실측에서는 26.12(Current)도 Node 22와 출력이 같았다.
  - **예약 완료: 2026-10-29 09:00(KST)에 이 작업 세션으로 자동 재개**한다. 순서: ① nodejs.org 배포 목록에서 v26의 LTS 진입 확인(아니면 보고 후 중단) ② 10-20과 같은 실측을 Node 26으로 ③ 결과가 Node 24와 같을 때만 기본값을 26으로 올리고 검증·변경 이력·커밋·main push ④ 다르게 동작하면 올리지 않고 보고.

---

## 검증

| 항목 | 결과 |
|---|---|
| `check-refs.mjs` | 통과 — CI와 같은 Node 24로 실행, 확장(skills·agents 포함)도 통과 |
| `verify-templates.sh` | 통과 |
| Spring 템플릿 그대로 Java 25 `check`·`bootJar` | 통과 |
| docker.md Dockerfile 런타임 단계 | JRE 25·Node 24 모두 healthy, non-root (빌드 단계는 이 환경의 빌드 컨테이너에 네트워크가 없어 `npm ci`·Gradle 다운로드 대신 호스트 산출물 사용) |
| `install.sh` 임시 HOME | 설치본 = 저장소 |
| 인코딩 | 변경 파일 BOM·CRLF 없음, `install.ps1` BOM 유지 |
| `install.ps1` 실행 | **미수행** — PowerShell 없음. 회사 PC에서 `git pull` 후 실행 필요 |
| main 반영 | **완료** — `3ec2527` → `78100c5` fast-forward (10-19 3부 전체 검증 커밋 6개 + 10-20 커밋 3개). 작업 브랜치도 같은 커밋 |
| main CI (`verify.yml`) | 통과 — 바꾼 Node 24로 `check-refs` 실행 (run #27) |

---

## 커밋 코멘트

```
@@ 2026-10-20 @@
런타임·플랫폼 버전 LTS 우선 정책 + 기본값을 최신 LTS로 (Node 24 · Java 25 · MySQL 8.4 기준)

■ 정책 (general.md 8-1절, MANDATORY)
- LTS 있는 것은 LTS만 — 지원 종료 3년 이상 남은 최신 LTS, 비LTS 금지
- LTS 없는 것은 최신 정식 마이너·안정 계열, 낮게 고정하면 사유 기록
- 선택 버전·지원 종료일을 프로젝트 CLAUDE.md에, 종료 6개월 전 업그레이드

■ 기본값 (실측: Node 24·26, Java 25, MySQL 8.4·9.7에서 레시피·스캐폴드·스키마 동일 결과)
- Node 22 → 24 (저장소 CI 20 → 24), 10-28 Node 26 LTS 진입 후 26으로
- Java 21 → 25 — JRE 25 이미지에 wget이 없어 HEALTHCHECK를 bash /dev/tcp로
- MySQL 호환 기준 8.0(지원 종료) → 8.4 LTS, MariaDB 11.4 LTS 유지
```
