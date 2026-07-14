# 사내·외부 API 연동 컨벤션 (JYP)

백엔드가 밖으로 나가는 호출(사내 API서버, 외부 서비스)에 적용한다. **연동 여부는 프로젝트 시작 시 결정**(스캐폴드 체크리스트)하고, 연동 대상의 주소·인증 방식·담당 창구를 CLAUDE.md에 기록한다.

## 1. 호출 경로 — 백엔드 경유 원칙 (STRICT)

- **프론트는 사내 API서버를 직접 호출하지 않는다 — 항상 자기 백엔드를 경유한다** (근거: 직접 호출하면 사내 API 인증 자격이 브라우저에 노출되고, 동일 출처로 없앤 CORS가 되살아나고, 사내 API 계약 변경이 화면 코드까지 직격한다). 프론트가 아는 API는 `/api/*` 하나뿐이다 (react.md 7절).
- **타 사내 서비스와의 통신도 사내 API서버를 경유한다** — 서비스끼리 직접 붙지 않는다 (기존 사내 통신 체계 유지: 연동 지점이 하나여야 계약·장애 추적이 한 곳에 모인다).

## 2. 연동 클라이언트 계층

- 서비스가 HTTP 호출을 직접 하지 않는다 — **연동 대상 시스템별 클라이언트 모듈 하나**로 감싼다 (react.md 7절 "공용 인스턴스 하나"의 서버판):

```
src/external/{system}/     # Express — 예: src/external/hqApi/hqApiClient.ts
{base}/external/{system}/  # Spring  — 예: external/hqapi/HqApiClient.java
```

- 계층 흐름: controller → service → (repository | **external**). external은 데이터 접근 계층과 동급이다 — 호출과 변환만 하고 비즈니스 판단을 두지 않는다 (patterns.md 1절).
- 클라이언트는 외부 응답을 **자체 도메인 타입으로 변환해서 반환**한다 — 외부 응답 구조가 서비스·화면까지 흘러가면 외부 계약 변경이 전 계층을 관통한다.

## 3. 설정 (STRICT)

- 주소·인증 키는 환경변수로만: 표준 키 `INTERNAL_API_URL` / `INTERNAL_API_KEY` (연동 대상이 늘면 `{SYSTEM}_API_URL` 패턴). 하드코딩·폴백 금지 (patterns.md 4절), `.env.example`에 키 추가.
- 개발서버용/운영용 엔드포인트 분리는 서버별 `.env` 값으로 — 코드 분기 금지 (docker.md 4-1절과 동일 원리).

## 4. 타임아웃·재시도 (STRICT)

- **모든 아웃바운드 호출에 타임아웃을 명시한다** — 기본 5초, 무거운 호출만 개별 상향 (근거: HTTP 클라이언트 기본값은 사실상 무제한 — 사내 API의 지연이 우리 서비스 전체의 멈춤으로 전파되는 사고의 단골).
- 재시도는 **멱등 요청(GET)만**, 짧은 백오프로 1~2회. 쓰기(POST/PUT/DELETE)는 재시도 금지 — 상대가 처리했는데 응답만 유실된 경우 중복 처리가 된다 (꼭 필요하면 멱등 키를 협의).

## 5. 에러 매핑·응답 검증

- 연동 실패는 **자체 에러 타입**(예: `ExternalApiError` → 502)으로 변환해 중앙 핸들러가 봉투 계약(api.md 5절)으로 응답한다 — 외부 에러 본문을 클라이언트에 그대로 흘리지 않는다 (에러 규격이 이중화되고 내부 정보가 노출된다).
- **외부 API 응답도 신뢰 경계 밖의 입력이다** (patterns.md 4절) — 사용하는 필드만 경계 검증(zod 등)을 거쳐 도메인 타입으로 받는다. 상대가 스키마를 바꿨을 때 조용한 undefined 전파 대신 명확한 에러로 드러나게.

## 6. 장애 격리

- **`/health`에 외부 API 확인을 포함하지 않는다** (근거: 사내 API 장애가 우리 컨테이너의 HEALTHCHECK 실패 → 재시작 루프로 번진다 — 남의 장애로 우리가 죽는 구조). 연동 상태 확인이 필요하면 별도 엔드포인트나 로그로.
- 외부 장애 시에도 연동과 무관한 코어 기능은 동작해야 한다. 연동 실패의 사용자 메시지는 원인을 구분해 준다 ("저장 실패" ✗ → "사내 API 응답 없음 — 잠시 후 재시도" ○).

## 7. 로깅·테스트

- 아웃바운드 호출은 대상 시스템·경로·소요 시간·성공 여부를 로깅한다 — 인증 키·요청/응답 본문 전체는 로그 금지 (ops.md 3절).
- 테스트는 external 계층을 mock 경계로 삼는다 — 실제 사내 API를 호출하는 테스트 금지 (testing.md 1절: 단위 테스트는 외부 의존 없이).

## 8. 스택별 구현 노트

| 구성 | Express | Spring |
|---|---|---|
| 클라이언트 | axios 인스턴스(baseURL·timeout·키 헤더) — `src/external/{system}/` | `RestClient`(6.1+) 빈 — `external/{system}/` |
| 타임아웃 | 인스턴스 `timeout` 옵션 | requestFactory의 connect/read timeout |
| 에러 변환 | catch → `ExternalApiError` throw → errorHandler | 커스텀 예외 → `@RestControllerAdvice` |
| 응답 검증 | zod 스키마 | record DTO + 필수 필드 검증 |
| 테스트 mock | Vitest `vi.mock` (또는 msw) | `MockRestServiceServer` / `@MockBean` |
