# 변경 이력 — 2026-10-16

> 작업 베이스 커밋 d990c41(2-2차 레시피 연결, 2026-10-14) 이후 — 오전 1커밋(cce2116) + 3-1차 운영 기능 레시피 5커밋(3a94f49 ~ 이 문서 갱신).
> 사용자 질문 "livetest를 하면 papertest와는 다른 거야?" → 답변 중 의도 확인: **livetest는 papertest를 아우르는 상위 개념의 테스트로 하려던 것.** 10-14에 만든 "나란히 있는 두 스킬 + 결과 이어 붙이기" 구조가 의도와 어긋나 재구성했다. 이어서 "3차 진행해" — `[대외]` 20개 중 계정·보안 핵심 6개를 3-1차로 진행.
> 핵심 주제: **① /live-test를 정적 추적까지 포함하는 상위 통합 테스트로 재구성 ② 명령 라우팅 재배치 ③ 3-1차 레시피 6개(가입·재설정 / 빈도 제한 / 외부 노출 ID / 업로드 검사 / 보안 헤더 / 2단계 인증) ④ 실측에서 나온 기존 결함 정정(프록시 IP 위조 채택 등)**

---

## 1. /live-test — 상위 통합 테스트로 재구성 (cce2116)

기존: /paper-test(정적 추적)와 /live-test(실측)가 나란히 있고, 사용자가 두 번 실행해 papertest의 ② 의심 항목을 livetest 입력으로 넘기는 구조. 10-14 검토 때 "papertest의 안전 규칙(앱 실행 금지·읽기 전용)과 실측(서버 기동·DB 쓰기)이 정반대라 한 스킬에 넣으면 규칙이 무너진다"는 이유로 분리했다.
변경: 그 우려는 **단계 분리**로 해결된다 — 한 명령 안에서도 정적 단계(읽기 전용, 병렬 허용)와 실측 단계(개발 DB 쓰기, 병렬 금지)의 규칙을 단계별로 따로 적용하면 된다. /live-test 하나로 끝까지 돈다.

| 단계 | 내용 |
|---|---|
| 0. 환경 판별 | 앱 기동·개발 DB 접속이 되면 **전체 모드**, 아니면 **정적 모드**(실측 축 "–" + 이유). 전체 모드는 운영 DB 대조 필수 — 운영과 일치하면 실측만 중단하고 정적 모드로 전환 |
| 1. 정적 추적 | `paper-test/SKILL.md`를 읽고 그 절차 1~4를 그대로 수행 — **절차를 복제하지 않고 위임**(SSOT, paper-test를 고치면 자동 반영). 백로그 반영(5단계)은 여기서 하지 않음 |
| 2. 실측 | 대상 = ② 의심 전부 + ① 버그 재현 + ③ 핵심 표본 + 정적으로 못 보는 5축(런타임·실DB·외부·동시성·렌더링). 기존 실측 절차 그대로 |
| 3. 통합 판정 | 정적 판정 × 실측 판정 → 최종 ①②③. **정적 ③인데 실측 ① = ★정적 누락**으로 별도 표시(다음 정적 추적의 체크리스트 후보), 정적 ①인데 재현 안 됨 = ②(정적 근거 재검토). 백로그는 통합 판정 후 한 번 |

사용자 결정(권장안 채택):
- 명령 라우팅: "통합 테스트"·"실동작 테스트"·"화면 테스트" → /live-test, "정적 추적"·"페이퍼 테스트" → /paper-test
- 실측 불가 환경: 정적 단계만 수행하고 실측 축 "–"로 보고 (중단하지 않음)

/paper-test는 정적 추적 단독 명령으로 남겼다 — 가볍게 훑을 때, 앱을 띄울 수 없는 환경, qa-claude·/review가 참조하는 대상.

**변경 파일**
- `skills/live-test/SKILL.md` — 0~3단계 구조로 재작성, 통합 판정표·★정적 누락 출력 추가, description을 "통합 테스트"로
- `skills/paper-test/SKILL.md` — "정적 추적"으로 명칭·트리거 정리, live-test 1단계로 쓰일 때 백로그 반영 생략 명시
- `rules/dev-rules.md` — 명령 라우팅 재배치
- `conventions/testing.md` — 6절이 통합 테스트의 **실측 단계** 규칙임을 명시
- `skills/review/SKILL.md`, `docs/OVERVIEW.md`, `README.md` — 두 스킬 관계를 상위·하위로 정정

---

## 2. 운영 기능 카탈로그 3-1차 — `[대외]` 계정·보안 핵심 6개 (3a94f49, bbbb8af)

`[대외]` 항목이 20개라 한 번에 쓰면 실측이 얕아진다 — 2차 때처럼 나눠 **3-1차(계정·보안 핵심 6개)**를 먼저 진행하고 나머지는 3-2차로 넘겼다. 레시피마다 함정을 실제로 재현해 근거를 남겼다(MariaDB 10.11 · Node 22 · nginx 1.24 · Caddy 2.6.2 · Chromium).

| 레시피 | 스키마 | 실측으로 확정한 함정 |
|---|---|---|
| `account-lifecycle.md` 가입·인증·재설정 | `16_account_token.sql` | 없는 계정이면 바로 반환하는 로그인 → **348ms vs 0ms**로 계정 존재 노출(더미 해시 비교로 350 vs 355ms) / 재설정 토큰을 `?token=`에 실으면 nginx 접근 로그에 원문 기록(`#token=`은 기록 안 됨) / 6자리 코드 시도 횟수를 "비교 후 증가"하면 동시 오입력 50건이 **50회 비교**(먼저 소모하면 5회) / 같은 링크 동시 확정 → 1건만 성공 |
| `rate-limit.md` 빈도 제한·CAPTCHA·WAF 경계 | — | `trust proxy` 미설정 → 전원이 프록시 IP / `true` → 위조 IP로 한도 우회(5회 모두 200, 라이브러리는 로그 경고만) / `1` → 200·200·200·429·429 |
| `public-id.md` 외부 노출 ID ⚑ | — | 기본 콜레이션(`utf8mb4_unicode_ci`)에 base64url ID → 대소문자만 다른 ID가 **중복 거부 + 다른 행 조회** / CHAR(36) PK는 같은 보조 인덱스를 6.5MB → 12.6MB로 키움 / 랜덤 PK의 INSERT 불이익은 20만 행에선 안 나타남 — PK를 BIGINT로 두는 이유를 성능이 아니라 일관성·인덱스 크기로 정직하게 기록 |
| `upload-security.md` 업로드 내용 검사 | — | `.png` + `image/png`로 위장한 HTML 통과 → 매직 바이트로 차단 / CSV는 매직 바이트가 없어 판정 불가(일괄 거부 금지) / 메타데이터만 지우면 세로 사진이 눕는다(`rotate()` 필요) / 16000² PNG 758KB가 618ms·4건 동시 416MB / **같은 출처에서 직접 연 SVG가 스크립트를 실행해 쿠키를 읽음** → `attachment`·`nosniff`·CSP `sandbox`로 차단, 정상 이미지는 같은 헤더로도 표시 |
| `security-headers.md` 보안 헤더·CSP | — | **helmet 기본 CSP의 `upgrade-insecure-requests` → HTTP 사내 IP에서 JS를 https로 요청해 빈 화면**(localhost는 정상) / server 블록 `add_header` + location `add_header` → 화면 응답 CSP 0개 / `style-src 'self'`만이면 Radix 주입 `<style>` 거부 → 스타일만 `'unsafe-inline'` |
| `mfa.md` 2단계 인증(TOTP) | `17_user_mfa.sql` | otpauth 9.5·직접 구현 모두 RFC 6238 벡터 6/6 / **otpauth `validate`는 같은 코드를 몇 번이든 통과** → `last_used_step` 조건부 UPDATE로 동시 2건 중 1건만·재사용·이전 단계 거부 / 복구 코드 동시 사용 1회만 |

**사용자 결정**: 없음 — 결정 항목은 기본값으로 작성(대외 로그인 잠금은 auth.md 기본(관리자 해제)과 달리 "15분 자동 + 재설정 해제"로 조정, CLAUDE.md 기록 대상으로 명시).

**시작 결정 체크리스트 28 신설** — 외부 노출 ID(사내: 적용 안 함 / 대외: `public_id` + API의 모든 ID를 공개 ID로). API 계약이라 되돌리기 어렵다.

**변경 파일**
- `conventions/features/` — 레시피 6(신규), `catalog.md`(3-3절 9개 📄, 나머지 3-2차로), `maintenance-mode.md`(Caddy 미검증 → 실측 반영)
- `schemas/16_account_token.sql`·`17_user_mfa.sql`(신규)
- `conventions/auth.md`(1절 응답 시간·대외 잠금 해제·레시피 링크), `express.md`(6절 MIME·inline), `ops.md`(5절 2·7번 + **11번 실제 IP·빈도 제한 신설**), `api.md`(429·공개 ID), `database.md`, `docker.md`, `spring.md`, `design.md`(폰트 번들), `features/personal-data.md`·`session-control.md`
- `scaffolds/default.md`(체크리스트 28, 기초 테이블 16·17, `.env.example` 키 2개), `templates/docker-compose.yml`(`TOKEN_HMAC_KEY`·`MFA_ENC_KEY` 선택 변수), `profiles/project-default.md`
- `rules/dev-rules.md`(카탈로그 기능 목록), `docs/OVERVIEW.md`(1.7), `README.md`, `skills/deploy-check/SKILL.md`

---

## 3. 실측에서 나온 기존 결함 정정 (f5a4342, c3bb252, bbbb8af)

| 결함 | 증상 | 정정 |
|---|---|---|
| **nginx 프록시 템플릿이 `X-Forwarded-For`를 이어 붙임**(`$proxy_add_x_forwarded_for`) | 클라이언트가 보낸 `6.6.6.6`이 `6.6.6.6, <실제 IP>`로 앱에 전달 → Spring이 위조 IP를 채택(로그인 이력·개인정보 접속기록·빈도 제한 전부) | `$remote_addr`로 덮어쓰기 (실측: 위조 시 앱이 받는 값 = 실제 IP). Caddy는 기본이 덮어쓰기(실측) |
| **spring.md가 `forward-headers-strategy: framework` 권장** (personal-data.md는 `native` — 문서 간 불일치) | `framework`는 `X-Forwarded-For` 맨 왼쪽(클라이언트가 보낸 값)을 쓴다 — spring-web 6.2 `ForwardedHeaderUtils` 소스 확인. `native`(Tomcat `RemoteIpValve`)도 사설 대역 접속 IP를 프록시로 보고 건너뛰어 사내망에선 위조값 채택 — Tomcat 10.1 소스 확인 | `native`로 통일 + "프록시 덮어쓰기가 전제" 명시 |
| helmet 기본값을 쓰라는 ops.md 5절 2번 | HTTP 운영 + Express가 HTML을 내려주면 빈 화면(실측) | 체크리스트에 `upgrade-insecure-requests` 제외 명시, docker.md 7절 HTTP 제약 목록에 추가 |
| express.md 6절 "확장자 + MIME" 검증 | 요청의 MIME은 보낸 사람이 정한 값 — 위장 파일 통과(실측) | 내용(매직 바이트) 판정 명시, inline은 래스터 이미지만 |
| 프로필에 체크리스트 27(개인정보) 기본 답안 누락 (2-2차에서 개수만 갱신) | 프로필 적용 시 27번이 묻지도 적용되지도 않음 | [고정]에 27·28 추가 |
| OVERVIEW "[확인] 4개" vs 프로필 실제 5개 + Spring 데이터 접근 | 인덱스와 원문 불일치 | 개수 대신 항목 나열 |
| deploy-check 스킬 "ops.md 5절의 10항목" | 체크리스트 항목이 늘면 낡는다(이번에 11번 신설) | 개수 표기 제거 |

**발견했지만 고치지 않음 (범위 밖 — 확인 필요)**: compose 템플릿·`.env.example`에 **JWT 서명 시크릿 변수가 없다** — auth.md 2절은 "시크릿은 환경변수로만"이라 규정하는데 연결 지점이 없어, 스캐폴드대로 만들면 프로젝트마다 즉흥으로 추가하게 된다.

---

## 검증

| 항목 | 결과 |
|---|---|
| `node scripts/check-refs.mjs` | 통과 — 문서 40개 / 참조 370건 |
| check-refs 확장 실행(skills·agents 포함) | 통과 — 문서 49개 / 참조 387건 |
| "통합 테스트 → paper-test" 잔존 문구 검색 | 없음 |
| `install.sh` 임시 HOME 설치 | 재구성된 live-test 설치 확인 (paper-test 위임 경로 포함) |
| /live-test 실프로젝트 실행 (전체·정적 모드) | **미검증** — 정적 모드 흐름은 회사 PC가 아닌 곳에서, 전체 모드는 회사 PC에서 첫 실행 필요 |
| `install.ps1` 재실행 | **미수행** — 회사 PC에서 `git pull` 후 실행 필요 |
| (3-1차) `node scripts/check-refs.mjs` | 통과 — 문서 46개 / 참조 425건 (skills·agents 포함 확장 실행: 55개 / 442건) |
| (3-1차) `scripts/verify-templates.sh` | 통과 — 개발·배포 두 모드 compose 병합·치환 정상 (새 선택 변수 포함) |
| (3-1차) 프록시 템플릿 실기동 | **nginx 1.24 · Caddy 2.6.2에 템플릿 그대로(주소만 치환) 기동**: `/`·딥링크·`/api`·`/health` 전부 기본 헤더 / `X-Forwarded-For` 위조 → 앱이 받은 값 = 실제 IP / 앱 정지 → `/api` JSON 503·화면 HTML 503·`/health` 502 / 앱이 보낸 503 통과. CSP 줄을 켜면 Vite+React 빌드가 프록시 뒤에서 렌더링·지연 청크·주입 스타일 정상, 콘솔 위반 0건 |
| (3-1차) 스키마 16·17 | MariaDB 10.11에 DDL 적용 + 레시피 SQL 그대로 실행(링크 동시 확정 3건 → 1건 / 코드 오입력 40건 → 비교 5회, 이후 정답도 차단 / 집계 쿼리가 `idx_account_token_target` 사용 / TOTP 동시 2건 → 1건). **MySQL 8.0 미검증** |
| (3-1차) `install.sh` 임시 HOME 설치 | 레시피 6·스키마 2·수정된 템플릿 설치 확인 |
| (3-1차) 실측 안 한 것 | CAPTCHA 제공사 검증 API, ClamAV, Spring 쪽 구현(Bucket4j·Tika·TOTP 라이브러리), LB·CDN 뒤 `real_ip` 구성 — 각 레시피에 "미검증"으로 표기 |

---

## 커밋 코멘트

```
@@ 2026-10-16 @@
/live-test를 정적 추적까지 아우르는 상위 통합 테스트로 재구성

■ /live-test (통합 테스트)
- 0단계 환경 판별 → 전체 모드 / 정적 모드(실측 불가 환경은 정적만, 실측 축 "–")
- 1단계 정적 추적: paper-test 절차 위임(복제 없음), 백로그는 통합 판정 후 한 번
- 2단계 실측: ② 의심 전부·① 재현·③ 표본·5개 축
- 3단계 통합 판정: 정적×실측 → 최종 ①②③, ★정적 누락 별도 표시

■ 명령 라우팅
- "통합 테스트"·"실동작 테스트"·"화면 테스트" → /live-test
- "정적 추적"·"페이퍼 테스트" → /paper-test (단독 명령으로 유지)

운영 기능 카탈로그 3-1차 — [대외] 계정·보안 레시피 6개 + 실측으로 찾은 프록시 IP 위조 결함 정정

■ 레시피 (conventions/features/)
- account-lifecycle: 가입·이메일/휴대폰 인증·비밀번호 재설정, 응답 문구·시간으로 계정 존재 비노출, 토큰은 fragment·POST 소비, 코드 시도는 먼저 소모
- rate-limit: 프록시 덮어쓰기 + trust proxy 1, 계층별 한도, CAPTCHA 서버 검증, WAF·DDoS 경계
- public-id: 내부 BIGINT PK 유지 + public_id(ascii_bin) — 체크리스트 28 신설
- upload-security: 매직 바이트 판정, 재인코딩(rotate·메타데이터 제거·픽셀 상한), inline은 래스터만 + nosniff·sandbox
- security-headers: 프록시 한 곳에서 기본 헤더, Vite 기준 CSP, helmet upgrade-insecure-requests 금지(HTTP)
- mfa: TOTP, 세션은 코드 통과 후, last_used_step 재사용 방지, 복구 코드, 비밀 AES-GCM
- schemas: 16_account_token, 17_user_mfa

■ 결함 정정
- nginx 프록시 템플릿: X-Forwarded-For 이어 붙이기 → 덮어쓰기 (위조 IP가 Spring·접속기록에 채택되던 문제)
- spring.md: forward-headers-strategy framework → native (+ 프록시 덮어쓰기 전제)
- Caddyfile: 보안 헤더 + 점검 안내(handle_errors, 2.6 expression 매처) 실측 반영
- ops.md 5절 11번 신설, express.md 6절 MIME 판정·inline 제한, 프로필 27·28 기본 답안
```
