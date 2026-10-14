# 레시피: 캐시와 무효화 `[공통]`

> 확정: 2026-10-14 | 원칙: patterns.md 0-3절(인메모리 캐시는 단일 인스턴스 전제로만 허용) | 짝: domain-event.md(커밋 후 무효화), maintenance-mode.md(설정 캐시)
> **캐시하지 않는 것이 기본이다.** 느린 조회를 측정으로 확인한 뒤, 바뀌는 빈도가 낮은 것만 짧은 TTL로 캐시하고, 바꾸는 쪽이 **커밋한 뒤에** 지운다.

## 1. 언제 쓰나

| 대상 | 캐시 | 기본 TTL |
|---|---|---|
| 공통코드·메뉴 구성 | O | 5분 + 변경 시 즉시 무효화 |
| 권한(역할 → 권한 코드) | O — auth.md 4-3절 "매 요청 조회 + 짧은 캐시" | 30초 |
| 운영 설정(점검·배너·기능 스위치) | O (maintenance-mode.md) | 30초 |
| 사내 API 조회 결과(조직도 등) | O | 10분 |
| 업무 데이터(주문·문서 목록·상세) | **X** — 정합성이 깨지면 업무 사고 | — |
| 화면 정적 자산 | HTTP 캐시 (3-4절) | 해시 파일 1년 / index.html 없음 |

- 캐시를 넣기 전에 **느린 쿼리인지(인덱스로 해결되는지)부터** 본다 — 인덱스 문제를 캐시로 덮으면 무효화 버그만 늘어난다.

## 2. 결정 항목 (기본값)

| 결정 | 기본값 | 대안 |
|---|---|---|
| 저장 위치 | **프로세스 메모리** — CLAUDE.md "다중화 전환 목록"에 기록 (patterns.md 0-3절) | 인스턴스 2개 이상이면 Redis + 무효화 전파 |
| 무효화 | **TTL + 변경 시 즉시 삭제** (같은 프로세스) | TTL만 — 변경 반영이 TTL만큼 늦어도 되는 데이터 |
| 크기 | 캐시마다 최대 항목 수 지정 | |

## 3. 표준 설계

### 3-1. 캐시 모듈 — TTL·동시 조회 합치기·크기 상한

```js
/**
 * 프로세스 메모리 TTL 캐시 — 같은 키의 동시 조회는 로딩 1번을 함께 기다린다(single-flight), 크기 상한을 넘으면 먼저 들어온 것부터 버린다
 * @param {{ ttlMs: number, maxEntries: number }} opt 유효 시간과 최대 항목 수
 */
export function createTtlCache({ ttlMs, maxEntries }) {
  const entries = new Map();     // key → { value, expiresAt } — Map은 삽입 순서를 유지하므로 맨 앞이 가장 먼저 들어온 항목
  const inFlight = new Map();    // key → 진행 중인 로딩 Promise
  return {
    /**
     * 캐시에 있으면 반환, 없으면 loader로 읽어 저장한다
     * @param {string} key 스코프(회사·역할 등)를 포함한 키
     * @param {() => Promise<any>} loader DB·외부 조회
     */
    async get(key, loader) {
      const hit = entries.get(key);
      if (hit && hit.expiresAt > Date.now()) return hit.value;
      if (inFlight.has(key)) return inFlight.get(key);          // 이미 누가 읽는 중이면 그 결과를 같이 기다린다
      const p = (async () => {
        try {
          const value = await loader();
          entries.delete(key);
          entries.set(key, { value, expiresAt: Date.now() + ttlMs });
          if (entries.size > maxEntries) entries.delete(entries.keys().next().value);   // 가장 먼저 들어온 항목 제거
          return value;
        } finally {
          inFlight.delete(key);                                  // 실패해도 다음 요청이 다시 시도할 수 있게
        }
      })();
      inFlight.set(key, p);
      return p;
    },
    /** 무효화 — 반드시 데이터 변경이 커밋된 뒤에 호출한다 (3-2절) */
    invalidate(key) { entries.delete(key); },
  };
}
```

실측(2026-10-14, Node 22): 동시 50요청 → 로딩 1회 / TTL 경과 후 재로딩 / 상한 초과 시 가장 먼저 들어온 항목 제거 / 로딩 실패는 캐시에 남지 않고 다음 요청이 재시도.

### 3-2. 무효화 — 커밋 후에

```
변경 서비스:  BEGIN → UPDATE common_code … → COMMIT → cache.invalidate('code:{company_id}:{group}')
```

- 커밋 **전에** 지우면, 지운 순간과 커밋 사이에 다른 요청이 **아직 커밋 전의 옛 값**을 읽어 다시 캐시한다 → TTL 동안 옛 값이 남는다 (3-1절 실측과 같은 날 MariaDB로 재현: 커밋 전 무효화 → 옛 명칭 / 커밋 후 무효화 → 새 명칭).
- 서비스 코드에서 커밋 뒤에 직접 지우거나, 커밋 후 도메인 이벤트 리스너에서 지운다 (domain-event.md — 놓쳐도 TTL이 복구하는 "놓쳐도 되는" 후속 처리의 전형).

### 3-3. 키 설계

- 키에 **데이터 스코프를 모두 넣는다**: `perm:{company_id}:{role_code}`, `code:{company_id}:{group_code}:{locale}`. 스코프가 빠지면 A사 사용자의 결과가 B사 사용자에게 나간다 (auth.md 4-2절).
- 사용자별 데이터는 캐시하지 않는 것이 기본이다 — 해야 한다면 키에 `user_id`.

### 3-4. 화면 정적 자산 (HTTP 캐시)

- 스캐폴드 client nginx 템플릿이 이미 처리한다: 해시가 붙은 `/assets/*`는 1년 `immutable`, `index.html`은 `no-cache` (실측: `/`, 딥링크 `/orders/123`, `/index.html` 모두 `no-cache` / 해시 자산 `max-age=31536000, immutable` / 없는 자산은 404).
- ⚠ **배포 직후 열려 있던 화면**은 옛 index.html이 가리키는 옛 청크를 지연 로딩하다 404를 만난다(새 이미지에는 옛 파일이 없다). Vite의 `vite:preloadError` 이벤트에서 **한 번만** 새로고침한다(무한 새로고침 방지 플래그와 함께).

## 4. 함정 (STRICT)

| 함정 | 증상 | 처방 |
|---|---|---|
| 커밋 전 무효화 | TTL 동안 옛 값이 고정된다 (실측) | 커밋 후 (3-2절) |
| 키에 스코프 누락 | 다른 회사·다른 역할의 데이터가 섞여 나간다 | 3-3절 |
| 동시 미스 방치 | 캐시가 비는 순간 같은 조회가 수십 번 동시에 DB로 (캐시 쇄도) | single-flight (3-1절) |
| 크기 상한 없음 | 키 종류가 늘수록 메모리가 계속 커진다 | `maxEntries` |
| 로딩 실패를 캐시 | 일시 장애가 TTL 동안 고정된다 | 실패는 저장하지 않는다 (3-1절) |
| 인스턴스 2개에서 인메모리 캐시 | 한쪽만 무효화돼 요청마다 값이 다르다 | 다중화 전환 목록 기록 → 전환 시 Redis |
| 업무 데이터 캐시 | 수정 직후 목록에 옛 값 — "저장이 안 돼요" 문의 | 업무 데이터는 캐시하지 않는다 |

## 5. 스택별 구현

| 구성 | Express | Spring |
|---|---|---|
| 인메모리 캐시 | 3-1절 모듈 (의존성 없음) | Caffeine + Spring Cache(`@Cacheable`) — `expireAfterWrite`, `maximumSize` |
| 커밋 후 무효화 | 서비스에서 commit 뒤 `invalidate` | `@CacheEvict`는 메서드가 끝날 때 실행되는데, 그것이 트랜잭션 커밋보다 앞인지는 프록시 적용 순서에 달려 있다 — 커밋 후를 확실히 하려면 `@TransactionalEventListener(AFTER_COMMIT)`에서 `cache.evict` (domain-event.md 5절) |
| 동시 미스 | 3-1절 inFlight | Caffeine `get(key, mappingFunction)`이 같은 키 로딩을 한 번으로 묶는다 |

## 6. 검증 포인트

- 자동화 테스트: 변경 → 커밋 → 다음 조회가 새 값 / 스코프가 다른 두 사용자의 결과가 섞이지 않는다.
- 실동작 검증(/live-test): 관리 화면에서 공통코드 명칭 변경 → 다른 브라우저에서 즉시(또는 TTL 안에) 새 명칭. 배포 직후 열려 있던 화면에서 다른 메뉴로 이동해도 깨지지 않는지.
