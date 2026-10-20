# 구현 패턴 — Spring Boot 서버

실무 표준 Spring Boot 서버 구현 패턴. `patterns.md`(언어 무관)를 전제로 하며, express.md와 같은 원칙(계층·계약·신뢰 경계)의 Spring 구현 층이다. 인증 도구 매핑은 auth.md 6절.

## 0. 언어·빌드 (신규 프로젝트)

- **Java 25(LTS) + Spring Boot 4.x + Gradle 9.x** 기본 (2026-10-20 Java 21 → 25 — general.md 8-1절 LTS 정책: 21은 2029-12, 25는 2031-09 지원 종료). Kotlin은 사용자가 명시적으로 요청할 때만.
  - Java 25 실측 (2026-10-20, Temurin 25.0.4): 템플릿 `build.gradle` 그대로 `check`(Spotless·Checkstyle·`@WebMvcTest`·ArchUnit)·`bootJar` 통과, JRE 25에서 기동·에러 매핑·안전 종료 정상, 데이터 접근 3방식(JdbcClient·MyBatis 4.1.0·JPA + QueryDSL 포크 7.7) 실DB 조회 정상, ArchUnit이 Java 25 클래스(major 69)를 읽어 순환을 검출. ⚠ **`eclipse-temurin:25-jre`에는 wget·curl이 없다** — HEALTHCHECK는 docker.md 2-2절 방식.
  - **Spring Boot에는 LTS가 없다** — 마이너마다 OSS 지원이 약 13개월이라 **최신 정식 마이너**를 쓴다(2026-10-20: 4.1 — 2027-07-31까지, 4.0은 **2026-12-31 종료**). 4.0으로 시작한 프로젝트는 종료 전에 4.1로 올린다.
  - ⚠ **Spring Initializr는 더 이상 Boot 3.x를 제공하지 않는다**(최소 4.0). Boot 4 플러그인은 **Gradle 8.14+ 또는 9.x**를 요구하므로 wrapper 버전을 맞춘다 — 낮으면 `Spring Boot plugin requires Gradle 8.x (8.14 or later) or 9.x`로 빌드가 즉시 실패한다.
  - **Boot 3.x로 시작하지 않는다 (STRICT, 2026-10-19 확정)** — 3.x는 2026-06-25 3.5.16을 끝으로 OSS 릴리스가 끝났다(Maven Central 확인). 근거: Initializr에 접근하지 못하는 환경에서 `build.gradle`을 기억(학습 데이터 — Boot 3.x 기준)으로 쓰면 3.x로 시작하게 된다. **Initializr를 못 쓰면 `~/.claude/jyp/scaffolds/templates/build.gradle`(Boot 4.1.1 실빌드 검증)로 시작하고, 버전은 Maven Central의 최신 GA로 갱신해 CLAUDE.md에 기록한다.**
  - Boot 4는 스타터·테스트 이름이 바뀌었다: `spring-boot-starter-webmvc`(옛 `-web`), 테스트는 기술별 스타터 `spring-boot-starter-webmvc-test`(옛 `-test` 하나로 끝나지 않는다), Flyway 자동 설정도 `spring-boot-starter-flyway`. JSON은 **Jackson 3**(`tools.jackson` 패키지 — 애노테이션은 `com.fasterxml.jackson.annotation` 그대로).
- **Gradle wrapper(`gradlew` + `gradle/wrapper/*.jar`)를 저장소에 포함**한다 — CI·다른 기기에서 로컬 Gradle 설치 없이 빌드하기 위함. 확보 방법 두 가지:
  1. Spring Initializr 산출물 사용 (기본)
  2. 로컬에 Gradle이 없고 Initializr도 못 쓸 때: **컨테이너로 생성** — `docker run --rm -v "$PWD:/app" -w /app gradle:9-jdk25 gradle wrapper --gradle-version 9.8.2` (2026-07-14 검증, 태그는 2026-10-20 JDK 25로 갱신)
- ⚠ **Windows에서 생성한 `gradlew`는 실행 비트가 유실된다** — Linux CI/컨테이너에서 `Permission denied`로 깨진다. 조치: `git update-index --chmod=+x gradlew` 커밋 또는 Dockerfile/CI에서 `chmod +x gradlew`.
- **데이터 접근은 프로젝트 시작 시 사용자에게 묻는다** (scaffolds/default.md 체크리스트 24 — 리포지토리 계층·의존성·Boot 버전 제약이 통째로 갈리는 되돌리기 어려운 결정이다). 선택지와 근거:
  - **(a) `JdbcClient`** (Spring JDBC, **기본**) — 순수 SQL 유지(sql.md 스타일 그대로), Spring 1st-party라 Boot 버전 호환 문제가 없다. CRUD·조회 위주면 이걸로 충분하다.
  - **(b) JPA(+QueryDSL)** — 도메인 로직이 무거운 시스템(상태 전이·이력·복잡한 연관)에서 생산성이 크다. **선택 시 N+1·즉시로딩 정책을 함께 정한다**(지연로딩 기본 강제, fetch join/`@EntityGraph`/batch size). 동적 조회는 QueryDSL 병용이 표준 — **원 저장소 `com.querydsl`은 2024-01 5.1.0 이후 출시가 없어 유지보수 중인 포크 `io.github.openfeign.querydsl`(7.x)을 쓴다** (2026-10-19 실측: Boot 4.1.1·Hibernate 7.4 + 포크 7.7로 Q클래스 생성·조회 정상. 원 저장소 5.1.0도 단순 조회는 됐지만 이후 수정이 나오지 않는다). 결정과 정책을 CLAUDE.md에 기록.
  - **(c) MyBatis** — SQL을 완전 통제하되 XML Mapper 자산·익숙함이 있을 때. ⚠ **MyBatis 스타터는 Boot 마이너마다 대응 버전이 따로 나온다**(4.0.x ↔ Boot 4.0, 4.1.x ↔ Boot 4.1 — 4.1.0은 2026-07-16 출시, Boot 4.1.1에서 전체 컨텍스트 기동·실DB 조회 실측 2026-10-19). 채택 시 스타터 버전을 CLAUDE.md에 기록하고, **Boot 마이너를 올리기 전에 대응 스타터가 나왔는지 먼저 확인**한다(2026-07-14 "4.0.x 고정" 규칙은 4.1.0 출시로 해제).
  - 여러 방식 혼용도 가능하다(예: JPA로 도메인 + 무거운 통합 조회는 JdbcClient). 혼용 시 Boot 버전은 모든 의존성의 대응 버전이 있는 범위 안에서 정한다(MyBatis 포함 시 스타터 대응 버전).
- 마이그레이션은 **Flyway**를 쓰되 **`spring.flyway.enabled=false`로 앱 기동 시 자동 실행을 끈다 (STRICT)** — 배포 절차의 별도 단계(`docker compose run --rm migrate`)로만 적용한다 (근거: docker.md 5절 "앱 기동과 분리" — 백업 확인·잠금 시간 조정·2단계 배포가 모두 분리를 전제한다. Flyway가 동시 실행을 락으로 막아주는 것과는 별개 문제다). 마이그레이션 파일은 저장소 루트 `migrations/`에 두고(모노레포 공유), migrate 서비스가 `filesystem:` 위치로 읽는다 — `src/main/resources/db/migration`에 두지 않는다.

## 1. 계층 구조

```
src/main/java/{base}/
├── controller/{module}/    # 라우팅 + 응답 반환 (봉투 래핑만)
├── service/{module}/       # 비즈니스 로직 + 트랜잭션 경계
├── repository/{module}/    # 데이터 접근 (JdbcClient Repository / MyBatis Mapper / JPA Repository — 0절 선택에 따름, SQL은 sql.md 스타일)
├── external/{system}/      # 사내·외부 API 연동 클라이언트 (연동 프로젝트만 — integration.md)
├── common/                 # 봉투·예외·유틸 등 횡단 요소
└── config/                 # Security, Jackson, 데이터 접근(MyBatis 등) 설정
src/main/resources/
├── mapper/{module}/        # MyBatis XML (쿼리 원문 — MyBatis 채택 시에만)
└── application.yml         # + application-{profile}.yml
```

- 흐름은 단방향(controller → service → repository — patterns.md 1절). 네이밍: `{Module}Controller` / `{Module}Service` / 데이터 접근은 방식에 따라 `{Module}Repository`(JdbcClient/JPA) 또는 `{Module}Mapper`(MyBatis).
- 프로파일: `application.yml`(공통) + `application-dev.yml`/`application-prod.yml`. 시크릿은 yml에 쓰지 않고 환경변수 참조(`${DB_PASSWORD}`, JWT 서명 키는 `${JWT_SECRET}`)로만 — 하드코딩 폴백(`${DB_PASSWORD:1234}`) 금지 (patterns.md 4절).

## 2. Controller — 봉투 구현 (MANDATORY)

api.md 5절의 계약을 공통 래퍼로 구현한다 — 컨트롤러가 Map을 즉석 조립하는 것 금지.

```java
// common/ApiResponse.java
public record ApiResponse<T>(T data, Long total) {
    public static <T> ApiResponse<T> of(T data)              { return new ApiResponse<>(data, null); }
    public static <T> ApiResponse<T> list(T data, long total){ return new ApiResponse<>(data, total); }
}

@RestController
@RequestMapping("/api/items")
public class ItemController {
    @PostMapping
    public ResponseEntity<ApiResponse<ItemResponse>> create(@Valid @RequestBody ItemCreateRequest req) {
        return ResponseEntity.status(HttpStatus.CREATED)
                             .body(ApiResponse.of(itemService.create(req)));
    }
}
```

- 컨트롤러는 얇게 — 검증 트리거(`@Valid`)와 봉투 래핑만. try-catch 금지: 예외는 전부 `@RestControllerAdvice`(4절)가 받는다.
- **업무 API는 `/api` 프리픽스 아래** (api.md 1절 — 위 예시처럼 `@RequestMapping`에 포함). actuator(`/actuator/health`)는 프리픽스 밖 그대로 둔다 (컨테이너 HEALTHCHECK·프록시 헬스 라우트용).
- `null` 필드가 봉투에 섞이지 않도록 Jackson `@JsonInclude(NON_NULL)`을 래퍼에 적용.

## 3. 입력 검증 — Bean Validation (STRICT)

zod(express.md 3절)에 대응하는 방어선. 요청 DTO는 record + 검증 애노테이션으로 선언하고 `@Valid`로 트리거한다.

```java
public record ItemCreateRequest(
    @NotBlank @Size(max = 100) String itemName,
    @NotNull  @Positive        Long  exampleId
) {}
```

- 검증 실패(`MethodArgumentNotValidException`)는 `@RestControllerAdvice`가 400 + 에러 계약(`message`/`error`/`field`)으로 변환 — 컨트롤러마다 처리하지 않는다.
- 형식 검증(Bean Validation)을 통과한 뒤의 **비즈니스 규칙 위반은 타입 있는 커스텀 예외**(`ValidationException` 등)로 서비스에서 던진다.
- 엔티티/테이블 매핑 객체를 요청 DTO로 재사용하지 않는다 — 외부 입력 경계와 저장 모델을 분리 (과다 바인딩 방지).

## 4. 예외 처리 — @RestControllerAdvice (STRICT)

```java
@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    // 입력 형식 오류는 4xx — 아래 Exception 핸들러가 500으로 삼키지 않게 먼저 둔다 (error-pages.md 3-1절과 같은 계약)
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> handleInvalid(MethodArgumentNotValidException e) {
        FieldError fe = e.getBindingResult().getFieldError();
        // 필드명은 클라이언트가 보낸 JSON 이름(snake_case)으로 — 7절 SNAKE_CASE 전역 설정과 맞춘다
        String field = fe == null ? null : fe.getField().replaceAll("([a-z0-9])([A-Z])", "$1_$2").toLowerCase();
        return ResponseEntity.status(400).body(new ErrorResponse("입력값을 확인해 주세요.", "VALIDATION_ERROR", field));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)   // 깨진 JSON·타입 불일치 본문
    public ResponseEntity<ErrorResponse> handleUnreadable(HttpMessageNotReadableException e) {
        return ResponseEntity.status(400).body(new ErrorResponse("요청 본문 형식이 올바르지 않습니다", "INVALID_JSON", null));
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ResponseEntity<ErrorResponse> handleTooLarge(MaxUploadSizeExceededException e) {
        return ResponseEntity.status(413).body(new ErrorResponse("요청이 너무 큽니다", "PAYLOAD_TOO_LARGE", null));
    }

    @ExceptionHandler(NotFoundException.class)
    public ResponseEntity<ErrorResponse> handleNotFound(NotFoundException e) {
        return ResponseEntity.status(404).body(new ErrorResponse(e.getMessage(), "NOT_FOUND", null));
    }
    // ValidationException → 400, ForbiddenException → 403 (업무 예외 — 같은 방식)

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleUnexpected(Exception e) {
        // 없는 경로(404)·메서드 불일치(405)·미지원 미디어 타입(415)처럼 상태코드를 가진 프레임워크 예외는 그 코드로
        if (e instanceof org.springframework.web.ErrorResponse framework) {
            int status = framework.getStatusCode().value();
            String code = status == 404 ? "NOT_FOUND" : status == 405 ? "METHOD_NOT_ALLOWED" : "BAD_REQUEST";
            return ResponseEntity.status(status).body(new ErrorResponse("요청을 처리할 수 없습니다", code, null));
        }
        log.error("처리되지 않은 예외", e);   // ← 필수 (아래 STRICT)
        return ResponseEntity.status(500).body(new ErrorResponse("서버 오류", "INTERNAL_ERROR", null));
    }
}
```

- **`Exception` 전체를 잡는 핸들러만 두면 검증 실패·깨진 JSON·없는 경로·메서드 불일치까지 전부 500이 된다 (2026-10-19 실측, Boot 4.1.1)**: 이전 판의 이 예시(NotFound + Exception 핸들러만)로 검증 실패 → 500, 깨진 JSON → 500. 위 코드로 바꾼 뒤 검증 실패 400(`field: item_name`), 깨진 JSON 400, 없는 API 404, 메서드 불일치 405, 업로드 상한 초과 413 — 모두 에러 봉투. 클라이언트 실수가 5xx로 집계되면 에러 알림이 소음이 된다(features/error-alert.md).
- 타입 있는 예외 계층(`ValidationError`/`NotFoundError`/`ForbiddenError` 대응)을 `common/`에 정의하고, 상태코드 매핑은 이 한 곳에서만 한다 (patterns.md 3절).
- 최후 방어 핸들러(500)는 스택트레이스·SQL을 응답에 싣지 않는다 — 로그로만 (ops.md 3절).
- **최후 방어 핸들러는 반드시 예외를 로깅한다 (STRICT — 2026-07-14 실측)**: 로깅 없이 500만 반환하면 **예외가 통째로 사라져** 원인 추적이 불가능하다. 실제로 검증 중 POST가 500을 반환하는데 서버 로그에 아무것도 남지 않아 원인(요청 본문의 잘못된 UTF-8)을 찾지 못했고, 로깅을 넣은 뒤에야 드러났다. Spring은 핸들러가 처리한 예외를 스스로 로깅하지 않는다.

## 5. 트랜잭션

- **경계 = 서비스 소유 (STRICT)**: 다중 쓰기를 묶는 public 서비스 메서드에 `@Transactional`. Mapper는 전달받은 트랜잭션에 참여만 한다 (express.md 4절과 동일 원칙).
- ⚠ `@Transactional`은 기본으로 **unchecked 예외만 롤백**한다 — checked 예외를 쓰면 `rollbackFor = Exception.class`를 명시하거나, 커스텀 예외를 RuntimeException 계열로 통일한다(권장).
- ⚠ **self-invocation 함정**: 같은 클래스 안에서 `this.내부메서드()` 호출은 프록시를 우회해 `@Transactional`이 무시된다 — 트랜잭션 메서드는 다른 빈에서 호출되는 public 메서드여야 한다.
- 롤백 시 부수 자원(업로드 파일 등) 정리, 채번은 트랜잭션 내 재산정 + UNIQUE + 재시도 (express.md 4절과 동일).

## 6. 신뢰값 주입 (STRICT)

- 스코프 값(테넌트/회사 ID)·행위자 값(`created_by`/`updated_by`)은 클라이언트 전송값을 무시하고 **SecurityContext의 인증 주체**(`@AuthenticationPrincipal` 커스텀 principal — 사용자 ID·회사 ID·역할 코드)에서 강제 주입한다 — express.md 5절의 `req.user`와 동일한 역할.
- 관리자·설정 엔드포인트는 인증만으로 부족 — `@PreAuthorize("hasAuthority('module.action')")` 권한 게이트 필수 (auth.md 4절).
- 공개 경로는 `SecurityFilterChain`에서 명시적 화이트리스트로만 — 그 외 전부 인증 요구 (default deny).

## 7. 기타

- **JSON 필드는 snake_case** (api.md 4절): `spring.jackson.property-naming-strategy: SNAKE_CASE` 전역 설정 — DTO마다 `@JsonProperty`를 붙이지 않는다.
- 헬스체크: **spring-boot-starter-actuator의 `/actuator/health`** 사용 — 직접 만들지 않는다. docker.md HEALTHCHECK가 이 경로를 본다. 노출 엔드포인트는 health만(`management.endpoints.web.exposure.include: health`).
- 날짜 직렬화는 ISO 8601 고정(`LocalDate`/`LocalDateTime`), 시간대는 앱·DB 통일(database.md 1절). Boot 4의 Jackson 3은 java.time을 기본 지원한다 — jsr310 모듈을 따로 넣지 않는다 (2026-10-19 실측: `LocalDate` → `"2026-10-19"`, snake_case 전역 설정도 그대로 동작).
- 테스트: **JUnit Jupiter(Boot 4 관리 버전 — 6.x) + `@WebMvcTest`/`MockMvc`**(API 계약) + 순수 단위 테스트(서비스 도메인 로직 — 컨텍스트 없이). 실행은 `./gradlew test` (testing.md의 `npm test` 대응).
  - Boot 4: `@WebMvcTest`는 `spring-boot-starter-webmvc-test` 의존성 + 패키지 `org.springframework.boot.webmvc.test.autoconfigure`. 목 빈은 **`@MockitoBean`**(`org.springframework.test.context.bean.override.mockito`) — **`@MockBean`은 Boot 4에서 제거됐다**(2026-10-19 실측: `package org.springframework.boot.test.mock.mockito does not exist` 컴파일 오류).
- **포맷·정적 검사 자동화 (스캐폴드가 설정)**: **Spotless**(google-java-format — 포맷 논쟁 제거)와 **Checkstyle**(미사용·와일드카드 import·네이밍·빈 catch)을 build.gradle에 넣고 `check`에 묶는다 — 규칙을 문서가 아니라 빌드가 강제한다 (TS/React의 ESLint 대응). CI와 훅이 `./gradlew spotlessCheck` / `./gradlew check`를 실행한다. **설정·버전은 `~/.claude/jyp/scaffolds/templates/build.gradle`·`checkstyle.xml`이 단일 출처**(2026-10-19 Boot 4.1.1·Gradle 9.8.2 실빌드 — 정상 코드 통과, 위반 검출). 이전 판의 Spotless 6.25.0은 Gradle 9에서 동작은 하지만 Gradle 11에서 제거될 API를 써서 경고가 나고, 8.10.4는 경고가 없다(실측).
- **패키지 순환 의존은 ArchUnit 테스트가 막는다** — Checkstyle에는 이 검사가 없다(이전 판의 "Checkstyle이 순환 의존을 검사"는 틀린 기술이었다). ESLint `import/no-cycle` 대응:

```java
// src/test/java/{base}/ArchitectureTest.java — 템플릿 build.gradle에 archunit 의존성이 있다
class ArchitectureTest {
  @Test
  void noCycles() {
    slices().matching("{base}.(**)").should().beFreeOfCycles()
        .check(new ClassFileImporter()
            .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
            .importPackages("{base}"));
  }
}
```

  실측 2026-10-19 (ArchUnit 1.5.1 + JUnit 6): 순환 없음 → 통과 / `cyc.a` ↔ `cyc.b` 서로 import → `noCycles() FAILED`로 `check` 실패.
- ⚠ **줄바꿈 (Windows 함정, 2026-07-14 실측)**: Spotless의 기본 정책은 `GIT_ATTRIBUTES`라 **`.gitattributes`가 없으면 OS 기본(Windows=CRLF)을 기대**해, LF로 작성한 정상 코드가 `spotlessCheck`에서 실패한다. 저장소에 **`.gitattributes`(`* text=auto eol=lf`)를 두거나** 위처럼 `lineEndings = 'UNIX'`를 명시한다 (둘 다 두는 것을 권장).
- 포맷 위반은 `./gradlew spotlessApply`로 자동 수정한다 — 검사(`spotlessCheck`)는 CI·훅이 돌린다.
- 리버스 프록시 뒤에서는 `server.forward-headers-strategy: native` 설정 — Express `trust proxy`의 대응 (docker.md 7절). **`framework`(ForwardedHeaderFilter)는 `X-Forwarded-For`의 맨 왼쪽 값, 즉 클라이언트가 보낸 값을 클라이언트 IP로 쓴다** (spring-web 6.2 소스 확인, 2026-10-16 정정 — Boot 4.1.1·spring-web 7.0.9 실측 2026-10-19: XFF `6.6.6.6, 192.0.2.2` → framework `6.6.6.6`, native `192.0.2.2`). `native`(Tomcat RemoteIpValve)도 사설 대역 IP를 프록시로 보고 건너뛰므로, 어느 쪽이든 **프록시가 `X-Forwarded-For`를 덮어쓰는 것이 전제**다 (features/rate-limit.md 3-1절).
