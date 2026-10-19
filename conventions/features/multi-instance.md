# 레시피: 다중 인스턴스 전환 — 앱을 2개 이상으로 늘릴 때 손볼 것 `[대외]` ⚑

> 확정: 2026-10-19 | 원칙: patterns.md 0-3절(앱 프로세스에 상태를 두지 않는다 — 단일 인스턴스 의존 항목은 "다중화 전환 목록"에 기록) | 짝: zero-downtime-deploy.md(배포 순간엔 늘 2개), cache.md, rate-limit.md, batch.md
> 인스턴스를 늘리는 순간 **프로세스 메모리에 둔 모든 것이 인스턴스 수만큼 갈라진다.** 전환은 CLAUDE.md의 "다중화 전환 목록"을 위에서부터 지우는 작업이다 — 목록이 없으면 이 레시피 4절 표로 점검한다.

## 1. 언제 쓰나

- 대외 서비스의 트래픽·가용성 요구로 앱을 2개 이상 띄울 때.
- **순차 교체(zero-downtime-deploy.md 3-3절)를 쓰면 배포 순간마다 2개가 된다** — 다중 인스턴스를 의도하지 않아도 이 레시피가 적용된다.
- ⚑ 되돌리기 어려운 이유: 공유 저장소(Redis 등)·파일 저장 위치가 인프라 구성이 된다. 시작 단계에서 "언젠가 늘릴 것인가"만 정해 두면 patterns.md 0-3절 표가 비용을 대부분 막아 준다.

## 2. 결정 항목 (기본값)

| 결정 | 기본값 | 대안 / 비고 |
|---|---|---|
| 늘리는 방법 | **같은 호스트에서 `--scale server=N`** — 프록시가 Docker DNS로 N개에 나눠 보낸다(템플릿, 실측 분포 112:88) | 여러 호스트면 로드밸런서·공유 스토리지 — 이 레시피 범위 밖(별도 설계) |
| 공유 저장소 | **Redis 1대** — 빈도 제한 카운터 + 캐시 무효화 방송 | DB 테이블로 대신할 수 있는 것(발송 한도·작업 대기열)은 DB로 |
| 캐시 | **인스턴스 메모리 캐시 유지 + 무효화만 Redis pub/sub으로 방송** | 캐시 자체를 Redis로 — 조회마다 네트워크 왕복이 생긴다 |
| 업로드 파일 | **같은 호스트면 named volume 그대로**(복제본이 같은 볼륨 공유 — 실측) | 여러 호스트면 NFS·오브젝트 스토리지 |
| 배치 | **별도 컨테이너 + 호스트 cron**(batch.md 1절 b) — 이미 다중화 안전 | 앱 내 스케줄러(a)를 쓰고 있었다면 전환 필수 |
| DB 커넥션 | **`인스턴스 수 × 풀 크기 + 배치·마이그레이션·관리 여유 ≤ max_connections`** | MariaDB 11.4 기본 `max_connections` 151 (실측) |

## 3. 표준 설계

### 3-1. 무엇이 갈라지는가 — 실측

같은 앱 2개 + nginx 라운드로빈 (2026-10-19, Node 22 · Express 4.22 · express-rate-limit 7.5 · MariaDB 10.11):

| 상태 | 메모리에 둔 구현 | 처방 후 |
|---|---|---|
| 빈도 제한 3회/분 (같은 IP 8회) | 200×6 → 429 — **한도가 인스턴스 수만큼 늘어남** | Redis 저장소: 200×3 → 429×5 |
| 설정 변경 후 조회 (캐시 60초) | 변경한 A만 새 값, **B는 TTL까지 옛 값** (요청마다 번갈아 다름) | Redis pub/sub 무효화: A·B 모두 새 값 |
| 업로드 1회 후 다운로드 6회 (인스턴스별 디스크) | **404·200 번갈아** | 같은 호스트 named volume: 복제본 간 공유 (Docker 실측) |
| 앱 내 스케줄러 "하루 1회" | **A·B 두 번 실행** | 배치 컨테이너 (batch.md 1절 b) |

### 3-2. 빈도 제한 — Redis 저장소

```js
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { createClient } from 'redis';

const redis = createClient({ url: process.env.REDIS_URL });   // 없으면 기동 실패 (폴백 금지 — patterns.md 4절)
await redis.connect();

app.use('/api', rateLimit({
  windowMs: 60_000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false,
  store: new RedisStore({ sendCommand: (...args) => redis.sendCommand(args), prefix: 'rl:api:' }),   // 한도별로 prefix를 나눈다
}));
```

### 3-3. 캐시 무효화 — 방송

```js
// cache.md 3-1절 메모리 캐시는 그대로 두고, 무효화만 모든 인스턴스에 알린다
const subscriber = redis.duplicate();                 // 구독 모드 연결은 다른 명령을 못 쓴다 — 별도 연결
await subscriber.connect();
await subscriber.subscribe('cache:invalidate', (key) => cache.delete(key));

/** 데이터 변경 후(커밋 후 — domain-event.md) 호출: 모든 인스턴스의 해당 키를 지운다 */
export const invalidateEverywhere = (key) => redis.publish('cache:invalidate', key);
```

- 방송은 **놓칠 수 있다**(구독 연결이 끊긴 동안의 메시지는 오지 않는다) — 캐시 TTL은 그대로 둬서, 놓쳐도 TTL 뒤에는 맞춰지게 한다(cache.md 2절).

### 3-4. 전환 순서

1. CLAUDE.md "다중화 전환 목록" 확인 — 없으면 4절 표로 코드를 훑는다(`new Map(` 전역, `setInterval`·`node-cron`, `fs.writeFile` 로컬 경로, `express-rate-limit`의 기본 저장소).
2. Redis를 compose에 추가하고 `REDIS_URL` 주입 → 3-2·3-3절 적용.
3. DB 커넥션 예산 계산(2절) → 풀 크기 조정 (load-test.md 3-2절로 확인).
4. `docker compose up -d --scale server=2` → 4절 표의 항목을 배포 구성에서 하나씩 재현해 본다(같은 IP로 한도 넘기기, 설정 변경 후 여러 번 조회).
5. 전환 목록에서 지우고 CLAUDE.md에 "인스턴스 N개 운영" 기록.

## 4. 함정 (STRICT)

| 함정 | 증상 | 처방 |
|---|---|---|
| 빈도 제한 기본(메모리) 저장소 | 한도가 인스턴스 수 배로 늘어남 (실측 3→6) | Redis 저장소 |
| 메모리 캐시를 한쪽만 무효화 | 요청마다 옛 값·새 값이 번갈아 나온다 (실측) | 무효화 방송 + TTL 유지 |
| 인스턴스별 디스크에 업로드 | 다운로드가 절반 404 (실측) | 공유 볼륨·스토리지 |
| 앱 내 스케줄러 | 정산·메일이 인스턴스 수만큼 (실측 2회) | 배치 컨테이너 |
| 풀 크기 × 인스턴스 > `max_connections` | 늘린 뒤 일부 요청이 "Too many connections" | 2절 예산 계산 |
| 프록시가 이름을 기동 때만 해석 | 늘린 인스턴스에 트래픽이 가지 않는다 | 템플릿의 재해석 설정 (zero-downtime-deploy.md 3-1절) |
| 인메모리 이벤트로 다른 인스턴스에 알림 | 다른 인스턴스는 못 받는다 | 반드시 전달할 것은 outbox (domain-event.md) |

## 5. 스택별 구현

| 구성 | Express | Spring |
|---|---|---|
| 빈도 제한 저장소 | `rate-limit-redis` 4.x + `redis` 4.x (실측) | Bucket4j + Redis 백엔드 (이 레시피에서 미검증) |
| 캐시 무효화 | `redis` pub/sub (실측) | Spring Data Redis `RedisMessageListenerContainer` (미검증) |
| 세션 | 무상태 토큰 + DB 세션(session-control.md) — 변경 없음 | 동일 |

## 6. 검증 포인트

- 배포 구성에서 `--scale server=2` 후: 같은 IP로 한도+1번째가 429인지, 설정 변경 직후 10회 조회가 모두 새 값인지, 업로드 직후 다운로드 10회가 모두 200인지 — 3-1절 표를 그대로 재현한다.
- `SHOW STATUS LIKE 'Threads_connected'`가 예산 안인지 (부하 중).
