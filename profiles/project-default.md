# 프로필 — 사내 업무 시스템 표준 (기본값)

새 프로젝트 생성 시 **시작 결정 체크리스트(scaffolds/default.md)의 기본 답안**이다. 이 프로필을 적용하면 36개 항목 중 대부분이 자동 확정되고, **실제로 물어야 할 것만 남는다.**

## 적용 방법

1. `/new-project` 시 이 프로필을 먼저 읽고, 아래 **[확인]** 항목만 사용자에게 묻는다.
2. **[고정]** 항목은 묻지 않고 적용한다 — 단, 확정값을 생성되는 CLAUDE.md에 그대로 기록한다(프로필을 안 읽은 사람도 알 수 있게).
3. 프로젝트가 이 프로필과 다른 성격이면(대외 서비스, 대규모 트래픽 등) 프로필을 적용하지 않고 체크리스트 전체를 확인한다.
4. **프로필이 현실과 어긋나면 프로필을 고친다** — 프로젝트마다 같은 예외를 반복 지정하고 있다면 그것이 새 기본값이라는 신호다.

## [확인] — 매번 묻는다 (5개 + 백엔드=Spring이면 데이터 접근)

| 항목 | 왜 묻는가 |
|---|---|
| 프로젝트명 / 목적 한 줄 | 자명 |
| **언어 — TS / JS** (프론트, 그리고 백엔드가 Node면 백엔드도) | 중간 전환이 사실상 재생성이라 시작 시 확정해야 한다. **기본값을 두지 않는다** — 팀 숙련도·기존 자산에 따라 갈린다 (react.md·express.md 0절, 체크리스트 1) |
| **인증 소스** — (a) 자체 로그인 / (b) 사내 인증 위임 / (c) SSO | 프로젝트마다 다르고, user 테이블·로그인 흐름이 통째로 갈린다 (auth.md 0절) |
| **사내 API서버 연동 여부** — 있으면 대상·주소·인증 방식, **쓰기 연동 여부** | 연동 대상이 프로젝트마다 다르다 (integration.md). 쓰기 연동이면 outbox + 수신 측 멱등 협의 (features/outbox.md) |
| **특수 요구** — 멀티테넌트(다중 법인) / 다국어 / 정기 배치 / 결재(사내 전자결재 연동 또는 자체) 중 해당되는 것 | 모두 소급 비용이 크다. 없으면 "없음"으로 넘어간다 (결재: 체크리스트 26) |
| **Spring 데이터 접근** (백엔드=Spring일 때만) — (a) JdbcClient / (b) JPA(+QueryDSL) / (c) MyBatis | 리포지토리 계층·의존성·Boot 버전 제약이 갈린다 (spring.md 0절·체크리스트 24). 기본 (a) JdbcClient, MyBatis 선택 시 스타터의 Boot 대응 버전 확인(4.0.x↔Boot 4.0, 4.1.x↔Boot 4.1) |

## [고정] — 사내 표준값 (묻지 않는다)

**스택**
- 프론트: **React** (Vite) — 언어(TS/JS)는 [확인]에서 선택. TS면 `react-ts` 템플릿 + `strict: true`
- 런타임 버전: **LTS만**(general.md 8-1절) — Node·Java·DB 이미지 값은 템플릿이 단일 출처, 확정값과 지원 종료일을 CLAUDE.md에 기록
- 백엔드: **Spring Boot (Java 25 LTS + Gradle)** — 데이터 접근 방식은 [확인]에서 선택(기본 JdbcClient). Node/Express도 표준이며, 팀·기존 자산에 따라 선택. 확정값은 CLAUDE.md에 기록
- DB: **MariaDB / Asia/Seoul / utf8mb4**
- 구조: 풀스택이면 **모노레포**(client/ + server/)
- UI: **업무 시스템 모드**, 다크모드 미지원(요청 시 추가), shadcn 기본 색 → 브랜드 색은 확정되면 교체
- 응답 봉투: 단일 봉투(`data` 키), 에러는 `{message, error, field}`

**컨테이너·배포**
- DB 위치: **컨테이너 db** (호스트 DB를 쓸 이유가 있을 때만 예외)
- 배포: **CI가 ghcr.io로 이미지 push → 서버는 pull만**, GitHub 원격/CI 사용
- 노출 포트: client 5173 / server 8080(Spring) 또는 3000(Node) / DB 3306 — 충돌 시 `.env`에서 변경
- 프록시: **nginx-unprivileged**(사내망 전용 기본 — non-root, HTTP) + client(nginx) 정적 서빙. 외부 노출 + 도메인이면 **Caddy**(자동 HTTPS) — 체크리스트 15에서 확인
- **사내 도메인: 미확보 전제** (`SITE_ADDRESS=:80`) — 확보되면 값 교체만으로 HTTPS 전환
- **HTTP 운영 제약**: `COOKIE_SECURE=false` (HTTPS 전환 시 true), `crypto.randomUUID`·`navigator.locks` 사용 금지 — docker.md 7절
- 배포 호스트: **운영서버 1대 + 개발서버 1대** (한 PC 공존이면 `COMPOSE_PROJECT_NAME` 분리 — docker.md 7-2절)
- **가동 모니터링: 사내 인프라팀 위임** — 헬스 URL(`/health`)과 연락처를 전달하고 CLAUDE.md에 기록. 운영 감시 URL(`/api/ops/status` — 백업·디스크·배치)도 같은 도구에 등록하되 **알림 수신자는 개발팀** (batch.md 3-1절)

**품질**
- 테스트: 스택 표준 도구(Vitest / JUnit Jupiter), **테스트 DB 사용**(compose `db-test` + CI `services:`)
- 테스트 위치: `tests/` 미러링
- 개인정보(체크리스트 27): **처리함(일반)** — 화면 마스킹 + 접속기록 별도 DB (personal-data.md 2절). 고유식별정보·민감정보를 다루면 아래 "프로필 미적용 신호"에 해당한다
- 외부 노출 ID(체크리스트 28): **적용 안 함** — 사내 시스템은 내부 PK 그대로 (대외 서비스는 프로필 미적용 → features/public-id.md)
- 검색 노출(체크리스트 29): **없음** — 인터넷에 열려 있으면 `robots.txt` `Disallow: /` (features/seo.md 3-5절)
- 대외 자체 가입 계정 정책(체크리스트 30): **해당 없음** — 사내 시스템은 관리자가 계정을 발급한다
- 결제(체크리스트 31): **없음** — 사내 시스템은 PG 결제를 받지 않는다 (있으면 프로필 미적용 → features/payment.md)
- 외부 공개 API(체크리스트 32): **없음** — 사내 API 연동(integration.md)과 다르다. 연동사에게 API를 열면 features/public-api.md
- 본인확인(체크리스트 33): **없음** — 사내 시스템은 관리자가 계정을 발급한다 (실명 확인이 필요하면 features/identity-verification.md)
- 검색 요구 수준(체크리스트 34): **DB 부분 일치** — 사내 업무 규모(연 수만 건)에서는 범위 조건과 함께 `LIKE`로 충분하다 (features/korean-search.md)
- 금액 계산 정책(체크리스트 35): 금액을 다루면 **회계팀과 확정해 CLAUDE.md에 기록** — 기본 제안은 features/money-calc.md 2절
- 백업 사본 위치(체크리스트 36): **사내 백업 체계·NAS에 위임** — 없으면 다른 서버로 복사. 운영 개시 전에 위치·보관 기간(기본 30일)·키 보관처를 CLAUDE.md에 기록 (ops.md 6절)
- 운영 DB 식별자(체크리스트 25): 생성 시 묻지 않는다 — 배포 호스트가 정해지면 CLAUDE.md에 기록, 미기록이면 `/live-test`가 첫 실행 때 묻는다 (testing.md 6-1절)
- **린트·포맷 자동 강제**: ESLint(TS/React) / Spotless·Checkstyle·ArchUnit(Java) — 스캐폴드 템플릿 적용
- 예상 규모: 사내 업무 시스템(동시 수십 명, 연 수만 건) — **단일 인스턴스 전제**

## 프로필 미적용 신호

아래에 하나라도 해당하면 프로필을 쓰지 말고 체크리스트 전체를 확인한다:

- 대외 공개 서비스 (트래픽·가용성 요구가 다름 → 다중 인스턴스 전제 재검토, patterns.md 0-3절)
- 사내 표준 스택이 아닌 요구 (Python, Next.js SSR 등)
- 개인정보·결제 등 규제 요건이 별도로 있는 시스템
- 외부 연동사에게 여는 API(체크리스트 32)
