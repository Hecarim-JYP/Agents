# 레시피: 외부 노출 ID — 순번 PK를 URL·API에 내보내지 않는다 `[대외]` ⚑

> 확정: 2026-10-16 | 원칙: database.md 4·7절(BIGINT PK), api.md 1절(URL) | 짝: auth.md 4-2절(소유권 검증), upload-security.md(파일 URL) | 시작 결정: scaffolds/default.md 체크리스트 28
> 내부 PK(BIGINT 순번)는 그대로 두고, **밖으로 나가는 테이블에만 랜덤 공개 ID 컬럼을 추가**한다. 공개 ID는 **권한 검사를 대체하지 않는다** — 추측을 어렵게 할 뿐이다.

## 1. 언제 쓰나

외부 이용자가 보는 URL·API 응답에 레코드 ID가 실리는 대외 서비스. 순번 ID는 ① 사업 규모를 드러내고(주문번호 간격으로 하루 주문 수를 추정), ② 권한 검사가 하나라도 빠진 API에서 번호를 1씩 올려 남의 데이터를 긁어 가는 통로가 된다. 사내 시스템은 기본 적용하지 않는다.

⚑ **API 계약이라 나중에 바꾸기 어렵다** — 한번 내보낸 ID는 이용자 북마크·외부 연동·공유 링크에 박힌다. 시작할 때 정한다.

## 2. 결정 항목 (기본값)

| 결정 | 기본값 | 대안 / 비고 |
|---|---|---|
| 적용 범위 | **외부 URL·API에 ID가 나가는 테이블만** (회원, 주문, 게시글, 파일 등) | 코드성·내부 테이블은 BIGINT 그대로 |
| 형식 | **16바이트 랜덤 → base64url 앞 21자 (126비트)** | UUID v4(36자)도 가능. **UUID v7·ULID는 생성 시각이 드러난다** — 순번과 같은 추정이 가능 |
| 컬럼 | `public_id CHAR(21) CHARACTER SET ascii COLLATE ascii_bin NOT NULL` + UNIQUE | 테이블 기본 콜레이션(`utf8mb4_unicode_ci`) 금지 — 4절 |
| PK | **BIGINT 유지** — 조인·논리 FK·인덱스는 내부 PK로 | 공개 ID를 PK로 쓰지 않는다 — 4절 |
| API 계약 | **요청·응답의 모든 ID 필드 = 공개 ID.** 내부 PK는 응답에 싣지 않는다 | 참조 필드(`customer_id` 등)도 공개 ID로 — 아니면 거기로 순번이 샌다 |
| 생성 | **앱이 INSERT할 때 생성**, 충돌은 UNIQUE가 최종 방어 | 126비트라 재시도 루프가 필요 없다 |

## 3. 표준 설계

### 3-1. 컬럼과 생성

```sql
-- 신규 테이블: PK 바로 아래에 둔다
public_id  CHAR(21) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,   -- 외부 노출 ID (public-id.md)
UNIQUE KEY uq_{테이블명}_public_id (public_id)
```

```js
import { randomBytes } from 'node:crypto';

/** 외부 노출 ID — 126비트 랜덤, URL에 그대로 쓸 수 있는 base64url 21자 (A-Z a-z 0-9 - _) */
export const newPublicId = () => randomBytes(16).toString('base64url').slice(0, 21);
```

- 운영 중인 테이블에 추가할 때는 migration.md의 2단계 배포를 따른다 — 컬럼을 NULL 허용으로 추가 → 기존 행 채우기 → NOT NULL + UNIQUE.

### 3-2. 경계에서 변환한다

```
GET /api/orders/:publicId
 route      : publicId 형식 검사(21자, base64url 문자) → 아니면 404
 repository : SELECT … FROM orders WHERE public_id = :publicId        ← 내부 PK를 얻는다
 service    : 소유권·스코프 검사 (auth.md 4-2절) → 이후 로직은 내부 PK로
 응답 매핑  : { id: row.public_id, customer_id: customer.public_id, … }   ← 내부 PK 필드를 싣지 않는다
```

- 응답의 참조 필드를 공개 ID로 바꾸려면 참조 테이블을 조인해야 한다 — 목록 쿼리에서 빠뜨리기 쉬운 자리다(4절).
- 요청 본문의 참조 ID(`{ customer_id: "Xy3…" }`)도 서비스 진입 시 내부 PK로 변환하고, **변환 결과가 없으면 404가 아니라 400**(요청 값 오류)으로 응답한다.

## 4. 함정 (STRICT)

| 함정 | 증상 | 처방 |
|---|---|---|
| 기본 콜레이션(`utf8mb4_unicode_ci`)에 저장 | 대소문자만 다른 ID가 **중복으로 거부**되고, 대문자로 바꾼 ID로 **다른 행이 조회**된다 (실측 2026-10-16, MariaDB 10.11 — `ascii_bin`은 둘 다 정상) | `ascii_bin` |
| 공개 ID를 권한 검사 대신으로 | ID가 한 번 새면(공유 링크·로그·브라우저 기록) 그대로 열린다 | 소유권 검증 유지 (auth.md 4-2절) |
| 응답 참조 필드에 내부 PK | 순번이 그 필드로 샌다 | 참조 필드도 공개 ID |
| 공개 ID를 PK로 (`CHAR(36)` UUID) | **보조 인덱스마다 PK가 함께 저장돼 커진다** — 같은 `(owner_id, status)` 인덱스가 BIGINT PK 6.5MB → CHAR(36) PK 12.6MB (실측 20만 행) | BIGINT PK 유지 |
| UUID v7·ULID | 생성 시각이 드러나 간격으로 규모 추정 | 랜덤(v4·3-1절) |

- 참고: "랜덤 PK는 INSERT가 느리다"는 이 규모에서는 나타나지 않았다 (실측 20만 행: CHAR(36) PK 1,107ms vs BIGINT PK + 공개 ID UNIQUE 1,711ms — 버퍼 풀 안에서는 페이지 분할 비용이 보이지 않는다). **BIGINT PK를 유지하는 이유는 INSERT 속도가 아니라 표준 스키마·논리 FK 타입의 일관성과 보조 인덱스 크기다.**

## 5. 스택별 구현

| 구성 | Express | Spring |
|---|---|---|
| 생성 | `randomBytes(16).toString('base64url').slice(0, 21)` | `SecureRandom` 16바이트 → `Base64.getUrlEncoder().withoutPadding()` → 앞 21자 |
| 경로 | `/orders/:publicId` | `@GetMapping("/orders/{publicId}")` + `@PathVariable String publicId` |
| 응답 매핑 | 응답 DTO 변환 함수에서 `id: row.public_id` | 응답 DTO(record)에 `String id` — 엔티티의 내부 PK 필드를 DTO에 두지 않는다 |

## 6. 검증 포인트

- 자동화 테스트: 응답 JSON에 숫자 ID가 없는지(모든 `id`·`*_id` 값이 21자 문자열) / 대소문자를 바꾼 ID → 404 / 다른 사용자의 공개 ID → 403·404(소유권 검사 동작).
- 실동작 검증(/live-test): 화면 주소창·네트워크 탭에 순번이 보이지 않는지, 목록→상세→수정 흐름이 공개 ID로 끝까지 이어지는지.
