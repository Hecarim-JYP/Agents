# 정기 배치·스케줄 작업 컨벤션

야간 집계, 사내 API 동기화, 알림 발송, 정리 작업 등 **주기적으로 도는 작업**에 적용한다. 컨테이너 무상태 원칙(docker.md 1절)과 충돌하기 쉬운 영역이라 즉흥 구현을 금지한다.

## 0. 구현 전 방식 확인 (MANDATORY)

**배치 작업을 처음 만들 때는 코드를 쓰기 전에 실행 방식(1절 a/b/c)과 스케줄·멱등 전략을 사용자에게 제안하고 확정받는다.** 이후 배치는 확정된 방식을 따르고 다시 묻지 않는다 (프로젝트 안에서 배치 실행 방식이 두 가지로 갈리는 것이 최악이다). 확정 내용은 CLAUDE.md에 기록한다.

제안에 포함할 것: 실행 방식과 근거 / 스케줄(시각·주기) / 재실행 안전 전략 / 실패 시 알림 경로 / 예상 소요 시간과 배포 시간대 충돌 여부.

## 1. 실행 방식 (셋 중 택일 — 프로젝트에서 하나만)

| | 방식 | 선택 기준 | 주의 |
|---|---|---|---|
| (a) | **앱 내 스케줄러** (`node-cron`, `@Scheduled`) | 앱 인스턴스가 **영구히 1개**임이 보장될 때만 | ⚠ 앱을 2개로 늘리는 순간 **모든 배치가 중복 실행**된다 (집계 2배, 메일 2회). 스케일아웃 계획이 조금이라도 있으면 선택 금지 |
| (b) | **별도 배치 컨테이너 + 호스트 cron** (권장) | 대부분의 경우 | 호스트 crontab이 `docker compose run --rm batch <작업명>`을 호출. 앱과 생명주기·자원이 분리되고, 배치가 길어져도 앱 배포에 영향이 없다 |
| (c) | **DB 락 기반 분산 스케줄러** (ShedLock 등) | 앱 다중화가 이미 확정된 경우 | 락 테이블 필요. 서버 1대 = 프로젝트 1개(docker.md 7절) 전제에서는 대개 과하다 |

- outbox relay는 정기 배치가 아니라 **상주 워커**다 — 이 절의 실행 방식 대신 `features/outbox.md` 2절을 따른다 (프로젝트의 배치 실행 방식 결정과 별개).
- **컨테이너 안 crontab(cron 데몬을 이미지에 넣기) 금지** — 컨테이너를 지웠다 만들면 사라지고, 실행 로그가 `docker logs`에 잡히지 않아 조용히 죽는다 (무상태 원칙 위반).
- (b)는 배치 컨테이너가 **앱과 같은 이미지**를 쓰고 진입점만 다르게 한다 (`CMD` 대신 배치 엔트리) — 코드·설정 중복 방지, 같은 이미지 태그로 배포된다. compose의 `batch` 서비스는 `profiles: ["tools"]`로 두어 `up`에 딸려 올라가지 않게 한다 (스캐폴드 템플릿의 deploy override 참조).
- **호스트 cron 등록** (배포 서버에서 1회, 절차는 handover 문서에 기록):

```cron
# /etc/cron.d/<프로젝트명>  — 새벽 2시 일별 집계
CRON_TZ=Asia/Seoul
0 2 * * * <배포계정> cd /srv/<프로젝트명> && docker compose run --rm batch daily-aggregate >> /var/log/<프로젝트명>-batch.log 2>&1
```

- `CRON_TZ` 명시(서버 로케일에 기대지 않는다), 출력은 로그 파일로 리다이렉트(배치도 stdout/stderr로 로깅 — docker.md 6절), 실패는 3절의 이력·알림으로 잡는다. 로그 파일은 logrotate 대상에 넣는다.

## 2. 배치 작성 규칙 (STRICT)

- **멱등하게 작성한다** — 같은 배치를 다시 돌려도 결과가 같아야 한다 (근거: 배치는 중간에 죽고, 죽으면 반드시 다시 돌린다. 재실행이 위험하면 장애 대응에서 손을 못 쓴다). 집계는 "누적 더하기"가 아니라 **대상 기간을 지우고 다시 계산**(delete+insert) 또는 upsert로.
- **처리 단위를 나눠 커밋한다** — 수만 건을 한 트랜잭션으로 묶지 않는다(잠금 시간·롤백 비용). 배치 크기(예: 1,000건)를 정하고 진행 상황을 기록한다.
- **부분 실패를 조용히 넘기지 않는다** — 건별 실패는 카운트·사유를 남기고, 임계치를 넘으면 실패로 처리한다.
- **타임존은 `Asia/Seoul` 명시** (컨테이너 기본은 UTC — "새벽 2시 배치"가 오전 11시에 도는 고전 버그). 컨테이너 `TZ` 환경변수 + cron 스케줄 기준을 CLAUDE.md에 기록한다.
- 사내 API를 호출하는 배치(동기화 등)는 **`external/` 연동 계층을 재사용**한다 (integration.md 2절) — 배치용 HTTP 코드를 따로 만들지 않는다. 타임아웃·재시도 규칙도 그대로 적용.
- 비즈니스 로직은 서비스 계층을 재사용한다 — 배치 스크립트에 로직을 복제하지 않는다 (patterns.md 2절 SSOT).

## 3. 실행 이력과 실패 알림 (STRICT)

**조용한 실패가 배치의 기본 사고 유형이다** — 며칠 뒤 "숫자가 안 맞아요"로 발견되면 원인 추적이 불가능하다. 방어는 **두 층이 필요하다**: 층 1은 배치가 실행되기라도 했을 때만 작동하고, 실무에서 더 흔한 실패(cron 미기동, 이미지 pull 실패, 컨테이너 OOM)는 층 2만 잡는다.

- 모든 배치는 **실행 이력을 DB에 남긴다**: 배치명, 시작·종료 시각, 상태(성공/실패), 처리 건수, 실패 사유. 표준 스키마 `06_batch_history.sql`을 복사해 쓴다.
- **층 1 — 배치가 실패를 감지하면 스스로 알린다** (메일·메신저). 이력을 기록하는 지점에서 함께 처리한다.
- **층 2 — 배치 상태를 폴링 가능한 엔드포인트로 노출하고 감시 도구에 등록한다.** `batch_history`를 조회해 "정상 시간 내에 성공했나"를 200/비200으로 답한다(기준·구현은 3-1절) — 배치가 아예 실행되지 않아도 빨간불이 되므로, 층 1이 못 잡는 실패가 여기서 잡힌다.
  - ⚠ **`/health`에 넣지 않는다 (STRICT)** — 컨테이너 HEALTHCHECK가 그 경로를 보므로, 배치 실패로 500을 반환하면 **멀쩡한 앱이 unhealthy 판정을 받아 재시작 루프**에 빠진다 (integration.md 6절 "남의 장애로 우리가 죽는 구조"와 같은 함정). 별도 경로로 둔다.
  - **알림 수신자는 개발팀이어야 한다** — 사내 모니터링 시스템이 있으면 URL을 등록하고 수신자를 지정한다. 다른 팀이 받으면 사람 중계가 되는데, 서버 다운과 달리 **배치 실패는 남이 보고 판단해줄 수 없다**(업무 로직 문제라 그 팀에는 이상해 보이지 않는다). 사내 시스템이 없으면 자체 구축(ops.md 7절 b), 둘 다 불가하면 "배치 미실행은 자동 감지 불가"를 한계로 CLAUDE.md에 기록한다.
- 알림 경로가 없는 배치는 배포하지 않는다 — 수단·수신자·감시 등록은 배치 도입 시 확정한다 (0절).
- 배치 실행 이력을 확인하는 관리 화면 또는 조회 방법을 CLAUDE.md에 기록한다.

### 3-1. 운영 감시 엔드포인트 — 층 2의 기본 구현 (MANDATORY, 2026-10-21 확정)

배치 상태(층 2)와 outbox 적체(features/outbox.md 3-5절)를 **`GET /api/ops/status` 하나**로 답한다 — 감시 도구에 URL 하나만 등록한다. 백업 서비스가 남기는 `DB_BACKUP`·`DISK_CHECK`(ops.md 6·8절)도 이 목록으로 감시한다 — 엔드포인트가 없으면 백업 실패·디스크 부족은 기록만 남고 아무도 모른다.

| 판정 (하나라도 해당하면 503) | 근거 |
|---|---|
| 감시 목록의 배치에 **실행 기록이 한 번도 없다** | cron 미등록·이미지 pull 실패 — 층 1이 못 잡는 실패 |
| **마지막 실행이 FAILED** — 그 전에 성공이 있어도 | 디스크 검사처럼 매일 상태가 바뀌는 항목은 마지막 결과가 현재 상태다 |
| **RUNNING으로 기준 시간(기본 120분)을 넘겼다** | 컨테이너 OOM·강제 종료로 종료 기록 없이 죽은 실행 |
| **마지막 성공이 허용 간격(배치별 — 실행 주기 + 여유)보다 오래됐다** | 실패해도 기록을 남기지 않는 배치(예: `backup.sh`의 `DB_BACKUP`)는 여기서 잡힌다 |
| (outbox 사용 시) 발송 시각이 10분 넘게 지난 PENDING, 또는 FAILED가 남아 있다 | features/outbox.md 3-5절 조건 그대로 |
| 상태 조회 자체가 실패했다 (DB 접속 불가 등) | 확인할 수 없는 것도 이상이다 |

- **허용 간격 목록은 코드 상수로 둔다** — 배치를 추가하는 PR에서 목록도 함께 고친다(리뷰에서 보인다). 목록에 없는 배치는 감시되지 않는다.
- **경과 시간은 DB에서 계산한다 (STRICT)** — `TIMESTAMPDIFF(MINUTE, …, NOW())`. 실측: DATETIME을 앱으로 가져와 앱 시계와 빼면, 앱 프로세스가 UTC(컨테이너 기본)이고 DB가 KST일 때 **180분 전 성공이 -360분**으로 계산됐다(mysql2 기본 `timezone: 'local'`). DB에서 계산하면 앱 시간대와 무관하게 180분.
- **응답**: 판정은 상태 코드(200/503)로 한다 — 감시 도구는 코드만 본다. 본문은 사람이 원인을 보는 용도라 503에서도 같은 `data` 봉투(api.md 5절)를 쓴다: `{"data":{"status":"FAIL","checks":[{"name":"DISK_CHECK","ok":false,"detail":"마지막 실행 실패 (170분 전 시작)"}]}}`. 본문에는 배치명·판정만 — 업무 데이터는 넣지 않는다. `Cache-Control: no-store`.
- **위치·인증**: `/health`와 별도 경로다(위 STRICT — 실측: 503인 동안에도 `/health`·`/actuator/health`는 200·UP). 감시 도구는 로그인하지 않으므로 **인증 미들웨어보다 먼저 마운트**(Express)하거나 **`SecurityFilterChain` 공개 경로**(Spring)에 넣는다. 대신 프록시 템플릿(nginx-proxy.conf·Caddyfile)이 이 경로를 **사내 대역(사설 IP)에서만** 받는다:

| 실측 (2026-10-21, nginx 1.30·Caddy 2) | 사내 대역(172.30.0.0/24) | 외부 대역(203.0.113.0/24) |
|---|---|---|
| 템플릿 (대소문자 무시 정규식) | 엔드포인트 응답 | `/api/ops/status`·`/api/OPS/status`·`/api//ops/status`·`/api/%6fps/status` 모두 **403**, 일반 API는 그대로 |
| 대조군: nginx 접두 location `/api/ops/` | 같음 | **`/api/OPS/status` 통과** — nginx는 `/api/`로 보내고 Express는 경로 대소문자를 구분하지 않아 응답한다 |

  - 판정 기준은 프록시가 보는 접속 IP다. Docker 기본(iptables)으로 포트를 공개하면 접속 IP가 그대로 보인다(실측: 호스트의 비사설 IP 접속 → 403). 호스트 자신의 `127.0.0.1` 접속은 docker-proxy를 거쳐 게이트웨이 IP(사설)로 보여 허용된다. **앞단 NAT·LB가 있거나 userland-proxy만 쓰는 구성에서는 모든 접속이 사설 IP로 보여 제한이 무력하다** — 첫 배포 때 사외 회선(휴대폰 테더링 등)에서 403인지 확인한다(ops.md 5절 12번).
- **DB가 죽었을 때**: 두 스택 모두 503 — Express는 즉시(실측 21ms), Spring은 첫 요청만 즉시이고 이후는 커넥션 대기(Hikari 기본 30초) 뒤 503(실측 30,025ms). 감시 도구의 시간 초과도 장애로 판정되므로 어느 쪽이든 빨간불이다.
- **등록**: 감시 주기 5분 이내. 수신자는 개발팀 — 인프라팀 감시 도구에 등록하더라도 이 URL의 알림은 개발팀이 받게 지정한다(위 층 2). URL·수신자·감시 목록을 CLAUDE.md에 기록한다.
- 실측 (2026-10-21, MariaDB 11.4 — 아래 코드 그대로, 앱 TZ=UTC·DB TZ=KST): 기록 없음 503 / 3시간 전 성공 200 / 30시간 전 성공 503 / 마지막 실패 503 / RUNNING 3시간째 503 · 10분째 200 / outbox 지연 PENDING 503 · FAILED 503 · 정상 200 — Express·Spring 같은 결과.

Express (TS — `src/repository/ops/opsStatusQuery.ts`):

```ts
/**
 * 파일명 : opsStatusQuery.ts
 * 용도 : 운영 감시 엔드포인트의 조회 (batch.md 3-1절)
 */
import type { RowDataPacket } from 'mysql2';
import { getPool } from '../../common/db.js';

export type BatchRow = { batch_name: string; last_status: string; started_min: number; success_min: number | null };

/**
 * 감시 대상 배치별 마지막 실행 상태와 마지막 성공 경과(분)
 * 경과 시간은 DB에서 계산한다 — 앱과 DB의 시간대가 달라도 어긋나지 않는다
 * @param names 감시 대상 배치명 — 배열을 IN (?)에 넘기므로 execute가 아니라 query (sql.md 6절)
 * @returns 기록이 있는 배치만 (기록이 한 번도 없으면 빠진다 — 판정 쪽에서 실패로 본다)
 */
export const selectBatchStatus = async (names: string[]): Promise<BatchRow[]> => {
  const [rows] = await getPool().query<RowDataPacket[]>(
    `
    SELECT l.batch_name,
           l.status AS last_status,
           TIMESTAMPDIFF(MINUTE, l.started_at, NOW()) AS started_min,
           (SELECT TIMESTAMPDIFF(MINUTE, MAX(s.finished_at), NOW())
              FROM batch_history s
             WHERE s.batch_name = l.batch_name AND s.status = 'SUCCESS') AS success_min
      FROM (SELECT batch_name, status, started_at,
                   ROW_NUMBER() OVER (PARTITION BY batch_name ORDER BY started_at DESC, batch_history_id DESC) AS rn
              FROM batch_history
             WHERE batch_name IN (?)) l
     WHERE l.rn = 1
    `,
    [names],
  );
  return rows as BatchRow[];
};

/**
 * outbox 적체 — 발송 시각이 10분 넘게 지난 PENDING, 남아 있는 FAILED (features/outbox.md 3-5절)
 * @returns 각 건수
 */
export const selectOutboxBacklog = async (): Promise<{ stuck: number; failed: number }> => {
  const [rows] = await getPool().query<RowDataPacket[]>(
    `
    SELECT COALESCE(SUM(status = 'PENDING' AND next_attempt_at < NOW() - INTERVAL 10 MINUTE), 0) AS stuck,
           COALESCE(SUM(status = 'FAILED'), 0) AS failed
      FROM outbox_message
     WHERE status IN ('PENDING', 'FAILED')
    `,
  );
  return { stuck: Number(rows[0].stuck), failed: Number(rows[0].failed) };
};
```

`src/service/ops/opsStatusService.ts`:

```ts
/**
 * 파일명 : opsStatusService.ts
 * 용도 : 운영 감시 판정 — 하나라도 실패면 엔드포인트가 503 (batch.md 3-1절)
 */
import { selectBatchStatus, selectOutboxBacklog } from '../../repository/ops/opsStatusQuery.js';

// 감시 목록 — 배치명: 성공 기록이 이 시간 안에 있어야 정상 (실행 주기 + 여유). 배치를 추가하면 여기에도 넣는다
const BATCH_MAX_AGE_HOURS: Record<string, number> = {
  DB_BACKUP: 26,   // 매일 03:30 (ops.md 6절) + 2시간 여유
  DISK_CHECK: 26,  // 백업과 같은 실행에서 기록 (ops.md 8절)
};
const RUNNING_MAX_MINUTES = 120;   // RUNNING으로 이보다 오래 남으면 죽은 것으로 본다 — 가장 긴 배치 소요 시간 + 여유
const OUTBOX_ENABLED = false;      // 쓰기 연동(outbox)이 있는 프로젝트만 true (features/outbox.md 3-5절)

export type Check = { name: string; ok: boolean; detail: string };

/**
 * 배치 하나의 판정 — 기록 없음·마지막 실패·실행 중 멈춤·성공이 오래됨을 실패로 본다
 * @returns 판정 결과
 */
const judgeBatch = (name: string, maxAgeHours: number, row?: { last_status: string; started_min: number; success_min: number | null }): Check => {
  if (!row) return { name, ok: false, detail: '실행 기록 없음' };
  if (row.last_status === 'FAILED') return { name, ok: false, detail: `마지막 실행 실패 (${row.started_min}분 전 시작)` };
  if (row.last_status === 'RUNNING' && row.started_min > RUNNING_MAX_MINUTES) {
    return { name, ok: false, detail: `실행 중으로 ${row.started_min}분째 — 멈춘 것으로 본다` };
  }
  if (row.success_min === null) return { name, ok: false, detail: '성공 기록 없음' };
  if (row.success_min > maxAgeHours * 60) return { name, ok: false, detail: `마지막 성공 ${Math.floor(row.success_min / 60)}시간 전 (기준 ${maxAgeHours}시간)` };
  return { name, ok: true, detail: `마지막 성공 ${row.success_min}분 전` };
};

/**
 * 전체 판정 — DB 조회가 실패해도 실패로 답한다 (감시 대상이 확인 불가인 것도 이상이다)
 * @returns ok와 항목별 결과
 */
export const getOpsStatus = async (): Promise<{ ok: boolean; checks: Check[] }> => {
  try {
    const rows = await selectBatchStatus(Object.keys(BATCH_MAX_AGE_HOURS));
    const checks = Object.entries(BATCH_MAX_AGE_HOURS).map(([name, hours]) =>
      judgeBatch(name, hours, rows.find((r) => r.batch_name === name)));
    if (OUTBOX_ENABLED) {
      const { stuck, failed } = await selectOutboxBacklog();
      checks.push({ name: 'OUTBOX', ok: stuck === 0 && failed === 0, detail: `지연 PENDING ${stuck}건 · FAILED ${failed}건` });
    }
    return { ok: checks.every((c) => c.ok), checks };
  } catch (err) {
    console.error('[ops-status] 조회 실패', err);   // 맥락과 함께 남긴다 (ops.md 3절)
    return { ok: false, checks: [{ name: 'DB', ok: false, detail: '상태 조회 실패' }] };
  }
};
```

`src/controller/ops/opsController.ts` — `app.use('/api/ops', opsRouter)`를 인증 미들웨어보다 앞에 둔다:

```ts
/**
 * 파일명 : opsController.ts
 * 용도 : GET /api/ops/status — 감시 도구가 폴링한다 (batch.md 3-1절). 인증 미들웨어보다 먼저 마운트한다
 */
import { Router } from 'express';
import { getOpsStatus } from '../../service/ops/opsStatusService.js';

export const opsRouter = Router();

// 판정은 상태 코드(200/503)로 한다 — 본문은 사람이 원인을 보는 용도라 503에서도 같은 data 봉투를 쓴다
opsRouter.get('/status', async (_req, res) => {
  const { ok, checks } = await getOpsStatus();
  res.status(ok ? 200 : 503).set('Cache-Control', 'no-store').json({ data: { status: ok ? 'OK' : 'FAIL', checks } });
});
```

Spring (`repository/ops/OpsStatusRepository.java` — JdbcClient는 `:names`에 컬렉션을 넘기면 IN 목록으로 펼친다, 실측):

```java
/*
 * 파일명 : OpsStatusRepository.java
 */
package {base}.repository.ops;

import java.util.Collection;
import java.util.List;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

// 운영 감시 엔드포인트의 조회 (batch.md 3-1절) — 경과 시간은 DB에서 계산한다(앱과 DB의 시간대가 달라도 어긋나지 않는다)
@Repository
public class OpsStatusRepository {
  private final JdbcClient jdbc;

  public OpsStatusRepository(JdbcClient jdbc) {
    this.jdbc = jdbc;
  }

  /** 배치별 마지막 실행 상태와 마지막 성공 경과(분) — 기록이 한 번도 없는 배치는 결과에서 빠진다. */
  public List<BatchStatus> selectBatchStatus(Collection<String> names) {
    return jdbc.sql(
            """
            SELECT l.batch_name,
                   l.status AS last_status,
                   TIMESTAMPDIFF(MINUTE, l.started_at, NOW()) AS started_min,
                   (SELECT TIMESTAMPDIFF(MINUTE, MAX(s.finished_at), NOW())
                      FROM batch_history s
                     WHERE s.batch_name = l.batch_name AND s.status = 'SUCCESS') AS success_min
              FROM (SELECT batch_name, status, started_at,
                           ROW_NUMBER() OVER (PARTITION BY batch_name
                                              ORDER BY started_at DESC, batch_history_id DESC) AS rn
                      FROM batch_history
                     WHERE batch_name IN (:names)) l
             WHERE l.rn = 1
            """)
        .param("names", names)
        .query(BatchStatus.class)
        .list();
  }

  /** outbox 적체 — 발송 시각이 10분 넘게 지난 PENDING, 남아 있는 FAILED (features/outbox.md 3-5절). */
  public OutboxBacklog selectOutboxBacklog() {
    return jdbc.sql(
            """
            SELECT COALESCE(SUM(status = 'PENDING' AND next_attempt_at < NOW() - INTERVAL 10 MINUTE), 0) AS stuck,
                   COALESCE(SUM(status = 'FAILED'), 0) AS failed
              FROM outbox_message
             WHERE status IN ('PENDING', 'FAILED')
            """)
        .query(OutboxBacklog.class)
        .single();
  }

  public record BatchStatus(
      String batchName, String lastStatus, long startedMin, Long successMin) {}

  public record OutboxBacklog(long stuck, long failed) {}
}
```

`service/ops/OpsStatusService.java`:

```java
/*
 * 파일명 : OpsStatusService.java
 */
package {base}.service.ops;

import {base}.repository.ops.OpsStatusRepository;
import {base}.repository.ops.OpsStatusRepository.BatchStatus;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;

// 운영 감시 판정 — 하나라도 실패면 엔드포인트가 503 (batch.md 3-1절)
@Service
public class OpsStatusService {
  private static final Logger log = LoggerFactory.getLogger(OpsStatusService.class);

  // 감시 목록 — 배치명: 성공 기록이 이 시간 안에 있어야 정상(실행 주기 + 여유). 배치를 추가하면 여기에도 넣는다
  private static final List<Watch> WATCHED =
      List.of(
          new Watch("DB_BACKUP", 26), // 매일 03:30 (ops.md 6절) + 2시간 여유
          new Watch("DISK_CHECK", 26)); // 백업과 같은 실행에서 기록 (ops.md 8절)
  private static final int RUNNING_MAX_MINUTES = 120; // RUNNING으로 이보다 오래 남으면 죽은 것으로 본다
  private static final boolean OUTBOX_ENABLED = false; // 쓰기 연동(outbox)이 있는 프로젝트만 true

  private final OpsStatusRepository opsStatusRepository;

  public OpsStatusService(OpsStatusRepository opsStatusRepository) {
    this.opsStatusRepository = opsStatusRepository;
  }

  /** 전체 판정 — DB 조회가 실패해도 실패로 답한다(감시 대상이 확인 불가인 것도 이상이다). */
  public OpsStatus getStatus() {
    try {
      Map<String, BatchStatus> rows =
          opsStatusRepository.selectBatchStatus(WATCHED.stream().map(Watch::name).toList()).stream()
              .collect(Collectors.toMap(BatchStatus::batchName, Function.identity()));
      List<Check> checks = new ArrayList<>();
      for (Watch w : WATCHED) {
        checks.add(judge(w, rows.get(w.name())));
      }
      if (OUTBOX_ENABLED) {
        var backlog = opsStatusRepository.selectOutboxBacklog();
        checks.add(
            new Check(
                "OUTBOX",
                backlog.stuck() == 0 && backlog.failed() == 0,
                "지연 PENDING " + backlog.stuck() + "건 · FAILED " + backlog.failed() + "건"));
      }
      return OpsStatus.of(checks);
    } catch (DataAccessException e) {
      log.error("[ops-status] 조회 실패", e); // 맥락과 함께 남긴다 (ops.md 3절)
      return OpsStatus.of(List.of(new Check("DB", false, "상태 조회 실패")));
    }
  }

  // 배치 하나의 판정 — 기록 없음·마지막 실패·실행 중 멈춤·성공이 오래됨을 실패로 본다
  private static Check judge(Watch w, BatchStatus row) {
    if (row == null) {
      return new Check(w.name(), false, "실행 기록 없음");
    }
    if ("FAILED".equals(row.lastStatus())) {
      return new Check(w.name(), false, "마지막 실행 실패 (" + row.startedMin() + "분 전 시작)");
    }
    if ("RUNNING".equals(row.lastStatus()) && row.startedMin() > RUNNING_MAX_MINUTES) {
      return new Check(w.name(), false, "실행 중으로 " + row.startedMin() + "분째 — 멈춘 것으로 본다");
    }
    if (row.successMin() == null) {
      return new Check(w.name(), false, "성공 기록 없음");
    }
    if (row.successMin() > w.maxAgeHours() * 60L) {
      return new Check(
          w.name(),
          false,
          "마지막 성공 " + row.successMin() / 60 + "시간 전 (기준 " + w.maxAgeHours() + "시간)");
    }
    return new Check(w.name(), true, "마지막 성공 " + row.successMin() + "분 전");
  }

  private record Watch(String name, int maxAgeHours) {}

  public record Check(String name, boolean ok, String detail) {}

  public record OpsStatus(String status, List<Check> checks) {
    static OpsStatus of(List<Check> checks) {
      return new OpsStatus(checks.stream().allMatch(Check::ok) ? "OK" : "FAIL", checks);
    }

    public boolean healthy() {
      return "OK".equals(status);
    }
  }
}
```

`controller/ops/OpsStatusController.java`:

```java
/*
 * 파일명 : OpsStatusController.java
 */
package {base}.controller.ops;

import {base}.common.ApiResponse;
import {base}.service.ops.OpsStatusService;
import {base}.service.ops.OpsStatusService.OpsStatus;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

// GET /api/ops/status — 감시 도구가 폴링한다 (batch.md 3-1절). SecurityFilterChain 공개 경로에 넣는다
// 판정은 상태 코드(200/503)로 한다 — 본문은 사람이 원인을 보는 용도라 503에서도 같은 data 봉투를 쓴다
@RestController
@RequestMapping("/api/ops")
public class OpsStatusController {
  private final OpsStatusService opsStatusService;

  public OpsStatusController(OpsStatusService opsStatusService) {
    this.opsStatusService = opsStatusService;
  }

  @GetMapping("/status")
  public ResponseEntity<ApiResponse<OpsStatus>> status() {
    OpsStatus status = opsStatusService.getStatus();
    return ResponseEntity.status(status.healthy() ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE)
        .cacheControl(CacheControl.noStore())
        .body(ApiResponse.of(status));
  }
}
```

## 4. 배포·운영

- **장시간 배치와 배포가 겹치지 않게** 스케줄을 잡는다 — 배포 중 앱 이미지가 교체돼도 실행 중인 배치 컨테이너는 그대로 돌지만((b) 방식), DB 마이그레이션이 함께 나가면 배치가 옛 스키마 기준으로 돌다 깨진다. 마이그레이션 동반 배포는 배치 시간대를 피한다.
- 수동 재실행 방법(`docker compose run --rm batch <작업명> --date=2026-07-14` 등)을 README 또는 handover에 기록한다 — 장애 시 특정 날짜만 다시 돌리는 것이 가장 흔한 복구 조치다.
- 배치 대상 기간·기준일은 **인자로 받는다** (오늘 기준 하드코딩 금지) — 과거 날짜 재처리가 가능해야 한다.
