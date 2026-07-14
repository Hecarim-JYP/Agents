# JYP Agents 전체 기능 통합 가이드

> 최종 수정: 2026-07-13 | 버전: 1.1 | 대상 독자: 이 저장소를 처음 보는 개발자, 그리고 전체 구조를 한눈에 복기하려는 관리자(박진영)

## 1. 개요

이 저장소는 **Claude Code를 "일관된 방식으로 일하는 개발 조직"처럼 만들기 위한 자산 모음**이다. 에이전트 페르소나, 작업 규칙, 코딩 컨벤션, 표준 DB 스키마, 문서 템플릿, 슬래시 커맨드(스킬), 자동 검증 훅을 하나의 git 저장소에서 버전 관리하고, `install.ps1`/`install.sh` 한 번으로 `~/.claude`에 설치한다. 설치 후에는 **어느 폴더에서 Claude Code를 열어도** 동일한 규칙·절차·품질로 작업이 수행된다.

핵심 설계 철학 세 가지:

1. **SSOT(단일 출처) 계층 구조** — 규칙은 한 곳에만 존재한다. 에이전트 정의는 규칙 파일을 가리키기만 하고, 규칙 파일은 컨벤션·스킬을 가리키기만 한다. 같은 내용을 두 곳에 쓰면 반드시 어긋나므로(드리프트), 요약·중복 기재를 금지한다.
2. **설치 경로 기준 참조** — 모든 내부 참조는 저장소 클론 위치가 아니라 설치 경로(`~/.claude/jyp/` 등) 기준이다. 다른 기기에서도 클론 → 설치 스크립트 실행만 하면 동일하게 동작한다.
3. **규칙에는 근거를 병기** — 모든 STRICT 규칙에는 "어떤 버그·사고에서 나온 규칙인지"를 함께 적는다. 근거 없는 규칙은 지켜지지 않는다.

## 2. 빠른 시작

```powershell
git clone https://github.com/<계정>/jyp-agents.git
cd jyp-agents
.\install.ps1        # Windows
./install.sh         # Mac/Linux
```

설치 후 Claude Code에서 바로 사용:

```
dev-claude로 로그인 기능 구현해줘        # 개발 페르소나 호출
doc-claude로 주간 보고서 써줘            # 문서 페르소나 호출
/new-project                             # 새 프로젝트 세팅
/work-log                                # 작업 정리
/deploy-check                            # 배포 준비 점검
/paper-test                              # 통합 테스트 (정적 추적)
```

특정 프로젝트에 규칙을 상시 적용하려면 그 프로젝트의 `CLAUDE.md`에 한 줄 추가:

```markdown
@~/.claude/jyp/rules/dev-rules.md
```

## 3. 구조

### 3-1. 저장소 구조

```
Agents/
├── agents/            # 페르소나 2종 (dev-claude, doc-claude)
├── rules/             # 작업 규칙 2종 — 페르소나와 프로젝트 CLAUDE.md가 참조하는 SSOT
├── conventions/       # 코딩 컨벤션 17종 (범용 → 스택별 → 운영까지)
├── skills/            # 슬래시 커맨드 4종 (new-project, work-log, deploy-check, paper-test)
├── scaffolds/         # 새 프로젝트 초기 구조 스펙 (default.md)
├── schemas/           # DB 기초 테이블 표준 DDL 7종
├── templates/         # 문서 템플릿 8종 (doc-claude용 6 + 개발용 2)
├── hooks/             # 자동 검증 훅 스크립트 2종 (post-edit-check, stop-test)
├── docs/              # 저장소 자체 문서 (이 파일)
├── install.ps1        # Windows 설치 스크립트
├── install.sh         # Mac/Linux 설치 스크립트
└── README.md
```

### 3-2. 설치 경로 매핑

| 저장소 경로 | 설치 위치 | 소비 주체 |
|---|---|---|
| `agents/*.md` | `~/.claude/agents/` | Claude Code 서브에이전트 시스템 |
| `rules/`, `conventions/`, `scaffolds/`, `schemas/`, `templates/` | `~/.claude/jyp/{각 폴더}/` | 규칙·컨벤션 참조 (`@` import 및 작업 중 읽기) |
| `skills/*/` | `~/.claude/skills/` | 슬래시 커맨드 |
| `hooks/*.mjs` | `~/.claude/hooks/` | settings.json의 훅 설정이 실행 |

설치 스크립트는 `~/.claude/jyp/`를 비우고 새로 복사하므로(삭제·이름변경 파일 잔존 방지), 저장소 수정 → 재설치 → 커밋이 표준 관리 사이클이다. 스킬과 훅은 **이 저장소의 것만 교체**하고 사용자의 다른 스킬·훅은 보존한다.

### 3-3. SSOT 참조 계층

```
프로젝트 CLAUDE.md ──@import──> rules/dev-rules.md ──참조──> conventions/*.md  (작업 유형별로 읽음)
agents/dev-claude.md ──"읽어라"──┘                └──참조──> skills/*/SKILL.md (명령 절차)
skills/new-project ──"SSOT는 여기"──> scaffolds/default.md
conventions/database.md ──"복사해서 시작"──> schemas/*.sql
```

- `dev-claude.md`는 규칙을 한 줄도 직접 담지 않는다 — `dev-rules.md`를 읽으라는 지시만 있다.
- `dev-rules.md`는 컨벤션의 핵심만 한 줄씩 요약·링크하고, 세부는 각 컨벤션 파일이 담는다.
- `new-project` 스킬은 절차를 요약하지 않는다 — `scaffolds/default.md`만 갱신하면 되도록 드리프트를 차단한다.
- 프로젝트에 CLAUDE.md가 있으면 **그 프로젝트 고유 규칙이 공통 규칙보다 우선**한다.

## 4. 상세 설명

### 4-1. 에이전트 (페르소나 2종)

#### dev-claude — 개발 전담

새 프로젝트 세팅, 기능 구현, 버그 수정, 리팩토링 등 **코드를 작성·수정하는 모든 작업**에 사용한다. 정의 파일은 14줄뿐이며, 실질 내용은 "작업 시작 전 `~/.claude/jyp/rules/dev-rules.md`를 읽고 전체를 따르라"는 SSOT 지시다. 컨벤션과 스킬은 해당 작업 유형에 착수하는 시점에 읽는다(예: SQL 작성 전 `sql.md`).

#### doc-claude — 문서 전담

업무 보고서, 기술 문서, 기획/제안서, 자료 요약·정리에 사용한다. 핵심 규칙:

- **템플릿 필수**: 문서 종류에 맞는 템플릿(`~/.claude/jyp/templates/`)의 구조를 따른다. 섹션을 임의로 생략·순서 변경 금지 — 쓸 내용이 없으면 "해당 없음" 표기.
- **두괄식**: 핵심 결론이 항상 맨 위. 첫 문단만 읽어도 전체 파악 가능해야 한다.
- **근거 표기**: 요약·정리 시 출처(파일명, URL, 페이지) 필수. 원문에 없는 해석은 `[추정]` 표시.
- **수치 우선**: "많이 개선" 대신 "30% 단축". 수치가 없으면 없다고 쓴다.
- 파일명: `YYYY-MM-DD_문서제목.md`.

### 4-2. 규칙 (rules 2종)

#### dev-rules.md — 개발 작업 규칙 (개발 규칙의 SSOT)

dev-claude가 읽고, 프로젝트 CLAUDE.md가 `@`로 import하는 파일. 주요 내용:

- **소통**: 설명은 한국어, 결론부터 보고 (무엇을 했는지 → 왜 → 다음 할 일).
- **작업 절차** (2026-07-13 강화 — 신중함 > 속도, 간단한 작업은 판단력 발휘): 요구사항 정리 + **추측 금지**(가정 명시, 여러 해석이면 모두 제시, 모호하면 질문) → 접근 방법 공유(더 간단한 접근이 있으면 반대 의견, 다단계는 `단계 → 검증` 계획 명시) → 기존 스타일 준수(요구하지 않은 리팩토링 금지) → **검증 가능한 목표로 변환해 통과까지 반복**("버그 수정" = 재현 테스트 통과, 검증 못 했으면 "검증 안 됨" 명시) → 변경 파일·핵심 변경·검증 결과 보고.
- **단순성과 수정 범위**(STRICT, 2026-07-13 추가): 문제를 해결하는 최소한의 코드만(요청 이상 기능·일회용 추상화·요청 없는 유연성·불가능 시나리오 에러 처리 금지), "선임 엔지니어 테스트"(복잡하면 간소화, 200줄→50줄 가능하면 재작성), 수정은 외과적으로(모든 변경은 요청과 직결, 인접 코드 "개선" 금지), 내 변경이 만든 미사용 요소만 제거(기존 미사용 코드는 언급만). ⚠ **이 규칙은 "되돌리기 쉬운 결정"에만 적용**(patterns.md 0절 — 스키마·계약·경계는 반대로 시작 시 확장 여지 확보).
- **컨벤션 라우팅**: 작업 유형별로 어떤 컨벤션 파일을 적용할지 매핑 (범용 general → 구조 patterns → 스택별 sql/database/express/react → 운영 testing/ops/migration/docker/auth/api/design).
- **코드**: 새 의존성 사전 보고, 파일 헤더 주석(작성자 `[박진영]` 고정), doc comment(`@param`) 필수, 에러 처리 필수, 하드코딩 금지.
- **Git**: 커밋 메시지 `타입: 한글 요약`(feat/fix/refactor/docs/chore/test), 커밋 하나 = 논리적 변경 하나, main = 항상 배포 가능, 요청 없이 push 금지.
- **명령 라우팅**: "작업 정리"·"배포 준비"·"통합 테스트"·"새 프로젝트 세팅" 요청 시 해당 스킬 파일을 읽고 그 절차를 그대로 수행 (절차 중복 정의 금지).
- **CLAUDE.md 운영**: Critical Pitfalls는 번호 레지스트리(번호 재사용 금지), 규칙에 STRICT/MANDATORY 마커 + 확정 날짜 + ✅/❌ 예시 + 근거 병기.
- **분석·검증 안전**: 모든 주장에 `파일:라인` 근거, 분석 서브에이전트는 읽기 전용, 발견은 ①확인된 버그 ②의심 ③정상 확인 3분류.
- **금지**: 검증 없이 "완료" 보고, 실패 테스트 은폐, 무단 파일 삭제·강제 push.

#### doc-rules.md — 문서 작업 규칙

doc-claude 규칙의 프로젝트 import용 축약판 — 템플릿 준수, 추측 금지(모호하면 질문, 복수 해석은 병기 — 2026-07-13 추가), 두괄식, 근거 표기, 수치 우선, 금지사항.

### 4-3. 스킬 (슬래시 커맨드 4종)

자연어("작업 정리해줘")와 슬래시 커맨드(`/work-log`)가 동일하게 동작하는 정식 명령. 절차의 SSOT는 각 SKILL.md다.

#### /new-project — 새 프로젝트 세팅

절차의 SSOT는 `scaffolds/default.md`(4-5절 참조)이며 스킬 파일은 그리로 위임만 한다. 핵심 주의: 이미 파일이 있는 폴더에는 생성 전 사용자 확인, 요청받지 않은 샘플 코드 생성 금지.

#### /work-log — 작업 정리

작업 단위 = **현재 브랜치의 커밋되지 않은 변경 전체**(`git status` + `git diff HEAD`, untracked 포함). "이번 세션에서 건드린 파일"만 정리하는 것 금지. 5단계:

1. **changelog 작성/갱신** — `docs/dev_log/YYYY-MM-DD_CHANGELOG.md` (템플릿: `templates/changelog.md`, 같은 날짜 파일은 누적/갱신)
2. **memory 최신화** — 확정된 사용자 선호·프로젝트 사실만 (코드/git으로 알 수 있는 내용은 저장 안 함)
3. **CLAUDE.md 갱신** — 새 컨벤션·Pitfall·아키텍처 변경 반영
4. **백로그 동기화** — **발견 ≠ 완료 (STRICT)**: `git diff` 근거가 있는 것만 `☑`, 일부 처리는 `◐`, 신규 발견은 항목 추가
5. **요약 보고** — 커밋/푸시는 명시적 요청 시에만

#### /deploy-check — 배포 준비

9항목 체크리스트를 순서대로 수행하고 ✅/❌/– 표로 보고. **실패 항목이 있으면 배포 불가 판정.** 실제 배포는 사용자 승인 후에만.

1. 테스트 전체 실행 (실패 시 즉시 중단)
2. 프로덕션 빌드 + Docker 이미지 빌드 (태그 = 배포 태그 일치 확인)
3. `npm audit` — high 이상 취약점
4. 미적용 마이그레이션·순서·멱등성 확인
5. 신규 환경변수의 `.env.example`·운영 반영 대조
6. 보안 체크리스트 (ops.md 5절 — 첫 배포는 전 항목, 이후는 변경 영역만)
7. changelog 최신 여부 (아니면 /work-log 먼저 제안)
8. main 병합 상태 + 배포 태그 제안
9. 서버 디스크·이미지 정리 상태 (ops.md 8절 — 접근 불가 시 "–" + 배포 시 확인 안내)

#### /paper-test — 통합 테스트 (정적 추적)

앱을 실행하지 않고 **코드를 읽어** 계층 간 계약을 검증한다(paper execution). 검증 대상마다 구체적 가상 시나리오(입력값·권한·상태)를 세우고 화면 → API → 컨트롤러 → 서비스 → 쿼리 → DB → 응답까지 따라간다. 절차: 인벤토리 구축(사용자 확인) → CLAUDE.md 규칙을 계약 체크리스트로 → **읽기 전용 에이전트 fan-out**(수정 금지) → 라운드 분할 → 백로그 반영. 출력은 ①확인된 버그 ②의심 ③정상 확인 3분류 + 근거(`파일:라인`) 필수. 런타임·실DB·동시성은 검증 불가함을 반드시 고지.

### 4-4. 컨벤션 (17종)

적용 순서는 계층적이다: **general(범용) → patterns(구조) → 스택별(sql/database/express/spring/react/design) → 횡단(api/auth/testing/i18n/integration) → 운영(migration/ops/docker/batch)**. 기존 코드베이스 스타일·언어 커뮤니티 표준이 항상 우선한다.

#### general.md — 범용 코딩 컨벤션

- 네이밍: 축약 금지(`mgr` ✗), 함수는 동사 시작, boolean은 `is_/has_/can_` 접두사, 같은 개념에 같은 단어(fetch/get/load 혼용 금지).
- 크기: 함수 40줄·파일 300줄·중첩 3단계·매개변수 4개 초과 시 분리 검토.
- 구조: 기능(도메인) 단위 우선, 순환 의존 금지, 진입점은 얇게, utils는 목적별 분리.
- 에러: IO·네트워크·외부 입력은 명시적 처리, 조용히 삼키지 않기, 메시지에 맥락 필수.
- 주석: **모든 새 파일에 파일 헤더 주석**(작성자 `[박진영]` 고정), 함수 인자는 선언부 doc comment(`@param`), 구조분해 인라인 주석 금지, 죽은 코드 금지.
- 설정: 하드코딩 금지, `.env.example` 유지, 기본값은 안전한 쪽.
- 메타 규칙: 규칙 문서에 새 규칙 추가 시 ✅/❌ 예시 + 버그 근거 + STRICT/MANDATORY 마커 + 확정 날짜.

#### patterns.md — 구현 패턴 (언어 무관)

- **설계 우선순위(0절, STRICT — 2026-07-14)**: 확장성·유연성 요구와 "최소 구현" 규칙의 충돌을 **되돌리기 비용**으로 가른다. **되돌리기 어려운 결정**(DB 스키마·API 계약·계층 경계·인증 소스·멀티테넌트·다국어·배치 방식)은 **시작 시 결정하고 확장 여지 확보** — 스캐폴드 체크리스트가 이 결정들의 레지스트리다. **되돌리기 쉬운 것**(내부 구현·화면 로직)은 최소 구현 — "요청받지 않은 유연성 금지"(dev-rules)는 **여기에만** 적용된다.
  - **확장은 추상화가 아니라 경계와 표로**: 원칙 층/구현 층 분리(database 8절·api 5절·migration 5절·auth 6절·integration 8절 — 새 스택은 **표에 열 추가**), 데이터로 확장(공통코드 = INSERT), 코드 공통화는 3회 규칙. 미래용 인터페이스·플러그인·설정 스위치를 미리 만들지 않는다.
  - **다중 인스턴스 가정(0-3절, STRICT)**: 지금 인스턴스가 1개라도 **앱 프로세스에 상태를 두지 않는다** — 세션(무상태 토큰 ✅) / 업로드(공유 볼륨) / 캐시(단일 인스턴스 전제로만 허용) / 스케줄러(별도 배치 컨테이너). 단일 인스턴스에 의존하는 항목은 **CLAUDE.md "다중화 전환 목록"에 기록**(스캐폴드 CLAUDE.md 템플릿에 섹션 포함).
- **계층 분리**: 진입점 → 서비스 → 데이터 접근 단방향. "데이터 계층의 단순 = 무판단이지 SQL이 단순해야 한다는 뜻이 아니다"(STRICT) — 집합 연산(JOIN·집계·페이징)은 쿼리에, 판단(권한·상태 전이)은 서비스에.
- **책임 배치**(STRICT): 입력 검증·타입 정규화는 비즈니스 계층, 데이터 계층은 pass-through. 순수 계산은 도메인 함수로 분리(서비스 비대화 방지 + 단독 테스트 가능). 표시/포맷 로직은 SSOT.
- **응답/에러 계약**: 공용 응답 헬퍼로 통일, 타입 있는 에러 + 중앙 핸들러, `=== 200` 단독 비교 금지(201 버그).
- **신뢰 경계**(STRICT): 클라이언트가 보낸 식별자·권한 값은 신뢰하지 않는다 — 서버 검증값(토큰) 강제 주입. UI 숨김은 보안이 아니다. `환경변수 || 폴백` 금지.
- **상태 변경**: 상태 전이는 명시적 이벤트로만(부수효과 금지), 다중 변경은 트랜잭션, 판별자 필드는 등록 후 변경 불가. **동시 실행 방어의 최종 방어선은 서비스의 상태 검사가 아니라 데이터 계층의 조건부 갱신**(STRICT, 2026-07-14 — 검사와 갱신 사이의 틈으로 이중 승인이 통과한다. 0행이면 409, 부수 작업은 1행 갱신 후에만).
- **공용화 기준**: 세 번째 등장 시 추출(두 번째까지는 복제 허용 — 성급한 추상화 방지).

#### sql.md — SQL 스타일

- 키워드 대문자, 절마다 독립 줄, 쿼리 첫 줄에 `/* 함수명 : 설명 */` 주석, 바인딩 파라미터는 컬럼명과 동일, 테이블 별칭 필수.
- SELECT: 컬럼 공백 정렬 + `AS` 별칭 필수, WHERE는 leading AND, ORDER BY는 leading comma.
- INSERT: 컬럼·VALUES 1:1 같은 순서 (한쪽 누락 = 저장 누락 버그의 단골).
- UPDATE: WHERE에 **스코프 조건 최상단** + PK, WHERE 없는 UPDATE/DELETE 금지.
- **소프트삭제 패턴**: `is_active = 0` + `deleted_at`/`deleted_by` 세트, 조회에 `is_active = 1` 필터 필수(누락 = 삭제 데이터 부활), 삭제 플래그와 활성 토글 의미 혼용 금지, `affectedRows === 0`이면 NotFound.
- 쿼리 함수: doc comment 필수, 인라인 형변환 금지(정규화는 서비스 책임), LIKE는 sanitize.
- 안전: 스코프 컬럼은 서버 신뢰값만 바인딩, 문자열 연결 조립 금지, 다중 쓰기는 트랜잭션, 채번은 트랜잭션 내 재산정 + UNIQUE + 재시도.
- **동시성 제어(8절, STRICT — 2026-07-14)**: 트랜잭션은 원자성만 보장하고 동시 수정은 못 막는다. ①**낙관적 락**(`version` 컬럼 + `WHERE version = :version`, 0행이면 **409**) — 수정 화면의 기본 ②**상태 전이는 조건부 UPDATE**(`WHERE status='PENDING'` — "조회→검사→갱신"은 동시 요청이 둘 다 통과해 이중 승인·이중 발송) ③**`FOR UPDATE`/DB 계산**(재고·잔액 — 잠금 구간에 외부 호출 금지, 잠금 순서 통일로 데드락 방지).

#### database.md — DB 스키마·운영

- 표준 DB: **MariaDB 10.4+ / MySQL 8.0+**, `utf8mb4`/`utf8mb4_unicode_ci` 고정(이모지·이관 호환 근거 명시), **커넥션 문자셋도 utf8mb4 명시**(STRICT), 시간대 통일(기본 Asia/Seoul).
- 네이밍: 테이블 snake_case 단수형, **PK = `{테이블명}_id`**, FK 컬럼 = 참조 PK명 그대로, 인덱스 `idx_`/`uq_`.
- 공통 컬럼: 모든 업무 테이블에 `created_at/by`, `updated_at/by` (+ 소프트삭제 대상은 `is_active`, `deleted_at/by`, + **여러 사용자가 수정하는 테이블은 `version`** — 낙관적 락, sql.md 8절).
- 타입: 금액은 `DECIMAL`(FLOAT 금지), 불리언 `TINYINT(1)`, ID `BIGINT UNSIGNED AUTO_INCREMENT`, 매직 넘버 금지.
- **FK 정책(2026-07-12 확정)**: FOREIGN KEY 제약을 선언하지 않는다 — 논리적 참조만. 정합성은 앱 계층 책임. ⚠ 대신 **FK 컬럼 인덱스 필수**(자동 인덱스가 사라지므로).
- **멀티테넌트(다중 법인)**: 시작 시 결정(소급 비용) — company 표준 스키마(05번) + 전 업무 테이블 스코프 컬럼 + 인덱스 선두, 로그인 ID 중복 범위·공통코드 소속·전사 횡단 조회를 함께 확정.
- DDL 규칙(STRICT): 테이블 생성은 마이그레이션으로만, `IF NOT EXISTS` + ENGINE/CHARSET 명시, PK 없는 테이블 금지, 표준 CREATE TABLE 예시 포함.
- 타 DB 채택 시: 원칙 층(네이밍·공통 컬럼·논리 FK)은 유지하고 구현 층만 치환하는 매핑 표(PostgreSQL/MSSQL/Oracle) 제공.

#### express.md — Express/Node 서버

- **신규는 TypeScript 기본**(`strict: true`), `any` 금지(`unknown`으로 좁히기), `req.user`는 declaration merging으로 타입 확장. 기존 JS 프로젝트는 전환하지 않는다.
- 계층 구조: `controller/{module}` → `service/{module}` → `repository/{module}` + `common/` + `middleware/`. ESM 전용. 미들웨어 순서(라우터 → notFound → error) 필수.
- Controller(MANDATORY): 모든 라우트 `asyncHandler`, 응답은 공용 헬퍼만 — 봉투·에러 키 계약은 api.md 5절(스택 무관)의 Express 구현.
- Service(STRICT): 외부 입력은 진입 시 **zod 스키마로 검증·파싱**(타입은 런타임에 사라지므로 스키마가 실제 방어선), ZodError는 중앙 핸들러가 400 변환.
- 트랜잭션: **경계 = 서비스 소유**(STRICT), 쿼리 함수는 `conn`을 받아 쓰기만(자체 커넥션 = 부분 커밋 사고), 롤백 시 부수 자원(업로드 파일)도 정리.
- 신뢰값 주입(STRICT): 스코프·행위자·권한 재료는 `req.user`로 강제 주입, 관리자 엔드포인트는 `requireRole`/`requirePermission` 필수.
- 파일 업로드(STRICT): 저장 파일명은 서버 생성(경로 트래버설 차단), 파일과 DB 메타는 항상 쌍, 다운로드는 권한 검사 후 DB 기록 경로로만.
- 기타: 드라이버 BigInt는 `Number()` 변환(JSON 직렬화 오류), 시크릿 하드코딩 폴백 금지.

#### spring.md — Spring Boot 서버 (2026-07-13 추가)

express.md와 같은 원칙의 Spring 구현 층.

- **Java 21 + Spring Boot 3.x + Gradle** 기본, 데이터 접근은 MyBatis(순수 SQL — sql.md 적용). ⚠ Gradle wrapper jar 저장소 포함 + Windows `gradlew` 실행 비트 유실 대비(`git update-index --chmod=+x`).
- 계층: controller → service → repository(Mapper), 프로파일 yml + 시크릿은 환경변수 참조만(폴백 금지).
- Controller(MANDATORY): `ApiResponse` 공통 래퍼로 api.md 5절 봉투 구현, 생성은 201, try-catch 금지.
- 입력 검증(STRICT): **Bean Validation**(record DTO + `@Valid`) = zod 대응, 비즈니스 규칙은 커스텀 예외.
- 예외 처리(STRICT): **`@RestControllerAdvice`** 한 곳에서 타입 예외 → 상태코드·에러 계약 변환, 500은 내부 정보 비노출.
- 트랜잭션: `@Transactional` 서비스 소유 — ⚠ checked 예외 미롤백·self-invocation 프록시 우회 함정 명시.
- 신뢰값 주입(STRICT): SecurityContext principal에서 강제 주입, `@PreAuthorize` 권한 게이트, default deny.
- 기타: Jackson SNAKE_CASE 전역 설정(api.md 4절), 헬스체크는 actuator `/actuator/health`, 테스트는 JUnit 5 + MockMvc.

#### react.md — React 클라이언트

- **신규는 TypeScript 기본**(`strict: true`), props는 `interface`. 기존 JSX 프로젝트는 전환하지 않는다.
- 구조: `features/{module}/{feature}/(pages|hooks|constants|components)` + `shared/`. 네이밍은 React 표준(컴포넌트 PascalCase, 훅 camelCase `use` 접두사, 모듈 접두사 유지 — 2026-07-11 확정). 화면 로직은 역할별 훅(`use*Api`/`use*Form`/`use*Validation`/`use*Search`)으로 분리, 페이지는 조립만.
- 권한 게이트: 역할 capability는 조건부 렌더로 숨김, 상태로 인한 차단은 `disabled` + 이유 — 어느 쪽이든 서버가 최종 차단.
- API 호출(STRICT): try 성공/catch 실패(axios는 비-2xx throw), `=== 200` 단독 비교 금지, 병합에 `||` 대신 `??`(빈 문자열 되살아남 버그).
- 목록 화면: 페이지가 tbody 소유 + TableRow는 순수 컴포넌트, index key 금지, 검색 디바운스 300ms + 즉시상태는 가벼운 컴포넌트에(타이핑 렉 방지), 검색 상태는 URL 쿼리가 단일 출처.
- 공통 UI: 네이티브 confirm/alert 금지(공용 다이얼로그), 평문 로딩 텍스트 금지(공용 Loading), render 중 side-effect 금지.
- API 클라이언트(STRICT): 공용 인스턴스 하나만, **`baseURL`은 상대 경로 `/api` 고정**(절대 주소·`VITE_API_URL` 금지 — 동일 출처 유지, 2026-07-13), 요청 인터셉터가 Bearer 자동 첨부, 401 시 refresh 1회 재시도(무한루프 가드 + 동시 401은 refresh 공유).
- 라우팅: kebab-case 리소스 경로, ProtectedRoute + returnUrl 복귀, 권한 없음은 403 화면(빈 화면 금지).

#### design.md — 디자인·UI/UX

- 스택: **Tailwind CSS + shadcn/ui 표준**(2026-07-11 확정) — 직접 만들기 전에 shadcn 확인, 커스텀도 shadcn 패턴(cva, `cn()`).
- 디자인 토큰(STRICT): **색상은 시맨틱 토큰만**(`bg-primary` ○, `bg-[#3b82f6]`·`text-blue-500` ✗ — 다크모드·브랜드 변경 대응), 간격·라운드는 Tailwind 기본 스케일(임의값 금지).
- 다크모드: 토큰을 지키면 자동 대응, `class` 전략, 지원 여부는 프로젝트 시작 시 결정.
- **두 가지 UI 모드**: 업무 시스템 모드(기본 — 정보 밀도, compact, 키보드 효율, 데스크톱 우선) vs 서비스 모드(첫인상, 여유 간격, 모바일 퍼스트). 시작 시 선택해 CLAUDE.md 기록.
- 화면 규칙: 숫자 우측 정렬, 상태는 색+텍스트 뱃지, 검증 에러는 필드 바로 아래 구체적으로, **로딩·빈 상태·에러 3종 필수**, 파괴적 동작은 확인 다이얼로그.
- 접근성: 대비 4.5:1, 키보드 도달 가능, focus-visible 제거 금지, 아이콘 버튼 `aria-label`.
- 아이콘 lucide-react, 폰트 Pretendard 기본.
- **셋업 레시피(8절, 2026-07-13 추가)**: Tailwind 배선 → `@` alias(tsconfig+vite 양쪽) → shadcn init(JS면 `tsx: false`) → 토큰 → `cn()` → 다크모드 토글 배선 → 아이콘·폰트 → 빌드 검증 — 완료 판정 체크리스트로 스캐폴드가 수행.

#### i18n.md — 다국어 (2026-07-13 추가)

- 다국어 여부·언어 목록·기본 언어는 시작 시 결정(문구 키 소급 비용). locale은 BCP 47.
- **모든 사용자 노출 문구는 키로**(STRICT — 기본 언어 하드코딩 금지), 키는 `{module}.{screen}.{name}`, fallback 사슬 = 사용자 → 법인(`company.locale`) → 기본 언어. 사용자 입력 데이터는 번역 대상 아님.
- 클라: react-i18next + 모듈 네임스페이스, 언어 선택은 localStorage 허용(토큰 아님), 날짜·숫자는 `Intl`, 문자열 연결 조립 금지(어순).
- 서버·DB: 에러 분기의 SSOT는 `error` 코드(message는 fallback), 서버 발신물(메일·PDF)은 서버 측 번역, 코드성 데이터는 **`_i18n` 번역 테이블**(언어별 컬럼 증설 금지) + `COALESCE` 기본 언어 fallback 조회.
- `user.locale` 컬럼(NULL이면 법인 기본값), 시간대는 별개 결정(database.md 1절).

#### api.md — REST API 설계

- URL: **업무 API는 `/api` 프리픽스 아래**(STRICT, 2026-07-13 — 동일 출처 프록시 라우팅의 전제, 예시 경로는 `/api` 이후 기준), 소문자 리소스 명사, 컬렉션 복수형, 3단계 이상 중첩 금지, 동사는 CRUD 불가 액션만(`POST /requests/:id/approve`), 사내는 버전 프리픽스 없이 시작.
- 메서드·상태코드: 생성은 **201**, 에러는 400/401/403/404/409/500 — 검증 실패를 200 + 메시지로 반환 금지.
- 목록 표준: `?page=1&size=20`(응답에 `total`), `?sort=created_at,desc`, 명시적 필터 파라미터.
- **API 필드명 = DB 컬럼명 snake_case 통일** — camelCase 변환층 금지(계층마다 이름이 달라지는 추적 비용·매핑 버그 방지). 날짜 ISO 8601, 포맷팅은 클라이언트. ⚠ **그 대가로 컬럼명이 API 계약이다(STRICT, 2026-07-14)**: 응답에 실리는 컬럼의 이름·타입 변경·삭제는 **API 파괴적 변경** — migration.md 4절 2단계 배포 적용 + changelog 기록 (내부 전용 컬럼은 제외).
- **409 = 동시성 충돌의 표준 응답**(sql.md 8절): 낙관적 락 실패("다른 사용자가 먼저 수정"), 이미 처리된 상태 전이. `version`을 조회 응답에 싣고 수정 요청에 받는다.
- **응답 봉투·에러 계약(5절, STRICT — 2026-07-13 승격)**: 봉투는 스택 무관 계약 — 성공 `{data}`(목록은 +`total`), 에러 `{message, error, field}`. 구현 층은 Express=응답 헬퍼+errorHandler, Spring=`ApiResponse`+`@RestControllerAdvice`.

#### auth.md — 인증·권한 (스택 무관)

- **인증 소스 결정(0절, STRICT — 2026-07-14 추가)**: 시작 시 반드시 확인 — (a) 자체 로그인(표준 스키마 그대로) / (b) 사내 인증 위임(ID·PW를 사내 API로 전달·저장 금지) / (c) SSO(IdP 리다이렉트, 비밀번호를 보지 않음). 공통 원칙: **인증 ≠ 인가**(권한·스코프는 어느 방식이든 우리 DB 소유), **검증 성공 시 우리가 우리 토큰 발급**(사내/IdP 토큰을 클라이언트에 흘리지 않음 — 무효화 주도권 유지), user 테이블은 위임·SSO에서도 필요(비밀번호·잠금 컬럼 제거 + `external_user_key`), 계정 프로비저닝(JIT/사전등록)과 퇴사 계정 처리 방법 기록, 인증 소스 장애 시 신규 로그인만 불가(기존 세션 유지 — `/health`에 인증 소스 확인 금지).
- 비밀번호(STRICT, 자체 로그인 전용): bcrypt/argon2만, 로그인 실패 메시지는 모호하게(계정 존재 비노출 — 위임도 사내 에러 문구 그대로 노출 금지), 실패 횟수 제한 + 잠금.
- 토큰: access 짧게 + refresh 갱신, 시크릿은 환경변수, **서버 측 무효화 수단 필수**(토큰 버전 등 — "만료까지 기다리기"는 무효화가 아니다).
- 토큰 저장(STRICT): **localStorage/sessionStorage 금지**(XSS 한 번에 탈취). 표준 = access는 메모리 + refresh는 `httpOnly`+`Secure`+`SameSite` 쿠키, silent refresh, CSRF는 SameSite + Bearer 헤더 요구.
- 권한 모델: **RBAC(기능 접근) + 스코프(데이터 접근)는 별개 층** — 혼동하면 역할 게이트가 있어도 남의 데이터에 접근 가능. 액션 권한 코드 `{module}.{action}`, default deny, 스코프 3종(테넌트 강제 주입 / 소유권 검증 + null 가드 / 목록 가시성은 쿼리 레벨).
- 권한 데이터: DB 테이블 관리, 세부 권한은 매 요청 조회(토큰에 굽지 않음), 권한 상승 방지(자기 역할 변경 금지 + 이력).
- 감사: 로그인·잠금·권한 변경 이력, 결재류는 행위 시점 스냅샷 동결.
- 스택 매핑 표: Node/Express ↔ Spring 도구 대응 (원칙은 동일, 도구만 다름) — 자체 해싱/위임(external 호출 후 자체 토큰)/SSO(OIDC 라이브러리) 행 포함.

#### testing.md — 자동화 테스트

- **테스트 DB 사용 여부(0절, 2026-07-14)**: 시작 시 결정 — (a) 사용(권장, 기본): 실제 테스트 DB로 서비스·쿼리 검증(**동시성·UNIQUE 제약은 실제 DB에서만 검증 가능**), CI에도 구성, 테스트 간 독립(트랜잭션 롤백) / (b) 미사용: 쿼리 계층 목킹(`vi.mock`/`@MockBean`) + 검증 한계를 CLAUDE.md에 명시. **어느 쪽이든 테스트를 위한 인터페이스 추상화 계층은 만들지 않는다**(성급한 추상화 방지).
- 우선순위: ①서비스 계층 단위 테스트 ②API 계약 통합 테스트(상태코드·응답 키) ③버그 재발 방지 테스트(재현 테스트 먼저).
- 하지 않는 것: **커버리지 % 목표 금지**(무의미한 테스트 양산), 스냅샷 남발 금지, 실행 순서 의존 금지.
- 도구: Vitest(+supertest), Testing Library(핵심 인터랙션만), pytest. 실행은 항상 `npm test`로 통일.
- **게이트+기록 방식**(STRICT): 핵심 로직 변경 시 테스트 동반 작성이 원칙. 못 썼으면 보고에 "테스트 미작성" 명시 + changelog 기록 + 백로그 `TEST-` 항목. 실패 테스트 은폐·skip 얼버무리기 금지.

#### integration.md — 사내·외부 API 연동 (2026-07-14 추가)

백엔드의 아웃바운드 호출(사내 API서버·외부 서비스) 규칙. 인바운드(클라→서버)만 있던 공백을 채운다.

- **경로(STRICT)**: 프론트는 사내 API를 직접 호출하지 않고 항상 자기 백엔드 경유(BFF), 타 사내 서비스도 사내 API서버 경유 — 프론트가 아는 건 `/api/*` 하나.
- **연동 계층**: 서비스가 HTTP를 직접 치지 않고 시스템별 클라이언트 모듈(`external/{system}/` — 데이터 접근과 동급)로 감싸 도메인 타입으로 변환 반환.
- **설정(STRICT)**: `INTERNAL_API_URL`/`INTERNAL_API_KEY` 환경변수(폴백 금지), 환경별 엔드포인트는 서버 `.env` 값으로.
- **타임아웃·재시도(STRICT)**: 모든 호출에 타임아웃 명시(기본 5초 — 무제한 기본값이 우리 서비스 멈춤으로 전파), 재시도는 GET만 1~2회·쓰기 재시도 금지(중복 처리).
- **에러·검증**: 연동 실패는 자체 에러 타입(502)으로 봉투 변환(외부 본문 그대로 흘리기 금지), 외부 응답도 신뢰 경계 밖 입력이라 경계 검증.
- **장애 격리**: `/health`에 외부 API 확인 넣지 않기(남의 장애로 재시작 루프), 연동 무관 코어는 계속 동작.
- 로깅은 대상·경로·소요·성공만(키·본문 금지), 테스트는 external을 mock 경계로. 스택 노트: Express=axios 인스턴스+zod / Spring=RestClient+MockRestServiceServer.

#### migration.md — DB 마이그레이션

- 파일: `migrations/` + 3자리 순번, 하나의 파일 = 하나의 목적, **적용된 파일 수정 절대 금지**(새 번호로), 병합 시 번호 충돌 재확인.
- **멱등성**(STRICT): 재실행 안전 — `IF NOT EXISTS` 가드, 시드는 `NOT EXISTS` 가드.
- **DDL/DML 분리**(STRICT): MySQL DDL은 암묵 커밋으로 트랜잭션 기대를 깨뜨림 — DML만 트랜잭션, DDL은 멱등 가드.
- 파괴적 변경은 2단계 배포: 새 구조 추가·전환 → 확인 후 구 구조 삭제.
- **실행은 적용 이력을 기록하는 러너로만**(STRICT — 원칙/도구 분리, 2026-07-13): Node=커스텀 러너 `npm run migrate`(`schema_migrations`), JVM=**Flyway**(`flyway_schema_history`, `V001__` 규약). DB 툴 수동 실행 금지. canonical DDL 동기화.

#### ops.md — 배포·운영

- 환경 분리: `.env.development`/`.env.production`, `.env.example` 항상 최신(같은 커밋에서), 운영 설정 변경은 changelog 기록, **시크릿은 패스워드 매니저 한 곳** + 메신저 평문 전송 금지 + `.env`도 암호화 백업.
- 배포: main = 항상 배포 가능, semver 태그, 배포 단위 = Docker 이미지, 배포 전 /deploy-check 통과, 배포 직후 최소 확인, 롤백 계획 필수.
- 로깅(STRICT): error/warn/info 구분, 에러 로그에 맥락 필수(`console.error(err)` 한 줄 금지), 요청 ID 추적, 민감정보 로그 금지, 컨테이너는 stdout/stderr.
- 장애 대응: incident 템플릿으로 기록, hotfix도 사후에 작업 정리 수행, 근본 원인 미해결 시 백로그 High 등록.
- **보안 체크리스트 10항목**: CORS 화이트리스트 / 보안 헤더 / 토큰 만료 / 권한 게이트 / 신뢰값 주입 / 시크릿 / 파일 업로드 / 에러 노출 / 의존성 취약점 / 컨테이너 (deploy-check가 이 표를 사용).
- 백업: 정기 백업 + **복구 절차 문서화**(복구 방법을 모르면 백업이 없는 것과 같다), 업로드 파일 포함. **분기 1회 복구 리허설**(STRICT, 2026-07-13 — 개발서버에 실제 복원 + 기동 확인, 결과 changelog 기록. 복원해 본 적 없는 백업은 백업이 아니다).
- **가동 모니터링(7절, 2026-07-13)**: 운영 개시 전 주체 결정 — 스캐폴드가 반드시 확인. (a) 사내 인프라팀 위임(기본 — 헬스 URL·연락처 전달, CLAUDE.md 기록) / (b) 자체 구축(Uptime Kuma를 감시 대상과 **다른 호스트**에). "사용자 제보로 장애를 아는 상태" 금지.
- **서버 호스트 관리(8절, 2026-07-13)**: OS 관리 주체(인프라팀/직접) CLAUDE.md 기록, 배포 시마다 디스크 점검, 이미지 정리는 `prune -a` 전체 삭제 금지(롤백 이미지 보존 — 보관 기간 필터로).

#### docker.md — Docker 컨테이너

- 원칙: 모든 서비스는 개발·운영 공통 컨테이너 배포(2026-07-11 확정), 컨테이너는 무상태(상태는 볼륨).
- Dockerfile(STRICT): 멀티스테이지 필수, **non-root 실행**, `.dockerignore`에 `.env` 필수(이미지 유출 = 시크릿 유출), 베이스 버전 고정, HEALTHCHECK 필수. **스택별 예시 3종(2026-07-13)**: Node(`/health` fetch) / JVM·Gradle(actuator + `chmod +x gradlew` 함정) / 정적 프론트(nginx + SPA fallback). **컨테이너 내부 포트는 상수 고정**(3000/8080/80 — 변경은 호스트 매핑 좌변에서만, HEALTHCHECK·프록시 참조가 조용히 깨지는 것 방지).
- 설정 주입(STRICT): 환경변수는 런타임 주입 — `.env`를 이미지에 굽기(COPY) 금지. 같은 이미지가 어느 환경에서든.
- compose **모드 2개·명령 1개**(STRICT, 2026-07-13 재정의): 환경마다 compose를 만들지 않는다 — **개발 모드**(base+dev, 로컬 전용 핫리로드)와 **배포 모드**(base+deploy, **개발서버 = 운영서버 = 로컬 배포 검증** — 같은 파일, 차이는 서버별 `.env` 값뿐). `.env`의 `COMPOSE_FILE`로 모드를 지정해 기동 명령은 어디서나 `docker compose up -d` 하나. base=어느 모드에서든 참인 것만(dev 전용 설정이 base에 있으면 배포에 딸려감). 노출 포트는 전부 `.env` 변수화 + **기본값 폴백 금지**(`${VAR:?}` — 누락이 기동 실패로 드러나게, patterns.md 4절 정합). DB는 named volume, 서비스명 통신.
- **DB 위치 결정 + 접속 호스트 매트릭스(4-2·4-3절, 2026-07-13)**: 컨테이너/호스트 로컬/외부 매니지드 중 시작 시 결정. `db`(컨테이너 간, 내부 포트) vs `localhost:노출포트`(호스트에서) vs `host.docker.internal`(컨테이너→호스트) 구분 표. DB 노출 포트도 시작 결정 항목.
- 태깅·롤백: 운영에 `latest` 금지, 태그 = git 배포 태그, deploy override는 `image: ${DEPLOY_TAG}`(build 금지), **롤백 = 직전 태그 이미지 재기동**, 마이그레이션은 앱 기동과 분리 실행(동시 실행 경쟁 방지). **배포 파이프라인 표준(2026-07-13)**: 태그 push → CI가 빌드·ghcr.io push(release.yml — 스캐폴드 생성) → 서버는 `DEPLOY_TAG` 갱신 + `compose pull && up -d`만. 서버 직접 빌드는 예외(사유 기록 — "같은 이미지" 원칙 훼손).
- **정적 서빙 = client(nginx) 컨테이너, 프록시 = HTTPS 종단 + 라우팅만** (2026-07-14 확정 — 빌드 산출물이 이미지에 봉인돼 롤백이 태그 교체로 끝난다). Caddy 라우팅: `/api/*`·`/health` → server, 그 외 → `client:80`(nginx가 SPA fallback).
- 프록시: **전제 = 서버 1대 : 프로젝트 1개**(2026-07-13 확정 — 프로젝트별 운영·개발서버 각 1대, 공유 시 공용 프록시로 전환 후 절 갱신). 앞단 리버스 프록시 1개(권장 Caddy — 자동 HTTPS), 80/443은 프록시만 노출, 정적 서빙 + `/api/*`만 서버로(CORS 원천 해소), `trust proxy` 설정. **접근 주소는 도메인으로 구분**: 사내 도메인 유무를 시작 시 확인 — 있으면 운영/`-dev` 서브도메인 + 자동 HTTPS, 없으면 `SITE_ADDRESS=:80`(확보 시 변수 교체만으로 HTTPS 전환). 운영 DB 포트 비노출(SSH 터널), 개발서버는 사내망 한정. **Caddyfile 템플릿 포함 + 스캐폴드 기본 구성**(STRICT — 없으면 prod 접근 경로가 없다), 로컬은 Vite `server.proxy`(`.env`의 API_PORT를 `loadEnv`로 — 하드코딩 금지)로 동일 출처 유지.

#### batch.md — 정기 배치·스케줄 작업 (2026-07-14 추가)

집계·사내 API 동기화·알림 발송·정리 작업의 실행 규칙. 컨테이너 무상태 원칙과 충돌하기 쉬워 즉흥 구현을 금지한다.

- **구현 전 방식 확인(MANDATORY)**: 첫 배치를 만들기 전에 실행 방식·스케줄·멱등 전략·실패 알림 경로를 **사용자에게 제안하고 확정받는다**. 이후 배치는 확정 방식을 따르고 다시 묻지 않는다(프로젝트 내 두 방식 혼용이 최악).
- **실행 방식 3택**: (a) 앱 내 스케줄러 — 인스턴스 영구 1개일 때만(⚠ 스케일아웃 시 모든 배치 중복 실행) / **(b) 별도 배치 컨테이너 + 호스트 cron(권장 — 앱과 같은 이미지, 진입점만 다르게)** / (c) DB 락 분산 스케줄러(다중화 확정 시). **컨테이너 안 crontab 금지**(무상태 위반, 로그 유실).
- **작성(STRICT)**: 멱등하게(집계는 delete+insert/upsert — 배치는 죽고 반드시 다시 돈다), 처리 단위 분할 커밋, 부분 실패는 카운트·사유 기록, **타임존 `Asia/Seoul` 명시**(컨테이너 기본 UTC — "새벽 2시"가 오전 11시에 도는 버그), 사내 API 호출은 `external/` 재사용, 로직은 서비스 재사용.
- **이력·알림(STRICT)**: `06_batch_history.sql`에 실행 이력(배치명·시각·상태·건수·사유) 기록 + **실패 알림 경로 필수**(없는 배치는 배포 금지 — 조용한 실패가 배치의 기본 사고 유형).
- **운영**: 장시간 배치와 마이그레이션 동반 배포 시간대 분리, 수동 재실행 방법 문서화, 기준일은 **인자로**(오늘 기준 하드코딩 금지 — 과거 날짜 재처리 가능해야).

### 4-5. 스캐폴드 (scaffolds/default.md + templates/)

`/new-project`의 절차 SSOT. **`scaffolds/templates/`에 실물 파일 템플릿**(docker-compose 3종 · Caddyfile · nginx.conf)이 있어 즉흥 작성을 금지한다 — docker.md 규칙(포트 `${VAR:?}`·base 최소·모드 2개·migrate/batch는 `profiles: tools`)이 이미 반영된 파일이다. 구성 (2026-07-13~14 대폭 개편 — 실전 세팅 피드백 반영):

- **질문 방식(2026-07-14)**: 22항목을 순서대로 다 묻지 않는다 — ①**반드시 묻는 5개**(프론트 TS/JS·인증 소스·사내 API 연동·사내 도메인·모니터링 주체) ②목적에서 갈리는 것(백엔드 스택·멀티테넌트·다국어·배치·규모) ③나머지는 기본값을 표로 제시하고 이견만 받는다.

- **시작 결정 체크리스트 22항목** — 컨벤션 곳곳의 "프로젝트 시작 시 결정"(= patterns.md 0절의 "되돌리기 어려운 결정")을 모은 레지스트리 (프론트 TS/JS 명시 확인/백엔드 스택/구조/UI 모드/다크모드/브랜드 색/DB·시간대/**DB 위치**/**DB 포트**/**노출 포트**/**멀티테넌트**/**다국어**/응답 봉투/테스트 위치/**사내 도메인 유무**/CI/**가동 모니터링 — 반드시 확인**/**사내 API 연동 여부**/**인증 소스 — 반드시 확인**/**정기 배치 필요 여부**/**테스트 DB 사용 여부**/**예상 규모**). 확정값은 생성되는 CLAUDE.md에 기록.
- **first-run 준비** — `.env.example`에서 **`.env` 자동 생성**(없으면 compose 변수 치환이 빈 값으로 첫 기동이 깨짐), 포트 충돌 가능성 고지.
- **기본 구조** — README/CLAUDE.md/.gitignore/.env.example+.env/Dockerfile/.dockerignore/compose 3분할/CI(test.yml)/docs/migrations/src/tests/scripts.
- **풀스택 모노레포 구조** — client/ + server/ 각자 빌드 파일·Dockerfile, **proxy/Caddyfile 필수 포함**(docker.md 7절 — 없으면 prod 접근 불가), dev는 Vite `server.proxy`, CLAUDE.md·docs·migrations는 루트 공유.
- **기초 테이블** — `schemas/` 표준을 첫 마이그레이션으로 복사·조정 (멀티테넌트면 05_company + 스코프 컬럼, 다국어면 `_i18n` 테이블 동반, JVM은 Flyway 규약 파일명, 시드는 별도 파일 + NOT EXISTS 가드).
- **스택별 조정표** — Python(pyproject + pytest) / Express(TS 기본, zod, Vitest+supertest 의존성·스크립트까지 스캐폴드가 등록, 마이그레이션 러너) / **Spring Boot(Java 21+Gradle, Initializr 산출물, wrapper jar 확보 + gradlew 실행 비트, Flyway, JUnit 5)** / React(react-ts, **데모 잔재 정리 + 타이틀 치환**, design.md 8절 셋업 레시피 전 항목, ⚠ Vite 템플릿에 test 스크립트 없음 — 등록 필수) / 기타.
- **초기 파일 내용** — README·CLAUDE.md(작업 규칙 import + 프로젝트 참고사항 + **다중화 전환 목록** + Critical Pitfalls)·gitignore·.env.example(포트 변수·COMPOSE_FILE·SITE_ADDRESS·DEPLOY_TAG·연동 키)·**CI test.yml 스택별 job**(Node job / JVM job(setup-java+gradlew) / docker job — 모노레포는 디렉토리별)·**release.yml**(태그 push → ghcr.io 빌드·push) 전문.
- 주의: 파일 있는 폴더에 생성 금지, 샘플 코드 금지(단, CLI 데모 제거는 필수), 백로그는 첫 발견 시점에 생성.

### 4-6. 표준 스키마 (schemas/ 7종)

database.md 규칙(PK 네이밍, 공통 컬럼, 논리 FK + 인덱스, utf8mb4)의 **살아있는 레퍼런스**이자, 새 프로젝트의 첫 마이그레이션 원본.

| 파일 | 테이블 | 역할 |
|---|---|---|
| `00_schema_migrations.sql` | schema_migrations | `npm run migrate` 러너의 적용 기록 (Node 전용 — JVM은 Flyway 자체 테이블) |
| `01_auth.sql` | role, permission, role_permission, user, login_history | RBAC 표준 구현 (auth.md 4절). 자체 로그인 기준 — 위임·SSO면 user 조정(auth.md 0절) |
| `02_common_code.sql` | common_code_group, common_code | 상태값·구분값을 데이터로 관리 — 매직 넘버 금지의 표준 구현 |
| `03_files.sql` | files | 원본/저장 파일명 분리(경로 트래버설 차단), 파일-메타 쌍 보장 |
| `04_audit_log.sql` | audit_log | 권한 변경 등 책임 추적 행위 기록 |
| `05_company.sql` | company | 멀티테넌트(다중 법인) 기준 테이블 — 멀티테넌트 프로젝트만 복사 (database.md 3절) |
| `06_batch_history.sql` | batch_history | 배치 실행 이력 — 정기 배치가 있는 프로젝트만 복사 (batch.md 3절) |

### 4-7. 템플릿 (templates/ 8종)

**doc-claude용 6종**: `report.md`(업무 보고 — 핵심 요약/진행 현황 표/완료/진행/이슈/계획/요청), `tech-doc.md`(기술 문서 — 개요/빠른 시작/구조/상세/설정/문제해결/참고), `proposal.md`(기획·제안 — 한 줄 요약/배경/제안/기대 효과/실행 계획/리스크/의사결정 요청), `summary.md`(자료 정리 — 핵심 요약/주요 내용+원문 위치/시사점/비교/출처), `incident.md`(장애 기록 — 요약/영향/타임라인/원인/조치/재발 방지/교훈), `handover.md`(인수인계 — 시스템 개요/구성·접속/배포/정기 작업/자주 발생 문제/미해결/문서 위치).

**개발용 2종**:
- `changelog.md` — /work-log가 생성하는 변경 이력 형식. 기존→변경 서술 + 변경 파일 목록 + 맨 끝 커밋 코멘트 블록.
- `backlog.md` — `docs/REFACTORING_BACKLOG.md`의 형식. ID 체계(SEC/BE/FE/DB/TEST/OPS/DEAD), 필수 필드(심각도·작업량·상태·근거·문제·제안), **발견 ≠ 완료(STRICT)** 규칙, 상태 범례(☐/◐/☑/⊘), P0 요약표, 오탐·문서 불일치 부록.

### 4-8. 훅 (hooks/ 2종, 2026-07-12 추가)

`~/.claude/settings.json`에 등록되어 **규칙을 "기대"에서 "강제"로** 바꾸는 자동 검증 계층. Node 스크립트(jq 미설치 환경 대응)이며, JS/TS 프로젝트가 아니면(package.json 없음) 조용히 통과한다.

| 파일 | 이벤트 | 동작 |
|---|---|---|
| `post-edit-check.mjs` | PostToolUse (Write\|Edit) | 코드 파일 수정 직후, 가장 가까운 package.json(모노레포 대응) 기준으로 `lint`·`typecheck` 스크립트 실행. 실패 시 exit 2로 에러를 Claude에게 피드백 → 즉시 수정 유도 |
| `stop-test.mjs` | Stop | 턴 종료 시 `npm test` 실행. 실패 시 턴 종료를 막고 수정 유도 |

설계 포인트: post-edit 훅이 임시 마커 파일(세션 ID 기준)을 남기고 stop 훅이 소진하는 방식이라 **코드를 수정한 턴에만 테스트가 실행**된다(질문만 한 턴에는 안 돌아감). `stop_hook_active` 확인으로 무한 루프를 방지한다. settings.json 등록 형태:

```json
"hooks": {
  "PostToolUse": [{ "matcher": "Write|Edit", "hooks": [{ "type": "command",
    "command": "node \"$HOME/.claude/hooks/post-edit-check.mjs\"", "timeout": 120 }] }],
  "Stop": [{ "hooks": [{ "type": "command",
    "command": "node \"$HOME/.claude/hooks/stop-test.mjs\"", "timeout": 300 }] }]
}
```

### 4-9. 문서 생태계 (프로젝트마다 생성되는 3층 구조)

이 저장소의 규칙이 각 프로젝트에 만들어내는 문서 체계:

| 문서 | 역할 | 관리 규칙 |
|---|---|---|
| `CLAUDE.md` | 헌법 — 프로젝트 고유 규칙, 다중화 전환 목록, Critical Pitfalls | Pitfalls는 번호 레지스트리(재사용 금지), STRICT 마커 + 날짜 + 예시 + 근거, 비대해지면 위성 분리. 단일 인스턴스 의존 항목은 "다중화 전환 목록"에 즉시 기록(patterns.md 0-3절) |
| `docs/dev_log/YYYY-MM-DD_CHANGELOG.md` | 작업 이력 | /work-log가 생성·누적, changelog 템플릿 |
| `docs/REFACTORING_BACKLOG.md` | 개선 과제 SSOT | 발견 즉시 추가, 발견 ≠ 완료(STRICT), backlog 템플릿 |
| `docs/incidents/YYYY-MM-DD_요약.md` | 장애 기록 (운영 프로젝트) | incident 템플릿, 백로그와 상호 링크 |

## 5. 설정

| 항목 | 값 | 위치 |
|---|---|---|
| 페르소나 설치 경로 | `~/.claude/agents/` | install 스크립트 |
| 규칙·컨벤션·스키마·템플릿·스캐폴드 | `~/.claude/jyp/{폴더}/` | install 스크립트 |
| 스킬 | `~/.claude/skills/{스킬명}/` | install 스크립트 (저장소 스킬만 교체) |
| 훅 스크립트 | `~/.claude/hooks/*.mjs` | install 스크립트 (mjs만 복사) |
| 훅 등록 | `hooks.PostToolUse` / `hooks.Stop` | `~/.claude/settings.json` (수동 1회 등록 — 4-8절 JSON) |

## 6. 문제 해결 (Troubleshooting)

- **수정한 규칙이 반영 안 됨** → 저장소 수정 후 `install.ps1` 재실행을 잊은 경우가 대부분. 설치 경로(`~/.claude/jyp/`)가 소비 지점이다.
- **훅이 발화하지 않음** → `/hooks` 메뉴에서 등록 상태 확인, `node --version` 동작 확인, settings.json이 유효한 JSON인지 확인(깨진 JSON은 해당 파일의 모든 설정을 조용히 무력화한다).
- **훅이 거슬림(대형 프로젝트에서 lint가 느림)** → `/hooks`에서 일시 비활성화하거나, `post-edit-check.mjs`를 파일 단위 lint로 튜닝.
- **스킬이 목록에 없음** → `~/.claude/skills/{이름}/SKILL.md` 존재 확인, frontmatter의 `name`/`description` 확인.

## 7. 참고 자료

- `README.md` — 설치·사용법 요약 (이 문서의 축약판)
- `rules/dev-rules.md` — 개발 규칙 SSOT (컨벤션 라우팅의 진입점)
- `scaffolds/default.md` — 새 프로젝트 절차 SSOT
- `conventions/database.md` 8절 — 타 DB 채택 시 치환 매핑
- `templates/backlog.md` 운영 규칙 — "발견 ≠ 완료" 원칙의 원문
