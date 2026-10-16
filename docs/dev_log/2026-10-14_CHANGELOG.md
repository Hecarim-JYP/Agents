# 변경 이력 — 2026-10-14

> 작업 베이스 커밋 1918953(설치 후 실행 방법 변경) 이후 같은 날 12커밋 — 오전 3커밋(5af7b31, f50427b, 6a4e50f 이 문서 초판) + 운영 기능 카탈로그 9커밋(c61cbe7 ~ d990c41, 2026-10-16 누적 갱신).
> 사용자 요청 ① "papertest를 보완해 런타임·실DB·외부 실응답·동시성·브라우저 렌더링까지 실제 화면에서 테스트하는 스킬" → 가능 여부·범위 검토 3회차를 거쳐 구현. ② "옵저버 패턴처럼 웹앱 운영에 필수인 디테일 기능들을 미리 설계해두고 싶다"(+ 대외 시스템 상정) → 운영 기능 카탈로그와 레시피 17종.
> 핵심 주제: **① /live-test 스킬 신설 ② 테스트 DB 규칙을 자동화/실동작으로 분리 ③ 운영 DB 식별자를 시작 결정으로 등록 ④ 운영 기능 카탈로그 + 레시피 17종(1차·2차·2-2차) ⑤ 실측으로 드러난 기존 규칙·템플릿 결함 정정(Secure 쿠키, nginx 업로드 상한)**

---

## 1. /live-test — 실동작 테스트 스킬 신설 (f50427b)

기존: /paper-test는 정적 추적이라 범위 한계로 "런타임·실DB·외부 실응답·동시성·렌더링 검증 불가 → 서버 기동 스모크 또는 E2E로 에스컬레이션"을 고지했지만, 에스컬레이션 대상 절차가 없어 "② 의심" 항목이 실측으로 확정되지 못한 채 남았다.
변경: 개발 환경에서 실제로 돌려 확인하는 **별도 스킬**을 신설했다(2026-10-16 사용자 의도에 맞춰 정적 추적까지 포함하는 상위 통합 테스트로 재구성 — 2026-10-16 changelog). papertest를 확장하지 않은 이유는 papertest의 핵심 안전 규칙("앱 실행 금지·읽기 전용 에이전트")과 실동작 검증(서버 기동·DB 쓰기·외부 호출)이 정반대라 한 스킬에 넣으면 그 규칙이 무너지기 때문이다. 대신 papertest의 인벤토리와 ② 의심 항목을 그대로 입력으로 받아 ①/③으로 확정하는 연결 구조로 만들었다.

| 설계 결정 | 내용 | 근거 |
|---|---|---|
| 하이브리드 모드 | 자동 조작(Claude가 브라우저·Playwright로) + 관찰자(사용자가 조작, Claude가 뒤에서 DB·로그·API 조회해 판정) | 사용자 결정. UX 판단·SSO 화면은 사람, 데이터 준비·동시성은 자동이 낫다 |
| 0단계 환경 판별 생략 금지 | 운영 DB 식별자와 현재 접속 설정 대조, 판별 불가 시 중단 후 질문(fail-closed). **앱 자체가 운영 DB를 가리키면 검증 전체 중단** | 개발 DB 쓰기를 허용하므로 운영 오판 한 번이 곧 운영 데이터 오염. 앱이 운영에 붙어 있으면 화면 조작 자체가 운영 쓰기(자기 검토에서 발견 — 초안은 "DB 영역만 중단"이었다) |
| 병렬 에이전트 금지 | 라운드 분할만 허용 | 같은 DB·브라우저 상태를 공유해 서로의 결과를 오염시킨다 |
| 코드 수정 금지 | 발견은 백로그로, 수정은 승인 후 별도 | qa-claude·paper-test와 같은 규율 |

검토 과정에서 폐기한 안: 외부 API 쓰기 호출 건별 승인 — 사용자 결정으로 제거. 쓰기 연동은 outbox 경유뿐이고, 쓰기가 필요한 연동은 상대 시스템의 테스트 환경을 지정해 개발한다는 전제.

**변경 파일**
- `skills/live-test/SKILL.md` — (신규) 방법론·절차 0~6단계·출력 형식·범위 한계
- `skills/paper-test/SKILL.md` — 에스컬레이션 대상을 /live-test로 명시
- `skills/review/SKILL.md`, `agents/qa-claude.md` — 자산 간 경계 문구에 /live-test 추가
- `rules/dev-rules.md` — 명령 라우팅 "실동작 테스트" 추가
- `docs/OVERVIEW.md`(1.3), `README.md`, `install.ps1`, `install.sh` — 인덱스·안내 갱신

---

## 2. 테스트 DB 규칙 — 자동화/실동작 분리 (f50427b)

기존: testing.md 0절 "운영·개발 DB를 테스트에 절대 사용하지 않는다" — 자동화 테스트와 수동 검증을 구분하지 않아 개발 DB에서의 실동작 검증까지 막았다. integration.md 7절 "실제 사내 API를 호출하는 테스트 금지"도 같은 구조.
변경: 사용자는 "운영 DB 금지만 두면 되지 않나"를 제안했으나, 그러면 **자동화 테스트도 개발 DB에 붙을 수 있게 되는** 구멍이 생겨 한 줄을 더 두었다.
- 운영 DB는 어떤 테스트·검증에도 사용 금지 (STRICT)
- 자동화 테스트(`npm test`·CI·stop-test 훅)는 테스트 DB 전용 유지 — 데이터 초기화(TRUNCATE·롤백)로 공유 개발 데이터가 지워지고, 기존 데이터가 섞여 결과가 비결정적이 되며(로컬=개발 데이터, CI=빈 DB), stop-test 훅이 코드 수정 턴마다 자동 실행돼 사용자 모르게 반복된다
- 수동 실동작 검증은 신설 6절을 따른다

testing.md 6절(신설) 구성: 6-1 대상 환경(운영 DB 접속 금지·fail-closed·DB 권한으로 강제 권장) / 6-2 개발 DB 허용 범위(SELECT·INSERT·UPDATE만, 삭제·DDL 금지, 생성 레코드 PK 기록·`__LT_` 접두어, 정리는 소프트삭제, 미발송 연동 대기 행 종결 처리, 잔존 목록 보고) / 6-3 외부 연동(제한 없음, 쓰기 재시도 금지) / 6-4 작업 폴더·증거 / 6-5 자동화 테스트와의 경계(승격은 승인 시만, E2E는 `test:e2e`로 분리).

**실측 검증** — 6-4절 "작업 폴더는 프로젝트 밖"의 근거를 훅을 실제로 돌려 확인: 프로젝트 안 스크립트는 post-edit 훅이 마커를 남기고 stop-test가 **exit 2로 턴 종료를 막음**, 프로젝트 밖 작업 폴더는 마커 없음·exit 0. `.gitignore`는 훅(작업 트리 기준)을 막지 못한다.

부수 정정 (5af7b31): testing.md 0절 구성 행이 독립성 규칙을 "4절"(구조와 네이밍)로 가리키던 오기 → 2절.

**변경 파일**
- `conventions/testing.md` — 0절 문구 분리, (4절)→(2절), 6절 신설
- `conventions/integration.md` — 7절 실API 호출 금지를 자동화 테스트 한정으로 정정
- `rules/dev-rules.md` — testing 요약에 STRICT 금지 3개 추가(구체 값 없이)

---

## 3. 시작 결정 체크리스트 25 — 운영 DB 식별자 (f50427b)

기존: 운영 DB를 가려낼 문서상 기준이 없었다. 체크리스트는 24항목인데 프로필·OVERVIEW는 "23개"로 표기(24번 Spring 데이터 접근 추가 시 갱신 누락).
변경: 25번 "운영 DB 식별자(호스트·포트·DB명)" 추가 — 생성 시 묻지 않고 배포 호스트 확정 시 기록, 미기록이면 /live-test가 첫 실행 때 묻고 기록. 운영 API URL은 사용자 결정(외부 호출 무제한)으로 판별 대상에서 제외. 항목 수 표기 23→25 정정.

**변경 파일**
- `scaffolds/default.md` — 체크리스트 25 추가
- `profiles/project-default.md` — [고정]에 25번 처리 방식, 항목 수 정정
- `docs/OVERVIEW.md` — 항목 수 정정

---

## 4. outbox 쓰기 연동 컨벤션 — 보류 → 같은 날 해소 (c61cbe7, d707a7c)

검토 중 발견: outbox 패턴이 저장소 어디에도 문서화돼 있지 않다(`grep outbox` 0건). integration.md 4절("쓰기 재시도 금지, 꼭 필요하면 멱등 키 협의")은 relay가 재시도하는 outbox 구조와 맞지 않는다 — 수신 측 멱등 키가 "꼭 필요하면"이 아니라 필수가 된다. 처음엔 사용자 결정으로 보류했으나, 운영 기능 카탈로그 1차에서 **표준안으로 해소**했다 (5절 — 레시피 `features/outbox.md` + `schemas/07_outbox.sql` + integration.md 4절 정합 + 체크리스트 18 확장).

---

## 5. 운영 기능 카탈로그 + 1차 레시피 5종 (c61cbe7, d707a7c)

기존: 운영 웹앱이 반복해서 만드는 기능(이벤트, 연동 대기열, 중복 제출, 요청 추적, 안전 종료 등)의 표준 설계가 없어 프로젝트마다 즉흥 설계 — 같은 함정을 매번 다시 밟는 구조였다. 아키텍처 구상 스킬 검토 중 사용자가 "옵저버 패턴처럼 디테일한 기능을 미리 설계해두고 싶다"로 방향을 확정.
변경: `conventions/features/` 신설 — `catalog.md`가 인덱스(`[공통]`/`[사내]`/`[대외]` 태그, 현황, 차수, ⚑ 되돌리기 어려운 결정 표시)이고, 기능마다 레시피 한 파일(언제 쓰나 / 결정 항목 / 표준 설계 / 함정 STRICT / 스택별 구현 / 검증 포인트). 이미 컨벤션이 다루는 기능은 카탈로그에서 해당 절로 링크만 한다(SSOT). dev-rules에 "레시피가 있는 기능은 즉흥 설계 금지(MANDATORY)".

| 레시피 | 확정 결정(사용자) / 핵심 | 함정 근거(실측) |
|---|---|---|
| `outbox.md` + `07_outbox.sql` | 상주 relay 워커, 같은 업무 건 순서 보장, 재시도 8회(약 16시간), SENT 90일 보관, 수신 측 멱등 불가 시 조회 후 재전송 | MySQL 8.0.46: 한 문장 선점 UPDATE ERROR 1093(MariaDB 10.11은 허용) → 2단계 선점 / 동시 선점 뒤 세션 0행 / lease 만료 회수 후 늦은 기록 0행 / 20만 건 후보 조회 13ms |
| `domain-event.md` | "놓쳐도 되면 이벤트, 놓치면 안 되면 outbox" | Node 22: async 리스너 예외 → 프로세스 종료(exit 1) / Spring: afterCommit 쓰기는 REQUIRES_NEW 필요(javadoc), 6.1+ 기동 시 거부(소스 확인) |
| `idempotency.md` | 업무 테이블 UNIQUE 컬럼 방식 | Chromium: HTTP 사내망에서 `crypto.randomUUID` 없음 / 멱등 키 중복과 채번 중복이 같은 `ER_DUP_ENTRY` |
| `request-id.md` | 응답 헤더로만 전달(에러 봉투 불변) | AsyncLocalStorage 동시 요청·풀 대기 후에도 유지, 형식 검증 |
| `graceful-shutdown.md` | 앱 20초 < 컨테이너 30초 | PID 1 node 핸들러 없으면 SIGTERM 무시 / 셸 형식 CMD·`npm start`는 신호 미전달 / keep-alive로 종료 3초 지연 → 응답 직후 닫기 / Spring Boot 3.3 기본 IMMEDIATE(3.5는 GRACEFUL) |

**변경 파일**: `conventions/features/`(catalog + 레시피 5, 신규), `schemas/07_outbox.sql`(신규), `conventions/integration.md`(4절 — 동기 쓰기만 재시도 금지, 외부 쓰기는 outbox), `batch.md`, `patterns.md`, `ops.md`, `api.md`, `docker.md`(exec 형식 CMD), `react.md`, `testing.md`, `skills/live-test`, `rules/dev-rules.md`, `scaffolds/default.md`(체크리스트 18·기초 테이블), `scaffolds/templates/docker-compose.yml`(stop_grace_period 30s), `profiles/project-default.md`, `docs/OVERVIEW.md`(1.4), `README.md`

---

## 6. 2차 레시피 6종 + nginx 업로드 상한 (309c428, c00c4d9, 9d4d1b1)

변경: 사내 업무 시스템에서 효과가 큰 기능. 기본값은 사용자 확인(엑셀 업로드 전부 통과 시만 반영·5,000행·10MB / 다운로드 동기 10만 행 / 화면 알림 60초 폴링·90일 / 반려 후 재상신 = 새 결재 요청).

| 레시피 | 핵심 | 함정 근거(실측) |
|---|---|---|
| `state-machine.md` | 행위 중심 전이표, `allowed_actions`, 편집 잠금 | mysql2 `execute`에 배열 IN → 에러 없이 0건(→ sql.md 6절 STRICT 추가) |
| `change-history.md` + `08_change_log.sql` | 같은 트랜잭션, 바뀐 컬럼만 JSON, audit_log와 분리 | DECIMAL이 문자열 `"100.00"`로 와서 거짓 변경 / Asia/Seoul에서 DATE가 JSON으로 하루 전 |
| `approval.md` + `09_approval.sql` | 사내 전자결재 연동 우선, 자체 결재는 요청 행 `FOR UPDATE`, 스냅샷 동결 | 잠금 없으면 승인·회수가 둘 다 성공해 상태 불일치 |
| `notification.md` + `10_notification.sql` | 화면 알림은 같은 트랜잭션, 메일은 outbox, SHA-256 사건 키 | `INSERT IGNORE`가 길이 초과를 잘라 저장 / ODKU affectedRows가 처음·중복 모두 1 |
| `excel-download.md` | 목록 API와 같은 쿼리·스코프, 스트리밍 | 10만 행 일반 1.2GB·13초 vs 스트리밍 151MB·1.9초 / ExcelJS 날짜 UTC 기록(9시간 이르게) / blob 에러 본문이 Blob |
| `excel-upload.md` | 헤더 이름 매핑, 단건 등록과 같은 검증, 한 트랜잭션 | 결과 없는 수식 / 열 스타일 서식은 빈 셀에 미적용 / Spring 업로드 기본 1MB(소스 확인) |

**템플릿 결함 정정 (c00c4d9)**: nginx 프록시 템플릿에 `client_max_body_size`가 없어 nginx 기본 1MB로 **1MB 넘는 업로드가 전부 HTML 413** — nginx 1.24 실측(기본 413 → 20m 설정 후 200). 템플릿에 `20m` 추가, express.md 6절에 "프록시 상한 > 앱 상한". ⚠ 이 템플릿으로 이미 만든 프로젝트는 `proxy/nginx.conf`에 같은 줄 추가 필요.

**변경 파일**: 레시피 6(신규), `schemas/08~10`(신규), `scaffolds/templates/nginx-proxy.conf`, `conventions/sql.md`·`express.md`·`auth.md`·`patterns.md`·`react.md`, `scaffolds/default.md`(체크리스트 26 결재 방식), `profiles/project-default.md`, `rules/dev-rules.md`, `docs/OVERVIEW.md`(1.5), `README.md`

---

## 7. 2-2차 레시피 6종 + HTTP 사내망 쿠키 결함 정정 (5accb76, d8a6b0c, d68e350, d990c41)

| 레시피 | 핵심 | 함정 근거(실측) |
|---|---|---|
| `long-running-job.md` + `11_async_job.sql` | 202 접수·워커·진행률, 처리 중 중복 접수 차단, 결과 7일 | 프록시 504 후에도 앱은 끝까지 처리 → 재시도가 이중 처리 / 처리 중 키를 생성 열로 만들면 MariaDB ERROR 1901 |
| `cache.md` | 기본은 캐시하지 않음, TTL+single-flight+상한 | 커밋 전 무효화 → 옛 값이 TTL 동안 고정 |
| `error-alert.md` + `12_error_event.sql` | 지문별 집계, 10분 1회 알림, 메시지 미포함 | 동시 20건 → 알림 1건 / ODKU 대입 순서로 재발 알림 누락 / 앱 단 핸들러에서 `req.baseUrl` 공백 |
| `maintenance-mode.md` + `13_app_setting.sql` | 프록시·앱 점검·기능 스위치 3층, 설정 누락 시 코드 기본값 | nginx: 앱 정지 시 JSON·HTML 503, 앱의 503은 통과, `/health`는 가리지 않음 |
| `personal-data.md` + `14_personal_data_access_log.sql` | 서버 마스킹, 원문 열람은 권한+사유, 접속기록 별도 DB(SELECT·INSERT만), 2년 보관 | 형식 불일치 시 원문 노출(→ 통째로 가림) / DB 단위 권한에서 테이블 REVOKE는 ERROR 1147 |
| `session-control.md` + `15_user_session.sql` | access 15분, refresh 절대 24시간, 회전+재사용 감지+30초 유예, 쿠키 `Path=/api/auth` | 유예 없으면 다중 탭 로그아웃 / 다른 Path로 삭제하면 쿠키 잔존 / HTTP에서 `navigator.locks` 없음 |

**기존 규칙 결함 정정 (d8a6b0c)**: auth.md 3절이 refresh 쿠키에 `Secure`를 무조건 필수로 정해 두었는데, **HTTP 사내망에서는 브라우저가 Secure 쿠키를 저장하지 않아 운영에서만 새로고침마다 로그아웃**된다(Chromium 실측 — localhost는 예외라 개발에선 정상). `COOKIE_SECURE` 설정값으로 분기(compose·`.env.example`·검증 스크립트 반영). docker.md 7절의 HTTP 제약 목록도 실측으로 정정 — Secure 쿠키·`crypto.randomUUID`·`navigator.locks` 불가, **blob 다운로드는 동작**(기존 "blob 다운로드 차단"은 재현 안 됨). ⚠ 이 규칙으로 HTTP 운영 중인 프로젝트는 로그인 유지 확인 필요.

**템플릿 (d68e350)**: nginx 프록시 템플릿에 점검 안내 — 502·504만 바꾸고 `proxy_intercept_errors`는 끈다. 템플릿 원본으로 nginx 실측.

**법정 요건**: 개인정보 접속기록 보관(기본 1년 이상, 5만 명 이상·고유식별·민감정보는 2년 이상)은 검색 자료 두 곳 일치로 확인. 법제처 원문은 작업 환경 네트워크 정책(프록시 403)으로 **열람하지 못했고**, 점검 주기·다운로드 사유 요건은 현행 문언 **미확인** — 레시피에 "착수 시 원문 대조"로 표시.

**변경 파일**: 레시피 6(신규), `schemas/11~15`(신규), `conventions/auth.md`·`docker.md`·`ops.md`·`patterns.md`·`api.md`·`react.md`, `scaffolds/templates/nginx-proxy.conf`·`docker-compose.yml`, `scripts/verify-templates.sh`·`.ps1`, `scaffolds/default.md`(체크리스트 27 개인정보, 기초 테이블 기본 포함 12·13·15, `.env.example`), `profiles/project-default.md`, `rules/dev-rules.md`, `docs/OVERVIEW.md`(1.6), `README.md`

---

## 8. 진행 방식 메모

- 레시피의 함정은 **실측 또는 원문 소스 확인**이 있는 것만 STRICT로 올렸다. 실측 환경: MySQL 8.0.46·MariaDB 10.11.14(apt), nginx 1.24, Node 22 + Express 4.22·mysql2 3.24·ExcelJS 4.4·pino 9, Chromium(Playwright), Spring 소스(spring-tx 6.2.11, spring-boot-autoconfigure 3.3.13·3.5.6). 엑셀 프로그램 동작 등 실측 못 한 것은 본문에 "알려진 동작(미실측)"으로 구분했다.
- Docker Hub·ECR은 요청 제한으로 이미지를 받지 못해 DB는 apt로 설치해 검증했다. MariaDB 10.4(지원 최소 버전)는 직접 검증하지 못했다 — SKIP LOCKED 미지원은 버전 이력 근거.
- 남은 차수: 3차(대외 — 가입·인증, 빈도 제한, 외부 노출 ID 등), 4차(법적 요건·결제·웹훅·공개 API).

---

## 검증

| 항목 | 결과 |
|---|---|
| `node scripts/check-refs.mjs` | 통과 — 문서 22개 / 참조 199건 |
| check-refs 확장 실행(skills·agents 포함) | 통과 — 문서 31개 / 참조 215건 |
| 훅 실측(프로젝트 안/밖 스크립트) | 안: stop-test exit 2 / 밖: exit 0 |
| `install.sh` 임시 HOME 설치 | `live-test` 설치 확인 |
| 인코딩 | `install.ps1` BOM+CRLF 유지 |
| 카탈로그·레시피 이후 check-refs (2-2차 커밋 시점) | 통과 — 문서 40개 / 참조 370건, 확장 49개 / 386건 |
| compose 템플릿 `verify-templates.sh` | 통과 — 두 모드 (COOKIE_SECURE 추가 후 포함) |
| nginx 프록시 템플릿 | 원본 그대로 nginx 1.24로 문법·동작 확인 (업로드 3MB 200, 점검 503, `/health` 502) |
| `install.sh` 임시 HOME 설치 | 레시피 18개(catalog 포함)·스키마 16개 설치 확인 |
| /live-test 실프로젝트 실행 | **미검증** — 클라우드 세션이라 사내망 DB·앱 접근 불가. 회사 PC에서 첫 실행 필요 |
| 레시피 코드 예시의 실프로젝트 적용 | **미검증** — 함정 단위로는 실측했으나 relay 루프 전체·Spring 예시 코드는 실제 프로젝트에서 처음 적용할 때 검증 필요 |
| `install.ps1` 재실행 | **미수행** — 소비 지점인 회사 PC에서 `git pull` 후 실행 필요 |

---

## 커밋 코멘트

```
@@ 2026-10-14 @@
실동작 테스트 /live-test 신설 + 테스트 DB 규칙 분리 + 운영 기능 카탈로그·레시피 17종 + HTTP 쿠키·nginx 템플릿 결함 정정

■ /live-test 스킬
- 개발 환경 실측(런타임·실DB·외부 실응답·동시성·렌더링), 하이브리드(자동 조작 + 관찰자)
- 0단계 운영 DB 판별 생략 금지(fail-closed), 앱이 운영을 가리키면 전체 중단
- paper-test ② 의심 항목을 입력으로 받아 ①/③ 확정

■ 테스트 DB 규칙
- 운영 DB 전면 금지, 자동화 테스트는 테스트 DB 전용 유지
- testing.md 6절 신설: 개발 DB SELECT·INSERT·UPDATE만, 삭제·DDL 금지, 작업 폴더는 프로젝트 밖
- integration.md 7절 자동화 테스트 한정 정정, testing.md 0절 참조 오기(4절→2절) 정정

■ 시작 결정
- 체크리스트 25 운영 DB 식별자 추가, 항목 수 표기 23→25 정정

■ 운영 기능 카탈로그 (conventions/features/)
- 인덱스 catalog.md + 레시피 형식 6절, "레시피 있는 기능은 즉흥 설계 금지"(dev-rules)
- 1차: 도메인 이벤트, outbox(+07), 중복 제출, 요청 추적 ID, 안전 종료 — 보류했던 outbox 해소
- 2차: 상태 머신, 변경 이력(+08), 결재(+09), 알림(+10), 엑셀 다운로드·업로드
- 2-2차: 장시간 작업(+11), 캐시, 에러 알림(+12), 점검 모드(+13), 개인정보(+14), 세션 제어(+15)
- 함정은 실측·원문 소스 확인 근거만 STRICT

■ 결함 정정
- auth.md 3절: HTTP 사내망에서 Secure 쿠키 미저장 → COOKIE_SECURE 분기
- docker.md 7절: HTTP 제약 목록 실측 정정 (blob 다운로드는 동작)
- nginx 프록시 템플릿: 업로드 상한 20m(기본 1m → 413), 점검 안내 503
- sql.md 6절: mysql2 execute 배열 IN 조용히 0건 → query 사용

■ 시작 결정
- 체크리스트 26(결재 방식)·27(개인정보 처리 여부), 기초 테이블 기본 포함 12·13·15
```
