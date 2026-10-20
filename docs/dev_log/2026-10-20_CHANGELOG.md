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

---
---

# 2부 — 5차: 법적 요건 레시피 3종 + "미검증" 18건 해소

> 사용자 요청 "5차 내용 보고해" → 권고안 보고(A: 법적 요건 레시피 3종 / D: 기존 레시피의 미검증 표시 전부 실측) → "권고안으로 5차 진행해".
> 진행 방식은 4차와 같다: **법령 원문 확인 → 함정 실측 → 레시피 → 연결·검증 → 커밋**.

## 1. 새 레시피 3종 + 스키마 2종 (feat)

| 레시피 | 태그 | 스키마 | 핵심 |
|---|---|---|---|
| `privacy-breach.md` 개인정보 유출 대응 | `[공통]` | `26_privacy_breach.sql` (3개 테이블) | 알게 된 때부터 **72시간** 통지·신고, 확인된 것으로 먼저 알리고 추가 통지, 대상은 접속기록에서 **한 사람 한 행** |
| `identity-verification.md` 본인확인 | `[대외]` ⚑ | `27_identity_verification.sql` (2개 테이블) | 결과는 **서버가 받은 값만**, 결과 **1회·같은 세션**, **CI 블라인드 인덱스 UNIQUE**로 중복 가입 차단, 한국 날짜 만 나이 |
| `sms-message.md` 문자·알림톡 발송 | `[공통]` | outbox 재사용 | **사전 등록 발신번호로만**, **CP949 바이트**로 SMS/LMS 결정, 대체 발송은 한 곳에서만 |

### 원문 확인 (legalize-kr — 법제처 데이터를 옮긴 공개 저장소, 2026-10-20)

- 개인정보 보호법 제23조②(유출등 정의)·제22조의2·제34조(2026-03-10 개정분, 부칙 제1조로 2026-09 시행) / 시행령 제17조⑤·제17조의2·제39조·제39조의2·제39조의3·제40조(2026-09-11 시행본)
- 「개인정보의 안전성 확보조치 기준」 제4조① 14호·제8조②(2026-07-01 시행본)
- 정보통신망법 제23조의2·3·5·6(2026-10-02 시행본) / 민법 제4조·제158조·제160조
- 전기통신사업법 제84조의2(2026-11-20 시행본) + 과기정통부 고시 「거짓으로 표시된 전화번호로 인한 이용자의 피해 예방 등에 관한 고시」 제7조④·제10조·제10조의2·제12조(2026-07-10 시행본)
- 2차 출처로 표시: 대행사 API 바이트 한도(네이버 클라우드 SENS·Solapi), 알림톡 정책(Solapi·업계 안내), CI/DI 정의(KISA 본인확인 포털 자료)

### 함정 실측 (2026-10-20)

| 대상 | 결과 |
|---|---|
| 유출 대상 산정 (MariaDB 11.4.13 · MySQL 8.4.11 동일) | 고객 목록 24쪽×50명을 두 번씩 열람 + 원문 5건 + 목록 없는 3,000행 다운로드 → 접속기록 **행 수 54**(신고 판정 틀림) / `subject_count` 합계 5,405(과대) / **대상 표 1,200** / 목록 없는 기록은 JSON_TABLE에서 빠짐(하한으로 따로) / 범위 확대 재실행해도 중복 없음 |
| 72시간 기한·종료 가드 | `+ INTERVAL 72 HOUR` 정확 / 기한 넘기고 사유 없는 행 CLOSED 0행, 사유 기록 후 1행 |
| CI 중복 가입 | 암호문 UNIQUE → **2행 저장(통과)** / 블라인드 인덱스 UNIQUE → `ER_DUP_ENTRY` / 암호문 117바이트 |
| CI에 숫자만 남기는 블라인드 인덱스 재사용 | 서로 다른 CI 20만 개 중 **17쌍 충돌** |
| 본인확인 결과 1회 사용 | 동시 2회 → 1회 / 다른 세션 0행 / **DB 세션 시간대가 섞이면 만료 결과가 9시간 통과**(두 DB 모두, 통일하면 0행) |
| 만 나이 (Node 24·Java 21 동일) | 연 나이는 2012-12-31생을 2026-01-01에 14세로 / UTC 날짜는 생일 0~9시에 한 살 적게 / Java `plusYears`는 2월 29일생을 하루 이르게 / `Period.between`·연월일 비교는 정확 |
| 문자 바이트 (iconv-lite 0.7.3 · Java 21) | 한글 90자 `length` 90 vs CP949 180 / 44자 인증 문구 UTF-8 94 vs CP949 69 / **Java `EUC-KR`은 `똠`·`뷁`을 `?`로**, iconv-lite `euc-kr`은 실제로 CP949 / 이모지·`₩`·`–`는 두 스택 모두 `?` |

## 2. "미검증" 18건 → 실측 (fix)

Boot 4.1.1 · Java 25(Temurin 25.0.4) 테스트 프로젝트 하나 + nginx 1.30.6 · ClamAV 1.5.4 · React 19.3.1 · Playwright 1.64.1.

| 레시피 | 항목 | 결과 |
|---|---|---|
| field-encryption | Java AES-GCM 형식 | Java 출력은 `암호문‖태그` — 재배치해 Node 형식과 **양방향 복호화 성공** |
| load-test | `BCryptPasswordEncoder` | 톰캣 기본: 로그인 10건/s, 다른 API 420~457 req/s / 스레드 8: 다른 API 4 req/s / **가상 스레드: 다른 API 4 req/s, p99 5초** (2회 측정) → 해시 서버에 가상 스레드 금지 |
| load-test | HikariCP 기본 풀 | 7.0.2 `DEFAULT_POOL_SIZE = 10` 상수 확인 |
| mail-domain-auth | Java DKIM 서명 | `utils-mail-dkim` 3.3.1 → mailauth pass / **`List-Unsubscribe-Post`는 기본 서명 목록 밖**(nodemailer와 같은 함정) / 기본값이 서명 전 DNS 대조라 DNS 등록 전엔 실패 |
| marketing-message | 야간 판정 | 서버 UTC + `LocalDateTime.now()` → 22:30을 야간 아님, 08:10을 야간으로 — 정반대 |
| mfa | Java TOTP | `java-otp` 1.0.0 RFC 6238 SHA1 6/6·SHA256·SHA512 일치, Node otpauth와 같은 코드 |
| multi-instance | Bucket4j + Redis | 두 인스턴스 번갈아 8회 → 정확히 5회 통과 / **만료 전략 없으면 TTL -1** |
| multi-instance | `RedisMessageListenerContainer` | 두 인스턴스 수신 / 구독 중지 동안 발행분은 재시작 후에도 못 받음 |
| public-api | `OncePerRequestFilter` 분리 체인 | 정상 동작 / **필터를 빈으로 만들면 모든 경로에 걸려 화면 API 401** / `setEnabled(false)`로 해결 |
| rate-limit | nginx `set_real_ip_from` (LB·CDN) | LB 하나는 LB 주소만, CDN→LB는 둘 다 + `real_ip_recursive on` / **넓은 대역을 넣으면 위조값 채택** |
| rate-limit | Bucket4j 필터 | 200×5 → 429×2, `Retry-After: 59`, 다른 경로 영향 없음 |
| security-headers | Spring Security 헤더 | 기본 4종, **CSP·Referrer-Policy는 기본에 없음** — 설정으로 추가 확인 |
| seo | Playwright 빌더 | 공식 이미지 빌드 단계에서 프리렌더 성공 / **v1.64.1 = Node 24.21**(v1.56.1은 Node 22) |
| seo | React 19 머리 정보 | head로 올라가고 전환 시 바뀜 / **프리렌더와 함께면 제목 3개·설명 2개로 중복** → `useHead` 유지(React 19에서도 중복 없음) |
| static-assets | Spring Security Cache-Control | 인증 응답 `no-cache, no-store…` / 정적 자산 `max-age=31536000, public` 그대로 |
| static-assets · upload-security | 썸네일·재인코딩 | Thumbnailator: 400×800·EXIF 0 / **ImageIO 그대로: EXIF는 빠지지만 400×200(눕는다)** |
| upload-security | ClamAV EICAR | INSTREAM 클라이언트(Node·Java) — EICAR·zip 안 EICAR 검출, 101MB는 `size limit exceeded` / ⚠ 공식 서명 DB는 네트워크 정책으로 받지 못해 **EICAR 해시 사용자 서명**으로 검증 |
| upload-security | Apache Tika | 4.1.0 — 위장 HTML `text/html`, SVG `image/svg+xml`, **xlsx는 tika-core만이면 `x-tika-ooxml`** |
| webhook-receive | `@RequestBody byte[]` | `byte[]`·`String` 서명 일치 / **`Map`으로 받아 재직렬화하면 401** |

- 템플릿: `nginx-proxy.conf`에 LB·CDN 뒤 `real_ip` 설정을 주석으로 추가(켜면 `nginx -t` 통과, 꺼진 기본값도 통과).
- `upload-security.md`에 3-4절(clamd INSTREAM 클라이언트) 신설.

## 3. 연결

catalog 5차 행 3개 + 5차 출처 원칙 / 시작 결정 체크리스트 **33(본인확인)** 신설(프로필·OVERVIEW 개수 32→33) / 스키마 목록 26·27 + 포함 조건 / dev-rules·README 기능 목록 / 짝 링크: personal-data·marketing-message·account-lifecycle·notification·gdpr·ops.md 4절(개인정보 장애 = 72시간 동시 시작)

## 검증

| 항목 | 결과 |
|---|---|
| `check-refs.mjs` | 통과 (620건, 확장 637건) |
| 스키마 전체 | MariaDB 11.4.13 · MySQL 8.4.11 — 28개 파일 44개 테이블, 실패 0 |
| `verify-templates.sh` | 통과 |
| `nginx-proxy.conf` | nginx 1.30 `nginx -t` 통과 (기본·real_ip 켬 모두) |
| `install.sh` 임시 HOME | 설치본 = 저장소 |
| 인코딩 | 변경 파일 BOM·CRLF 없음, `install.ps1` BOM 유지 |
| `install.ps1` 실행 | **미수행** — PowerShell 없음. 회사 PC에서 `git pull` 후 실행 필요 |

## 커밋 코멘트

```
@@ 2026-10-20 (2부) @@
5차 — 법적 요건 레시피 3종 + 기존 레시피 미검증 18건 실측

■ 새 레시피 (법령 원문 확인)
- 개인정보 유출 대응: 72시간 통지·신고, 우선 통지, 접속기록 → 한 사람 한 행 대상 산정
- 본인확인: 서버 수신 결과만, 1회·같은 세션, CI 블라인드 인덱스 UNIQUE, 한국 날짜 만 나이
- 문자·알림톡: 발신번호 사전 등록, CP949 바이트, 대체 발송 한 곳에서만
- 스키마 26·27, 시작 결정 체크리스트 33(본인확인)

■ 미검증 18건 → 실측 (Boot 4.1.1·Java 25·nginx 1.30·ClamAV 1.5·React 19·Playwright 1.64)
- 가상 스레드 + bcrypt = 다른 API 정지 / 필터 빈 자동 등록 = 전 경로 401
- DKIM·nodemailer 공통: List-Unsubscribe-Post 기본 미서명 / real_ip 넓은 대역 = 위조 채택
- React 19 머리 태그 + 프리렌더 = 중복 → useHead 유지
```
