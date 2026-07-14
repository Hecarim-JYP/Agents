# 변경 이력 — 2026-07-14

> 작업 베이스 커밋(f978fd8, 2026-07-12) 이후 누적된 **미커밋 변경 전체** 정리.
> 핵심 주제: **① 스택 확장(Spring·다국어·멀티테넌트) ② 계약/구현 층 분리 ③ 컨테이너 운영 표준 재정의 ④ 바깥 경계 규칙 신설(연동·인증 소스·배치) ⑤ 동시성·설계 우선순위**
>
> 계기: 이 저장소의 규칙만으로 새 프로젝트(React + Spring + MariaDB)를 실제로 세팅해 보며 발견한 결함 15건(A~D) + 이후 실무 관점 재검증에서 발견한 갭.

---

## 1. 스택 확장 — Node/Express 전제 해소

### 1-1. spring.md 신설 (A-1)

기존: 백엔드 규칙이 사실상 express.md 하나뿐이라 Spring Boot는 "기타 언어"로 떨어져 구체 가이드가 0이었다.
변경: express.md에 준하는 Spring 구현 층을 신설했다. Java 21 + Gradle + MyBatis 기본, controller/service/repository 계층, Bean Validation(zod 대응), `@RestControllerAdvice` 중앙 예외 처리, `ApiResponse` 봉투 구현, `@Transactional` 함정(checked 예외 미롤백·self-invocation), SecurityContext 신뢰값 주입, actuator 헬스체크. Windows에서 커밋한 `gradlew`의 실행 비트 유실과 wrapper jar 확보 문제도 명시.

**변경 파일**
- `conventions/spring.md` — (신규) Spring Boot 구현 패턴
- `conventions/auth.md` — 6절 "Spring 채택 시 spring.md 작성" → 작성 완료 참조로 전환

### 1-2. 다국어(i18n)·멀티테넌트 표준화

기존: 다국어·다중 법인 요구를 다루는 규칙이 없었다.
변경: i18n 컨벤션을 신설하고(모든 문구는 키로 — 기본 언어 하드코딩 금지, fallback 사슬 = 사용자 → 법인 → 기본, 에러 분기의 SSOT는 `error` 코드, 코드성 데이터는 `_i18n` 번역 테이블 + COALESCE 조회), 멀티테넌트는 company 표준 스키마와 database.md 3절 규칙(스코프 컬럼 전 테이블 + 인덱스 선두, 로그인 ID 중복 범위·공통코드 소속·전사 횡단 조회를 시작 시 확정)으로 표준화했다.

**변경 파일**
- `conventions/i18n.md` — (신규) 다국어 컨벤션
- `schemas/05_company.sql` — (신규) 멀티테넌트 기준 테이블
- `conventions/database.md` — 1·3절: 멀티테넌트 소절 신설, 표준 스키마 목록에 company 추가

---

## 2. 계약 층 / 구현 층 분리

### 2-1. 응답 봉투를 스택 무관 계약으로 승격 (A-2)

기존: 봉투(`{data}` / `{error}`)가 express.md에만 있어 Spring에서는 계약이 사라졌다.
변경: api.md 5절에 봉투·에러 계약을 스택 무관으로 정의하고(성공 `{data}`+`total`, 에러 `{message, error, field}`), 구현 층은 표로 매핑했다(Express=응답 헬퍼+errorHandler / Spring=`ApiResponse`+`@RestControllerAdvice`). express.md 2절은 참조로 전환.

### 2-2. 마이그레이션 러너 — 원칙/도구 분리 (B-1)

기존: `npm run migrate` 커스텀 러너를 STRICT로 강제해 비-Node 스택에 실행 전략이 없었다.
변경: "적용 이력을 기록하는 러너로만 실행한다"를 원칙 층으로 올리고, 도구는 스택별 표로 분리했다(Node=커스텀 러너+`schema_migrations` / JVM=Flyway+`flyway_schema_history`+`V001__` 규약).

**변경 파일**
- `conventions/api.md` — 5절 신설(봉투 계약), 1절 `/api` 프리픽스, 2절 409, 4절 컬럼명 계약
- `conventions/express.md` — 2절 봉투 참조 전환, 1절 `/api` 마운트·external 계층
- `conventions/migration.md` — 5절 러너 원칙/도구 분리, 4절 API 계약 파괴 연결

---

## 3. 컨테이너·운영 표준 재정의

### 3-1. 스택별 Dockerfile·헬스체크 (A-3)

기존: Dockerfile·HEALTHCHECK 예시가 Node 전용이었다.
변경: 스택별 예시 3종을 추가했다 — Node(`/health` fetch), JVM/Gradle(actuator + `chmod +x gradlew`), 정적 프론트(nginx + SPA fallback). 컨테이너 내부 포트는 상수 고정(변경은 호스트 매핑 좌변에서만)을 명문화해 HEALTHCHECK·프록시 참조가 조용히 깨지는 것을 막았다.

### 3-2. compose "모드 2개 · 명령 1개" (C-3·C-4·C-5)

기존: 환경별 compose가 갈라지고 dev 전용 설정(`env_file`·`extra_hosts`)이 base에 섞여 prod까지 딸려갔다.
변경: 환경이 아니라 **모드**로 나눴다 — 개발 모드(base+dev, 로컬 전용 핫리로드)와 배포 모드(base+deploy, **개발서버 = 운영서버 = 로컬 배포 검증**). 서버 간 차이는 compose 파일이 아니라 그 서버의 `.env` 값뿐이다. `.env`의 `COMPOSE_FILE`로 모드를 지정해 기동 명령은 어디서나 `docker compose up -d` 하나. 노출 포트는 전부 `.env` 변수 + **폴백 금지**(`${VAR:?}` — 누락이 기동 실패로 드러나야 한다).

### 3-3. DB 위치·접속 매트릭스 (B-2·B-3·B-4)

기존: 컨테이너 DB를 전제했고, 컨테이너 내부 포트 / 호스트 노출 포트 / 서비스명의 구분이 어디에도 없었다.
변경: DB 위치를 시작 결정 항목으로 만들고(컨테이너/호스트 로컬/외부 매니지드), 접속 호스트·포트 매트릭스를 표로 고정했다(`db`+내부포트 / `localhost`+노출포트 / `host.docker.internal`). DB 노출 포트도 결정 항목.

### 3-4. 프록시·도메인·배포 파이프라인 (C-1·C-2)

기존: 규칙에는 Caddy 프록시가 있는데 스캐폴드에는 없어 배포 시 외부 접근 경로가 없었고, client↔server가 다른 출처라 CORS에 막혔다.
변경: Caddyfile 템플릿과 프록시 서비스를 **스캐폴드 기본 구성**으로 승격(정적 서빙 + `/api/*` 프록시 = 동일 출처), 로컬은 Vite `server.proxy`로 같은 구조 유지. **서버 1대 = 프로젝트 1개** 전제를 명문화하고, 접근 주소는 포트가 아니라 도메인으로 구분하되 **사내 도메인 유무를 시작 시 확인**해 미확보 시 `SITE_ADDRESS=:80`으로 시작하고 확보 시 값 교체만으로 HTTPS 전환되게 했다. 배포는 **태그 push → CI가 ghcr.io로 빌드·push → 서버는 pull만**(release.yml).

### 3-5. 운영 갭 4건

기존: CD·복구 검증·가동 감시·호스트 관리 규칙이 없었다.
변경: ①CD+레지스트리(위 3-4) ②**분기 1회 복구 리허설**(복원해 본 적 없는 백업은 백업이 아니다) ③**가동 모니터링 — 구현 여부를 반드시 묻고**, 기본은 사내 인프라팀 위임(헬스 URL·연락처 전달), 자체 구축 시 감시 도구는 다른 호스트에 ④서버 호스트 관리(디스크 점검, `prune -a` 금지 — 롤백 이미지 보존).

**변경 파일**
- `conventions/docker.md` — 2절 스택별 예시·내부 포트 고정, 4절 모드 2개·DB 위치·접속 매트릭스, 5절 ghcr 파이프라인, 7절 전제·도메인·Caddyfile
- `conventions/ops.md` — 6절 복구 리허설, 7절 가동 모니터링(신설), 8절 호스트 관리(신설)
- `skills/deploy-check/SKILL.md` — 9번 항목(서버 디스크·이미지 정리) 추가, 보안 체크리스트 항목 수 정정(9→10)

---

## 4. 바깥 경계 규칙 신설

### 4-1. 사내·외부 API 연동 (integration.md)

기존: 인바운드(클라→서버)만 규칙이 있고, 백엔드가 밖으로 나가는 호출에는 규칙이 전무했다.
변경: 연동 컨벤션을 신설했다 — 프론트는 사내 API를 직접 호출하지 않고 자기 백엔드 경유(BFF), 타 사내 서비스도 사내 API서버 경유, `external/{system}/` 연동 계층 분리(도메인 타입으로 변환 반환), **타임아웃 필수(기본 5초)·쓰기 재시도 금지**, 연동 실패는 자체 에러(502)로 봉투 변환, 외부 응답도 경계 검증, **`/health`에 외부 의존 금지**(남의 장애로 재시작 루프).

### 4-2. 인증 소스 결정 (auth.md 0절)

기존: 자체 로그인(자체 user 테이블 + bcrypt)을 암묵 전제했다.
변경: 인증 소스를 시작 결정 항목으로 만들었다 — (a) 자체 로그인 / (b) 사내 인증 위임 / (c) SSO. 공통 원칙: 인증 ≠ 인가(권한은 어느 방식이든 우리 DB 소유), 검증 성공 시 **우리가 우리 토큰을 발급**(사내/IdP 토큰을 클라이언트에 흘리지 않음), 위임·SSO면 user 테이블 조정(비밀번호·잠금 컬럼 제거 + `external_user_key`), 계정 프로비저닝·퇴사 계정 처리 방법 기록, 인증 소스 장애 시 신규 로그인만 불가.

### 4-3. 정기 배치 (batch.md)

기존: 집계·동기화·알림 발송의 실행 위치 규칙이 없었다.
변경: 배치 컨벤션을 신설했다 — **첫 배치 구현 전에 실행 방식을 사용자에게 제안·확정(MANDATORY)**, 실행 방식 3택(앱 내 스케줄러는 인스턴스 1개일 때만 / **별도 배치 컨테이너 + 호스트 cron 권장** / DB 락 분산), 컨테이너 안 crontab 금지, 멱등 작성, 타임존 `Asia/Seoul` 명시, **실행 이력 기록 + 실패 알림 필수**(알림 없는 배치는 배포 금지).

**변경 파일**
- `conventions/integration.md` — (신규) 사내·외부 API 연동
- `conventions/batch.md` — (신규) 정기 배치·스케줄 작업
- `schemas/06_batch_history.sql` — (신규) 배치 실행 이력
- `conventions/auth.md` — 0절 인증 소스(신설), 1절 자체 로그인 전용 명시, 6절 매핑 표에 위임·SSO 행
- `schemas/01_auth.sql` — 헤더에 위임·SSO 시 컬럼 조정 안내
- `conventions/express.md`·`conventions/spring.md` — 계층 구조에 `external/{system}/` 추가

---

## 5. 동시성·설계 우선순위 (ACID/SOLID 재검토 결과)

### 5-1. 동시성 제어 (sql.md 8절)

기존: 트랜잭션·UNIQUE·채번 재시도는 있었으나 **잃어버린 갱신(lost update)과 상태 전이 이중 실행 방어가 통째로 없었다** — 두 사용자가 같은 행을 동시에 고치면 나중 저장이 앞사람 변경을 조용히 덮어썼다.
변경: 3단 방어선을 규정했다 — ①**낙관적 락**(`version` 컬럼 + `WHERE version = :version`, 0행이면 **409**) ②**상태 전이는 조건부 UPDATE**(`WHERE status='PENDING'` — "조회→검사→갱신"은 동시 요청이 둘 다 통과해 이중 승인·이중 발송이 된다. 부수 작업은 1행 갱신 후에만) ③**`FOR UPDATE`/DB 계산**(재고·잔액 — 잠금 구간에 외부 호출 금지, 잠금 순서 통일).

### 5-2. 설계 우선순위 (patterns.md 0절)

기존: "확장성·유연성을 고려하라"와 "요청받지 않은 유연성 금지"(dev-rules)가 충돌하는 것처럼 보였고, 어느 쪽이 언제 이기는지 판정 규칙이 없었다.
변경: **되돌리기 비용**으로 갈랐다 — 되돌리기 어려운 결정(DB 스키마·API 계약·계층 경계·인증 소스·멀티테넌트·다국어·배치 방식)은 시작 시 결정하고 확장 여지 확보, 되돌리기 쉬운 것은 최소 구현. **"요청받지 않은 유연성 금지"는 후자에만 적용**됨을 명시(dev-rules에도 상호 참조). 확장은 미래용 추상화가 아니라 **경계 분리 + 매핑 표 + 데이터(공통코드)**로 확보한다. **다중 인스턴스 가정**(앱 프로세스에 상태를 두지 않는다 — 세션·업로드·캐시·스케줄러)과 CLAUDE.md "다중화 전환 목록" 기록 규칙 추가.

### 5-3. 테스트 DB 결정 (testing.md 0절)

기존: "서비스 테스트는 DB 없이"만 있어 동시성·제약 검증이 불가능했고, DIP 미채택 상태와 긴장이 있었다.
변경: 테스트 DB 사용 여부를 시작 결정 항목으로 만들었다 — (a) 사용(기본): 실제 테스트 DB로 서비스·쿼리 검증(동시성·UNIQUE는 실제 DB에서만 검증 가능), CI에도 구성 / (b) 미사용: 쿼리 목킹 + 한계 명시. **어느 쪽이든 테스트를 위한 인터페이스 추상화 계층은 만들지 않는다**(성급한 추상화 방지)를 명시해 DIP 미채택을 의도적 선택으로 선언.

### 5-4. 컬럼명 = API 계약 (api.md 4절)

기존: "API 필드명 = DB 컬럼명 통일" 규칙의 대가(컬럼명이 계약의 일부가 됨)가 기재되지 않았다.
변경: 응답에 실리는 컬럼의 이름·타입 변경·삭제는 **API 파괴적 변경**으로 취급하고 2단계 배포를 적용하도록 명시(migration.md 4절과 상호 연결).

**변경 파일**
- `conventions/sql.md` — 8절 동시성 제어(신설)
- `conventions/patterns.md` — 0절 설계 우선순위(신설), 1절 external 계층, 5절 조건부 갱신 최종 방어선
- `conventions/testing.md` — 0절 테스트 DB 결정(신설)
- `conventions/database.md` — 3절 `version` 공통 컬럼, 7절 예시 반영

---

## 6. 페르소나 규칙·스캐폴드·문서

### 6-1. 작업 규칙 강화 (dev-rules·doc-rules)

기존: 작업 절차가 5단계로 간결했으나 "추측 금지·복수 해석 제시·검증 가능한 목표"가 명문화되지 않았다.
변경: 작업 절차에 병합했다 — 추측 금지(가정 명시, 복수 해석은 모두 제시), 더 간단한 접근이 있으면 반대 의견, 다단계는 `단계 → 검증` 계획 명시, 작업을 검증 가능한 목표로 변환해 통과까지 반복. **"단순성과 수정 범위"(STRICT) 섹션 신설**(최소 코드, 선임 엔지니어 테스트, 외과적 수정, 내 변경이 만든 미사용 요소만 제거). doc-rules에는 추측 금지 원칙만 반영.

### 6-2. 스캐폴드 전면 개편 (D-1~D-7 + 신규 결정 항목)

기존: 시작 결정 체크리스트 10항목, CI는 Node 전용, `.env` 미생성으로 첫 기동이 깨지고, Vite 템플릿에 test 스크립트가 없어 CI가 실패했다.
변경: 체크리스트를 **22항목**으로 확장하고(TS/JS 명시 확인, 백엔드 스택, DB 위치·포트, 노출 포트, 멀티테넌트, 다국어, 사내 도메인, 가동 모니터링, 사내 API 연동, 인증 소스, 정기 배치, 테스트 DB, 예상 규모), first-run 단계에서 **`.env` 자동 생성**, CI를 **스택별 job**으로 일반화(Node/JVM setup-java+gradlew/docker) + **release.yml** 추가, React 조정표에 데모 잔재 정리·타이틀 치환·test 스크립트 등록 명시, Tailwind+shadcn **셋업 레시피**(design.md 8절 — alias 양쪽 설정, JS면 `tsx:false`, 다크모드 배선까지)를 완료 판정 체크리스트로 제공.

**변경 파일**
- `rules/dev-rules.md` — 작업 절차 강화, 단순성 섹션 신설, 컨벤션 라우팅에 spring·i18n·integration·batch·동시성 추가
- `rules/doc-rules.md` — 추측 금지 원칙 추가
- `scaffolds/default.md` — 체크리스트 22항목, first-run `.env` 생성, 스택별 조정표(Spring 행 신설), CI 스택별 job + release.yml, Caddy·external·다중화 전환 목록
- `conventions/design.md` — 8절 Tailwind+shadcn 셋업 레시피(신설)
- `conventions/react.md` — 7절 `baseURL='/api'` 상대 경로 고정(절대 주소·`VITE_API_URL` 금지)
- `docs/OVERVIEW.md`·`README.md` — 컨벤션 17종·스키마 7종·체크리스트 22항목 등 전면 동기화

---

## 커밋 코멘트

```
@@ 2026-07-14 @@
실전 세팅 피드백 반영 — 스택 확장(Spring·i18n·멀티테넌트), 계약/구현 층 분리, 컨테이너 운영 표준 재정의, 바깥 경계 규칙(연동·인증 소스·배치), 동시성·설계 우선순위

■ 스택 확장
- spring.md 신설 (계층·Bean Validation·@RestControllerAdvice·봉투·트랜잭션 함정·gradlew 실행 비트)
- i18n.md 신설 (문구 키·fallback 사슬·_i18n 번역 테이블), 멀티테넌트 표준(05_company.sql + database.md 3절)

■ 계약/구현 층 분리
- 응답 봉투를 api.md 5절 스택 무관 계약으로 승격 (Express/Spring 구현 표)
- 마이그레이션 러너: 원칙(이력 기록) / 도구(Node 러너·Flyway) 분리

■ 컨테이너·운영
- 스택별 Dockerfile·HEALTHCHECK 3종, 내부 포트 상수 고정
- compose 모드 2개·명령 1개 (개발서버 = 운영서버 = 같은 파일, 차이는 .env 값뿐)
- DB 위치 결정 + 접속 호스트 매트릭스, 포트 폴백 금지(${VAR:?})
- Caddy 프록시·Caddyfile을 스캐폴드 기본 구성으로, 도메인 유무 시작 결정
- CD 표준: 태그 push → CI가 ghcr.io push → 서버는 pull만 (release.yml)
- 복구 리허설(분기 1회), 가동 모니터링(주체 확인), 호스트 관리(ops.md 7·8절)

■ 바깥 경계
- integration.md 신설 (BFF·external 계층·타임아웃 5초·쓰기 재시도 금지·/health 격리)
- auth.md 0절 인증 소스 (자체/사내 위임/SSO — 인증≠인가, 우리 토큰 발급)
- batch.md 신설 (구현 전 방식 확정, 별도 배치 컨테이너 권장, 이력·실패 알림 필수)

■ 동시성·설계
- sql.md 8절 동시성 제어 (낙관적 락·조건부 UPDATE·FOR UPDATE, 충돌은 409)
- patterns.md 0절 설계 우선순위 (되돌리기 비용으로 확장성·단순성 조정, 다중 인스턴스 가정)
- testing.md 0절 테스트 DB 결정, api.md 컬럼명 = API 계약(파괴적 변경)

■ 규칙·스캐폴드
- dev-rules 작업 절차 강화 + 단순성·수정 범위 섹션
- 스캐폴드 체크리스트 22항목, .env 자동 생성, CI 스택별 job, shadcn 셋업 레시피
```
