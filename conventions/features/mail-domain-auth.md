# 레시피: 발송 메일 도메인 인증 — SPF·DKIM·DMARC `[대외]`

> 확정: 2026-10-19 | 원칙: notification.md 3-3절(메일 발송은 outbox relay) | 짝: marketing-message.md(광고 메일·수신거부), account-lifecycle.md(인증·비밀번호 재설정 메일), ops.md(DNS·시크릿 관리)
> 우리 도메인(`From`)으로 보내는 메일은 **DKIM 서명 + SPF 등록 + DMARC 정책** 세 가지를 DNS에 갖춘다. DMARC는 **SPF나 DKIM 중 하나가 `From` 도메인과 정렬된 채로 통과**해야 통과한다 — 대행사·중계 서버를 끼우면 정렬이 깨지기 쉽다. 광고 메일은 원클릭 수신거부 헤더를 DKIM 서명 범위에 넣는다.

## 1. 언제 쓰나

회원 가입 인증·비밀번호 재설정·주문 안내·광고처럼 **외부 수신자에게** 우리 도메인으로 메일을 보내는 서비스. 사내 메일 서버로 사내 직원에게만 보내는 알림은 사내 메일 관리자가 이미 설정했을 가능성이 크다 — 그래도 3-4절 확인은 한다.

### 1-1. 수신 측 요건 (2026-10-19 — 검색 요약, 2차 출처)

| 항목 | 내용 | 출처 |
|---|---|---|
| Gmail 대량 발송자 | 하루 **5,000통 이상**을 Gmail로 보내는 발송자 — SPF·DKIM·DMARC 모두, `From` 도메인 정렬, 광고 메일 **원클릭 수신거부(RFC 8058)**, 수신거부 **2일 이내** 처리, 스팸 신고율 기준 준수. 2024년 2월 시행, 2025년 11월부터 집행 강화 | Gmail 발송자 가이드라인 소개 기사·발송 대행사 공지 (원문 페이지는 이 환경에서 접근 불가) |
| 쟁점 | DMARC `p=none` 허용 여부, 스팸 신고율 기준값(0.1%/0.3%)이 출처마다 다르다 | 같은 출처 |
| RFC 8058 | `List-Unsubscribe-Post: List-Unsubscribe=One-Click` + `List-Unsubscribe`에 HTTPS URI, **유효한 DKIM 서명이 두 헤더를 모두 덮어야** 한다 | RFC 8058 (검색 결과의 rfc-editor 본문 요약) |

- 수신 측 기준은 바뀐다 — 착수 시 Gmail·네이버 등 주요 수신처의 발송자 가이드 원문을 확인해 CLAUDE.md에 기록한다 (MANDATORY). 하루 발송량이 기준 미만이어도 세 가지를 모두 갖추는 것이 기본값이다(2절).

## 2. 결정 항목 (기본값)

| 결정 | 기본값 | 대안 / 비고 |
|---|---|---|
| 발송 경로 | **발송 대행사(SES·SendGrid 등) 또는 사내 메일 서버** — 앱은 SMTP/API로 넘기기만 | 앱 서버에서 직접 MX로 발송 — IP 평판·역방향 DNS까지 관리해야 한다 |
| DKIM 서명 주체 | **대행사·메일 서버가 우리 도메인(`d=우리도메인`)으로 서명** — 대행사의 "도메인 인증" 설정 | 앱이 nodemailer `dkim`으로 서명(3-2절) — 개인키가 앱 환경변수에 있어야 한다 |
| `From` 도메인 | 서비스 도메인(예: `noreply@example.co.kr`) — 광고는 하위 도메인(`news.example.co.kr`)으로 분리 | 분리하면 광고 평판이 인증 메일 도달률을 끌어내리지 않는다 |
| SPF | 실제 발송 서버만 `include`/`ip4`, 끝은 `-all` 또는 `~all` | **DNS 조회 10회 이내** (4절) |
| DMARC | `p=none` + 집계 보고(`rua`) 2~4주 관찰 → `p=quarantine` → `p=reject` | 처음부터 reject — 누락된 발송 경로(외부 설문 도구 등)의 메일이 사라진다 |
| DKIM 키 | RSA 2048, 선택자에 연도(`mail2026`) — 교체 = 새 선택자 게시 → 서명 전환 → 옛 선택자 삭제 | |

## 3. 표준 설계

### 3-1. DNS에 올릴 레코드 (도메인 관리자에게 요청)

```
example.co.kr.                    TXT  "v=spf1 include:<대행사 SPF> ip4:<사내 메일 서버> -all"
mail2026._domainkey.example.co.kr TXT  "v=DKIM1; k=rsa; p=<공개키 base64>"           ← 대행사가 CNAME으로 주면 그대로
_dmarc.example.co.kr              TXT  "v=DMARC1; p=none; rua=mailto:dmarc-report@example.co.kr"
```

- 대행사를 쓰면 **Return-Path(봉투 발신자)도 우리 하위 도메인**으로 설정한다(대행사의 "custom MAIL FROM"류 설정) — 기본값인 대행사 도메인이면 SPF가 통과해도 `From`과 정렬되지 않아 DMARC에 도움이 안 된다.
- 레코드 요청·변경은 ops.md 1절처럼 변경 내용·사유·일시를 changelog에 남긴다.

### 3-2. 앱이 직접 서명할 때 (nodemailer)

```js
// external/mail/transport.js — DKIM 개인키는 환경변수(PEM, 줄바꿈은 \n 이스케이프) — .env.example·compose environment에 추가(ops.md 1절)
export const transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT), secure: Number(process.env.SMTP_PORT) === 465,   // 465 = 처음부터 TLS, 587 = STARTTLS
  dkim: {
    domainName: process.env.MAIL_DKIM_DOMAIN,                           // From 도메인과 같아야 정렬된다
    keySelector: process.env.MAIL_DKIM_SELECTOR,                        // 예: mail2026
    privateKey: process.env.MAIL_DKIM_PRIVATE_KEY.replace(/\\n/g, '\n'),
    // 기본 서명 대상에 List-Unsubscribe-Post가 없다(4절 실측) — 원클릭 수신거부를 쓰면 반드시 지정
    headerFieldNames: 'From:Sender:Reply-To:Subject:Date:Message-ID:To:Cc:MIME-Version:Content-Type:Content-Transfer-Encoding:List-Unsubscribe:List-Unsubscribe-Post',
  },
});
```

### 3-3. 원클릭 수신거부 (광고 메일)

```js
await transport.sendMail({
  from: '"우리 서비스" <news@news.example.co.kr>', to, subject: `(광고) ${title}`, html,
  list: { unsubscribe: { url: `${APP_BASE_URL}/unsubscribe/${unsubToken(userId, 'EMAIL')}` } },   // → List-Unsubscribe: <https://…>
  headers: { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },                               // RFC 8058
});
```

- 수신 측 메일 앱의 "구독 취소" 버튼이 그 URL로 `POST`(본문 `List-Unsubscribe=One-Click`)를 보낸다 — **로그인·확인 화면 없이 처리**하는 별도 엔드포인트. 본문 링크의 `GET`은 확인 화면(marketing-message.md 3-3절 — 보안 스캐너 오작동 방지)이고, 원클릭 `POST`는 바로 처리 — 같은 토큰·같은 처리 함수.
- 대행사가 서명하면 대행사 설정에서 이 두 헤더가 서명 범위에 들어가는지 확인한다(3-4절의 `h=`).

### 3-4. 확인 방법

- 실제 수신함(Gmail·네이버)으로 보내 **원본 보기**에서 `Authentication-Results`의 `dkim=pass`·`spf=pass`·`dmarc=pass`, `DKIM-Signature`의 `d=`(우리 도메인)와 `h=`(광고 메일이면 `list-unsubscribe:list-unsubscribe-post` 포함) 확인.
- DMARC 집계 보고(`rua`)에서 우리 도메인을 사칭하거나 누락된 발송 경로(설문 도구·CRM·사내 메일 서버)를 찾아 SPF·DKIM에 추가한 뒤 정책을 올린다.

- 실측 2026-10-19 (nodemailer 6.10 서명 → mailauth 4.13 검증, DNS는 가짜 리졸버로 우리 레코드를 흉내):

| 상황 | DKIM | SPF | DMARC |
|---|---|---|---|
| ① 정상 발송 | pass | pass | **pass** |
| ② 중계 서버가 본문을 바꿈 | neutral(본문 해시 불일치) | pass | pass — SPF 정렬로 통과 |
| ③ SPF에 없는 IP에서 발송 | pass | fail | pass — DKIM 정렬로 통과 |
| ④ SPF `include` 11개 | pass | **permerror**(조회 10회 초과) | pass — DKIM 덕분 |
| ⑤ `From`은 gmail.com, 서명은 우리 도메인 | pass | pass | **fail** — 정렬 안 됨 |
| ⑥ ②+③ 동시 | neutral | fail | **fail** — 정렬된 통과가 하나도 없다 |
| 원클릭 헤더 + 기본 서명 | `h=`에 `list-unsubscribe`만, **`list-unsubscribe-post` 없음** | | |
| 원클릭 헤더 + `headerFieldNames` 지정 | pass, 서명 후 `List-Unsubscribe-Post`를 지우면 **fail** | | |

## 4. 함정 (STRICT)

| 함정 | 증상 | 처방 |
|---|---|---|
| SPF만 설정 | 중계·전달 과정에서 IP가 바뀌면 SPF fail → 정렬된 통과가 없어 DMARC fail (실측 ⑥) | DKIM 필수 — 둘 중 하나라도 정렬 통과하면 DMARC 통과 |
| SPF `include` 남발 | DNS 조회 10회 초과 → **permerror** — SPF가 통째로 무효 (실측 ④) | 쓰지 않는 발송 경로 정리, 대행사 `include`는 필요한 것만 |
| 대행사 기본 도메인으로 서명·Return-Path | 인증은 pass인데 **DMARC fail**(정렬 안 됨, 실측 ⑤와 같은 구조) | 대행사의 도메인 인증·custom MAIL FROM |
| 무료 메일 주소를 `From`으로 | 우리 서명이어도 DMARC fail (실측 ⑤) — 수신처가 거부·스팸 처리 | 우리 도메인 `From` |
| nodemailer 기본 서명으로 원클릭 수신거부 | **`List-Unsubscribe-Post`가 서명 범위 밖**(실측) — 수신 측이 원클릭을 제공하지 않을 수 있다 | `headerFieldNames`에 두 헤더 포함 (3-2절) |
| 처음부터 `p=reject` | 빠뜨린 발송 경로의 메일이 조용히 사라진다 | `p=none` + 보고서 관찰 후 단계적으로 |
| 광고·인증 메일을 같은 도메인으로 | 광고 스팸 신고가 인증 메일 도달률을 떨어뜨린다 | 광고는 하위 도메인 |
| DKIM 개인키를 저장소·이미지에 | 키 유출 = 우리 도메인 사칭 메일이 DKIM pass | 환경변수·비밀 보관소 (ops.md 1절), 유출 시 선택자 교체 |

## 5. 스택별 구현

| 구성 | Express | Spring |
|---|---|---|
| 발송 | nodemailer — `external/mail/` (notification.md 5절) | `JavaMailSender` — `external/mail/` |
| 앱 서명 | nodemailer `dkim` 옵션 (3-2절, 실측) | Jakarta Mail 자체 서명 기능은 없다 — 대행사·메일 서버 서명이 기본. 앱이 서명해야 하면 `org.simplejavamail:utils-mail-dkim` `DkimMessage(msg, new DkimSigner(도메인, 선택자, RSAPrivateKey))` + **`addHeaderToSign("List-Unsubscribe-Post")`** — 기본 서명 목록에 `List-Unsubscribe`는 있고 `-Post`는 없다(nodemailer와 같은 함정). 기본값은 서명 전에 DNS의 선택자 공개키와 대조해 **DNS 등록 전에는 서명이 실패**한다 — DNS를 먼저 올린다 (실측 2026-10-20, 3.3.1 · Java 25: `rsa-sha256`·`relaxed/simple`, mailauth 검증 pass, 헤더 변조 fail) |
| 원클릭 헤더 | `list.unsubscribe` + `headers` (3-3절, 실측) | `MimeMessage.setHeader("List-Unsubscribe", …)`·`("List-Unsubscribe-Post", …)` |
| 검증 테스트 | mailauth로 생성 메일을 검증(가짜 리졸버) | 실제 수신함 원본 확인 |

## 6. 검증 포인트

- 운영 전: 3-4절 확인을 **발송 경로마다**(인증 메일·광고 메일·사내 메일 서버 경유) 한 번씩. 광고 메일은 Gmail의 "구독 취소" 버튼이 보이는지, 눌렀을 때 수신거부가 처리되는지.
- 자동화 테스트(앱 서명 시): 생성한 메일을 mailauth로 검증해 `dkim=pass`, `h=`에 원클릭 두 헤더 포함.
- 운영 중: DMARC 집계 보고를 주기적으로 보고, 실패가 늘면 새 발송 경로·DNS 변경을 의심한다.
