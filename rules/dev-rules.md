# 개발 작업 규칙 (JYP)

<!-- 프로젝트 CLAUDE.md에서 @로 import해서 사용:
     @~/.claude/jyp/rules/dev-rules.md -->

## 소통
- 설명과 보고는 한국어, 코드와 기술 용어는 영어 원문 유지
- 결론부터 보고: 무엇을 했는지 → 왜 → 다음 할 일

## 작업 절차
1. 시작 전 이해한 요구사항을 한 문단으로 정리 (애매한 부분은 명시)
2. 수정할 파일과 접근 방법을 먼저 밝히고 진행
3. 기존 코드 스타일을 따르고, 요구하지 않은 리팩토링 금지
4. `npm test`(또는 pytest) 실행 또는 직접 실행으로 검증. 검증 못 했으면 "검증 안 됨" 명시. 실패 테스트 숨기기·skip 얼버무리기 금지
5. 변경 파일 목록 + 핵심 변경 + 검증 결과로 보고

## 코딩 컨벤션과 스캐폴드
- 코드 작성 시 `~/.claude/jyp/conventions/general.md`의 범용 컨벤션을 따른다 (기존 코드베이스 스타일이 우선)
- 구현 구조는 `~/.claude/jyp/conventions/patterns.md`(계층 분리·책임 배치·신뢰 경계)를 따른다
- 스택별 추가 적용: SQL은 `sql.md`, DB 스키마 설계·운영은 `database.md`(네이밍·공통 컬럼·타입·인덱스/제약), Express/Node 서버는 `express.md`, React 클라이언트는 `react.md`
- DB 기초 테이블(인증·권한, 공통코드, 파일 메타, 감사 로그, schema_migrations)은 새로 설계하지 말고 `~/.claude/jyp/schemas/`의 표준 DDL을 복사·조정해서 시작한다
- 자동화 테스트는 `~/.claude/jyp/conventions/testing.md`를 따른다 — 핵심 로직 변경 시 테스트 동반 작성, 못 썼으면 보고·changelog에 "테스트 미작성" 명시 + 백로그 `TEST-` 항목 추가 (게이트+기록)
- 배포·운영은 `~/.claude/jyp/conventions/ops.md`(환경 분리·로깅·보안 체크리스트·백업), DB 마이그레이션은 `migration.md`(번호·멱등성·DDL/DML 분리·2단계 배포)를 따른다
- 모든 서비스는 개발·운영 공통 **Docker 컨테이너**로 배포·운영 — `~/.claude/jyp/conventions/docker.md` (멀티스테이지·non-root·.env 이미지 포함 금지·태그=git 태그·롤백=직전 이미지·앞단 리버스 프록시+HTTPS)
- 인증·권한은 `auth.md`(bcrypt/argon2, access 짧게+refresh, 서버측 무효화, RBAC+데이터 스코프 3종, default deny, **토큰은 메모리+httpOnly refresh 쿠키 — 로컬/세션스토리지 저장 금지**, 스택별 매핑 표), API 설계는 `api.md`(리소스 URL·상태코드·page/size/sort 표준·snake_case 필드)를 따른다
- 화면 디자인·테마·UX는 `~/.claude/jyp/conventions/design.md`를 따른다 — Tailwind + shadcn/ui 표준, 색상은 시맨틱 토큰만(hex 직접 지정 금지), 업무/서비스 UI 모드, 로딩·빈 상태·에러 3종 필수
- 새 프로젝트 세팅 요청 시 `~/.claude/jyp/scaffolds/default.md`의 절차를 따른다

## 코드
- 새 의존성 추가는 사전 보고
- 설명 주석 적극 작성: 모든 새 파일에 파일 헤더 주석(작성자 `[박진영]` 고정, `[JYP]` 금지), 함수 인자·props는 선언부 상단 doc comment(`@param`), 구조분해 인라인 설명 주석 금지 (컨벤션 5절)
- 파일 IO, 네트워크, 외부 입력에는 반드시 에러 처리
- 경로/URL/키 하드코딩 금지 → 상수나 설정으로 분리

## Git
- 커밋 메시지: `타입: 한글 요약` (feat/fix/refactor/docs/chore/test)
- 커밋 하나 = 논리적 변경 하나
- 브랜치: main = 항상 배포 가능 상태, 작업은 feature/fix 브랜치 → 완료 후 main 병합. 운영 배포는 main에서만 + 배포 태그
- 요청 없이 push 금지, 파일 삭제·강제 push·히스토리 변경은 사용자 확인 필수

## 문서 생태계
- 프로젝트 문서 역할 분리: CLAUDE.md(헌법) / `docs/dev_log/YYYY-MM-DD_CHANGELOG.md`(작업 이력) / `docs/REFACTORING_BACKLOG.md`(개선 과제 SSOT — 발견 즉시 추가)

## 명령 (절차의 단일 출처 = 스킬 파일, STRICT)
아래 명령(또는 동등한 자연어)을 요청받으면 **해당 스킬 파일을 읽고 그 절차를 그대로 수행**한다. 절차를 이 문서에 중복 정의하지 않으며, 절차 수정은 스킬 파일에서만 한다.
- "작업 정리" → `~/.claude/skills/work-log/SKILL.md`
- "배포 준비" → `~/.claude/skills/deploy-check/SKILL.md`
- "통합 테스트" → `~/.claude/skills/paper-test/SKILL.md`
- "새 프로젝트 세팅" → `~/.claude/skills/new-project/SKILL.md`

## CLAUDE.md 운영 규칙 (프로젝트 헌법 관리)
- Critical Pitfalls는 **번호 레지스트리**로 관리: 번호 재사용 금지, 기존 항목과 겹치면 새 번호 대신 기존 항목 갱신
- 강제 규칙에는 STRICT/MANDATORY 마커 + 확정 날짜(YYYY-MM-DD), 규칙 추가 시 ✅/❌ 예시와 근거(어떤 버그에서 나왔는지) 병기
- 문서와 코드가 어긋난 것을 발견하면 문서를 정정하고 정정 날짜를 남긴다
- Pitfalls가 비대해지면(수십 개 이상) 위성 문서로 분리하고 CLAUDE.md에는 인덱스만

## 분석·검증 안전 원칙
- 모든 발견·주장에 근거(`파일경로:라인` + 스니펫) 필수, 추측 보고 금지
- 분석용 서브에이전트는 반드시 읽기 전용 — 수정은 사용자 승인 후 메인 세션에서 직접
- 정적 분석 보고 시 범위 한계(런타임·실DB·동시성 미검증) 고지, 발견 항목은 ①확인된 버그 ②의심 ③정상 확인으로 분류

## 금지사항
- 검증 없이 "완료됐다"고 보고하는 것
- 실패한 테스트를 숨기거나 skip으로 얼버무리는 것
- 사용자 확인 없이 파일 삭제, 강제 push, 히스토리 변경
