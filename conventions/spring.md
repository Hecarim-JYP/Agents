# 구현 패턴 — Spring Boot 서버 (JYP)

실무 표준 Spring Boot 서버 구현 패턴. `patterns.md`(언어 무관)를 전제로 하며, express.md와 같은 원칙(계층·계약·신뢰 경계)의 Spring 구현 층이다. 인증 도구 매핑은 auth.md 6절.

## 0. 언어·빌드 (신규 프로젝트)

- **Java 21(LTS) + Spring Boot 3.x + Gradle** 기본. Kotlin은 사용자가 명시적으로 요청할 때만.
- **Gradle wrapper(`gradlew` + `gradle/wrapper/*.jar`)를 저장소에 포함**한다 — CI·다른 기기에서 로컬 Gradle 설치 없이 빌드하기 위함. wrapper jar는 오프라인 생성이 안 되므로 프로젝트 생성 시(Spring Initializr 산출물 또는 공식 배포본에서) 확보한다.
- ⚠ **Windows에서 생성한 `gradlew`는 실행 비트가 유실된다** — Linux CI/컨테이너에서 `Permission denied`로 깨진다. 조치: `git update-index --chmod=+x gradlew` 커밋 또는 Dockerfile/CI에서 `chmod +x gradlew`.
- 데이터 접근 기본: **MyBatis**(순수 SQL 유지 — sql.md 스타일을 그대로 적용). JPA는 사용자가 명시적으로 선택할 때만 (선택 시 CLAUDE.md에 기록하고 N+1·즉시로딩 정책을 함께 정한다).
- 마이그레이션은 **Flyway**를 쓰되 **`spring.flyway.enabled=false`로 앱 기동 시 자동 실행을 끈다 (STRICT)** — 배포 절차의 별도 단계(`docker compose run --rm migrate`)로만 적용한다 (근거: 기동 시 자동 실행은 docker.md 5절의 "앱 기동과 분리" 원칙을 깨고, 앱이 여러 개면 동시에 마이그레이션을 돌리는 경쟁이 생긴다). 마이그레이션 파일은 저장소 루트 `migrations/`에 두고(모노레포 공유), migrate 서비스가 `filesystem:` 위치로 읽는다 — `src/main/resources/db/migration`에 두지 않는다.

## 1. 계층 구조

```
src/main/java/{base}/
├── controller/{module}/    # 라우팅 + 응답 반환 (봉투 래핑만)
├── service/{module}/       # 비즈니스 로직 + 트랜잭션 경계
├── repository/{module}/    # MyBatis Mapper 인터페이스 (SQL은 sql.md 스타일)
├── external/{system}/      # 사내·외부 API 연동 클라이언트 (연동 프로젝트만 — integration.md)
├── common/                 # 봉투·예외·유틸 등 횡단 요소
└── config/                 # Security, Jackson, MyBatis 설정
src/main/resources/
├── mapper/{module}/        # MyBatis XML (쿼리 원문)
└── application.yml         # + application-{profile}.yml
```

- 흐름은 단방향(controller → service → repository — patterns.md 1절). 네이밍: `{Module}Controller` / `{Module}Service` / `{Module}Mapper`.
- 프로파일: `application.yml`(공통) + `application-dev.yml`/`application-prod.yml`. 시크릿은 yml에 쓰지 않고 환경변수 참조(`${DB_PASSWORD}`)로만 — 하드코딩 폴백(`${DB_PASSWORD:1234}`) 금지 (patterns.md 4절).

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
    @ExceptionHandler(NotFoundException.class)
    public ResponseEntity<ErrorResponse> handleNotFound(NotFoundException e) {
        return ResponseEntity.status(404).body(new ErrorResponse(e.getMessage(), "NOT_FOUND", null));
    }
    // ValidationException → 400, ForbiddenException → 403, 최후 Exception → 500
}
```

- 타입 있는 예외 계층(`ValidationError`/`NotFoundError`/`ForbiddenError` 대응)을 `common/`에 정의하고, 상태코드 매핑은 이 한 곳에서만 한다 (patterns.md 3절).
- 최후 방어 핸들러(500)는 스택트레이스·SQL을 응답에 싣지 않는다 — 로그로만 (ops.md 3절).

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
- 날짜 직렬화는 ISO 8601 고정(`LocalDate`/`LocalDateTime` + jackson-datatype-jsr310 기본), 시간대는 앱·DB 통일(database.md 1절).
- 테스트: **JUnit 5 + `@WebMvcTest`/`MockMvc`**(API 계약) + 순수 단위 테스트(서비스 도메인 로직 — 컨텍스트 없이). 실행은 `./gradlew test` (testing.md의 `npm test` 대응).
- 리버스 프록시 뒤에서는 `server.forward-headers-strategy: framework` 설정 — Express `trust proxy`의 대응 (docker.md 7절).
