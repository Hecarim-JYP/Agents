# 레시피: 민감 정보 암호화 저장 — 검색 가능성 포함 `[대외]` ⚑

> 확정: 2026-10-19 | 원칙: personal-data.md(마스킹·접속기록), auth.md 1절(비밀번호는 일방향 해시) | 짝: mfa.md 3-4절(같은 AES-GCM 방식), account-withdrawal.md
> 고유식별정보·계좌·카드번호처럼 **법이 암호화를 요구하는 값은 앱이 AES-256-GCM으로 암호화해서 저장**하고, 검색이 필요하면 **별도 키의 HMAC(블라인드 인덱스)** 으로 정확 일치만 찾는다. DB의 `AES_ENCRYPT`는 쓰지 않는다.

## 1. 언제 쓰나

주민등록번호·여권번호·운전면허번호·외국인등록번호·신용카드번호·계좌번호·생체인식정보를 저장할 때. 비밀번호는 이 레시피가 아니다(일방향 해시 — auth.md 1절).

⚑ 되돌리기 어려운 이유: 평문으로 쌓은 뒤 암호화로 바꾸면 전 행 재기록·검색 쿼리·인덱스·화면 마스킹이 함께 바뀐다. 저장 전에 정한다.

### 1-1. 법정 요건 (원문 확인 2026-10-19 — legalize-kr: 법제처 데이터를 옮긴 공개 저장소)

| 항목 | 내용 | 근거 |
|---|---|---|
| 주민등록번호 처리 | 법령이 구체적으로 요구·허용하는 경우 등에만 처리 가능, 회원 가입 단계에서는 **주민등록번호 없이 가입할 방법을 제공** | 개인정보 보호법 제24조의2 ①③ |
| 주민등록번호 암호화 | 전자적으로 보관하면 **암호화 필수** | 같은 조 ②, 시행령 제21조의2 |
| 이용자 정보 암호화 저장 | 정보통신서비스 이용자의 주민등록번호·여권번호·운전면허번호·외국인등록번호·**신용카드번호·계좌번호**·생체인식정보 | 「개인정보의 안전성 확보조치 기준」 제7조 ② (2026-07-01 시행본) |
| 이용자가 아닌 정보주체 | 인터넷 구간·DMZ에 고유식별정보 저장 시 암호화, 내부망은 주민등록번호 필수·나머지는 위험도 분석에 따라 | 같은 고시 제7조 ③ |
| 키 관리 절차 | 정보주체 10만 명 이상 대기업·중견기업·공공기관, 100만 명 이상 중소기업은 **키 생성·이용·보관·배포·파기 절차 수립** | 같은 고시 제7조 ⑥ |

- 기간·대상은 개정이 잦다 — 착수 시 현행 원문을 다시 확인해 CLAUDE.md에 기록한다 (MANDATORY).

## 2. 결정 항목 (기본값)

| 결정 | 기본값 | 대안 / 비고 |
|---|---|---|
| 수집 여부 | **수집하지 않는다** — 가장 강한 보호 | 주민등록번호는 법령 근거가 있을 때만 (1-1절) |
| 암호화 위치 | **앱 계층 AES-256-GCM**, 행마다 랜덤 IV, 키 버전 1바이트 | DB `AES_ENCRYPT` 금지 — 4절 |
| 키 보관 | 환경변수 `FIELD_ENC_KEY_V{n}`·`FIELD_BIDX_KEY`(각 32바이트 base64, `openssl rand -base64 32`) — `.env.example`(빈 값)·compose server `environment:`(`:?` 필수)에 함께 추가(ops.md 1절), 개발·운영 다른 값, 원본은 비밀 보관소 | 규모 기준(1-1절) 이상이면 KMS·HSM 검토 |
| 검색 | **정확 일치만** — 블라인드 인덱스 `HMAC-SHA256(FIELD_BIDX_KEY, 정규화 값)` | 부분 검색(뒷자리 4개 등)은 그 부분만 따로 블라인드 인덱스 — 경우의 수가 적으면 같은 값끼리 묶여 보인다 |
| 화면 표시 | **마스킹이 기본**, 원문은 권한 + 사유 + 접속기록 (personal-data.md) | |
| 키 교체 | 새 키로 새 값만 암호화 → 배치가 옛 버전 행을 다시 암호화 → 옛 키 폐기 | |

## 3. 표준 설계

### 3-1. 암호화·복호화·블라인드 인덱스

```js
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

// 키는 버전별 환경변수 — 없으면 기동 실패(폴백 금지, patterns.md 4절)
const KEYS = { 1: Buffer.from(process.env.FIELD_ENC_KEY_V1, 'base64') };
const CURRENT_KEY_VERSION = 1;
const BIDX_KEY = Buffer.from(process.env.FIELD_BIDX_KEY, 'base64');   // 암호화 키와 다른 키

/** 필드 암호화 — 결과는 키 버전(1) + iv(12) + 인증 태그(16) + 암호문 */
export function encryptField(plain) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEYS[CURRENT_KEY_VERSION], iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from([CURRENT_KEY_VERSION]), iv, cipher.getAuthTag(), encrypted]);
}

/** 필드 복호화 — 첫 바이트의 키 버전으로 키를 고른다(키 교체 중에도 옛 행이 풀린다) */
export function decryptField(blob) {
  const decipher = createDecipheriv('aes-256-gcm', KEYS[blob[0]], blob.subarray(1, 13));
  decipher.setAuthTag(blob.subarray(13, 29));
  return Buffer.concat([decipher.update(blob.subarray(29)), decipher.final()]).toString('utf8');
}

/** 정확 일치 검색용 블라인드 인덱스 — 형식 차이(하이픈·공백)가 다른 값이 되지 않게 정규화한 뒤 HMAC */
export const blindIndex = (value) => createHmac('sha256', BIDX_KEY).update(value.replace(/\D/g, '')).digest('hex');
```

```sql
-- 컬럼: 암호문 + 블라인드 인덱스(인덱스는 이쪽에만)
rrn_enc   VARBINARY(64) NOT NULL,                       -- 13자리 기준 43바이트 (1 + 12 + 16 + 14)
rrn_bidx  CHAR(64) CHARACTER SET ascii NOT NULL,
KEY idx_{테이블}_rrn_bidx (rrn_bidx)

-- 검색: WHERE rrn_bidx = :blindIndex(입력값)
```

- 실측 2026-10-19 (Node 22 + MariaDB 10.11 · MySQL 8.0.46, 1만 행): 같은 평문을 두 번 암호화 → **다른 암호문** / 하이픈 없이 입력해도 블라인드 인덱스로 같은 행을 찾고 `EXPLAIN`이 인덱스 사용 / INSERT 177ms·498ms, **1만 행 전체 복호화 82ms·63ms** / 키 교체 후 v1 행·v2 행 모두 복호화 / 저장 크기 43바이트.

### 3-2. 키 교체

1. `FIELD_ENC_KEY_V2` 추가, `CURRENT_KEY_VERSION = 2` 배포 — 새로 쓰는 값만 v2.
2. 배치: `SELECT … WHERE ASCII(LEFT(rrn_enc, 1)) = 1` 묶음 단위로 복호화 → v2로 재암호화 → 조건부 UPDATE(버전 바이트가 아직 1인 행만).
3. v1 행이 0이면 `FIELD_ENC_KEY_V1` 제거. 블라인드 인덱스 키를 바꾸면 인덱스 컬럼을 전부 다시 계산해야 한다 — 바꿀 일이 생기지 않게 처음부터 별도 키로 둔다.

### 3-3. 남는 위험을 줄이는 것

- 복호화는 **표시·외부 전송 직전에만** — 목록 조회에서 일괄 복호화하지 않는다(마스킹 값은 뒷자리만 따로 저장할 수도 있다).
- 로그·에러 메시지에 평문이 섞이지 않게(ops.md 3절 로그 마스킹) — 특히 검증 실패 메시지에 입력값을 되풀이하지 않는다.
- 백업은 암호문 그대로 — 키를 백업과 같은 곳에 두지 않는다.

## 4. 함정 (STRICT)

| 함정 | 증상 | 처방 |
|---|---|---|
| DB `AES_ENCRYPT` | **같은 평문 → 같은 암호문**(ECB 모드 — MySQL 기본 `aes-128-ecb`, MariaDB 10.11은 ECB만) — 같은 주민번호를 가진 행·흔한 값이 드러난다 (실측) | 앱 계층 GCM + 랜덤 IV |
| SQL 문장에 키 전달 | **키와 평문이 DB 일반 로그에 그대로 기록**(실측: MariaDB general log에 `AES_ENCRYPT('900101-…','team-secret-key-123')`), 슬로 쿼리 로그·프로세스 목록도 마찬가지 | 앱에서 암호화해 바인딩 |
| 암호문 컬럼에 인덱스·LIKE | 검색이 안 되거나 전체 스캔 + 일괄 복호화 | 블라인드 인덱스로 정확 일치 |
| 블라인드 인덱스 키 = 암호화 키 | 한 키가 새면 둘 다 무너진다 | 별도 키 |
| 정규화 없이 HMAC | `900101-1234567`과 `9001011234567`이 다른 값 | 정규화 후 (실측: 하이픈 없이 검색 성공) |
| 키를 코드·저장소·DB에 | 저장소·DB 유출 = 복호화 가능 | 환경변수 + 비밀 보관소, 개발·운영 분리 |
| 가입에 주민등록번호 요구 | 법 위반 (제24조의2 ③) | 대체 가입 수단 |

## 5. 스택별 구현

| 구성 | Express | Spring |
|---|---|---|
| 암호화 | `node:crypto` `aes-256-gcm` (3-1절, 실측) | `Cipher.getInstance("AES/GCM/NoPadding")` + `GCMParameterSpec(128, iv)` — **Java 출력은 `암호문 ‖ 태그` 순서**라 저장 전에 `버전 + iv + 태그 + 암호문`으로 재배치하고, 복호화는 `update(암호문)` 뒤 `doFinal(태그)` (실측 2026-10-20, Java 25: Node가 만든 암호문을 Java가, Java가 만든 암호문을 Node가 각각 복호화 — 같은 형식) |
| 블라인드 인덱스 | `createHmac('sha256', key)` | `Mac.getInstance("HmacSHA256")` |
| 컬럼 매핑 | 리포지토리에서 암·복호화 — 서비스 위로는 평문 문자열 | JPA `AttributeConverter` 또는 리포지토리 계층 |

## 6. 검증 포인트

- 자동화 테스트(테스트 DB): 같은 값 2회 저장 → 암호문 다름 / 형식이 다른 입력으로 검색 → 같은 행 / 키 교체 후 옛 행 복호화 / 태그를 1바이트 바꾸면 복호화 예외(변조 검출).
- DB를 직접 열어 해당 컬럼이 읽을 수 없는 값인지, 로그에 평문이 없는지(일반 로그를 잠깐 켜고 주요 화면을 돌려 grep).
