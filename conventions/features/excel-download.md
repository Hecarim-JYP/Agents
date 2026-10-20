# 레시피: 엑셀 다운로드 `[사내]`

> 확정: 2026-10-14 | 관련: excel-upload.md, auth.md 4-2절(데이터 스코프), react.md 7절(API 클라이언트)
> 목록 화면의 "엑셀 다운로드"는 **목록 API와 같은 조건·같은 권한으로 조회한 데이터를, 스트리밍으로 xlsx에 써서** 내려준다. 화면에서 안 보이는 데이터가 엑셀로 나가면 안 된다.

## 1. 언제 쓰나

목록·조회 화면의 내보내기. 정형 보고서 양식(셀 병합·서식 고정)은 템플릿 파일에 값을 채우는 별도 방식이 맞다 — 이 레시피는 목록 내보내기다.

## 2. 결정 항목 (기본값)

| 결정 | 기본값 | 대안 / 비고 |
|---|---|---|
| 형식 | **xlsx** | CSV는 요청 시만 — BOM·수식 주입 처리 필수 (4절) |
| 생성 방식 | **스트리밍 쓰기** (Node: ExcelJS `stream.xlsx.WorkbookWriter` / Spring: POI `SXSSFWorkbook`) | 일반 Workbook은 수천 행 이하 고정 양식에만 |
| 동기 다운로드 상한 | **10만 행** — 넘으면 생성 전에 400 `EXPORT_LIMIT_EXCEEDED`("조건을 좁혀 주세요") | 더 큰 추출은 장시간 작업(long-running-job.md)으로 비동기 생성 |
| 다운로드 기록 | 개인정보가 들어간 목록은 **audit_log에 기록**(누가·언제·조건·건수 — auth.md 5절) | 개인정보 없는 목록은 기록 생략 가능 |

## 3. 표준 설계

### 3-1. 조회 — 목록 API와 같은 계약

- 엔드포인트는 목록과 같은 리소스에 `GET /orders/export?…`(목록과 **같은 검색 파라미터**).
- **목록 API와 같은 검색 조건 파서·같은 쿼리 함수(데이터 스코프 포함)**를 쓰고 페이징만 바꾼다 — 별도 쿼리를 만들면 스코프 조건이 빠져 권한 밖 데이터가 나간다 (auth.md 4-2절).
- 순서: 건수 조회 → 상한 초과면 생성 없이 400 → 아니면 **정렬 키 + PK 키셋으로 1,000건씩** 읽어 쓴다(한 번에 다 읽지 않는다).
- 화면에서 마스킹하는 개인정보는 **엑셀에서도 같은 규칙으로 마스킹**한다 — 원문 다운로드 권한은 별도 권한 코드로.

### 3-2. 쓰기 — 셀 타입을 맞춘다

- 숫자는 숫자로(문자열로 넣으면 엑셀에서 합계가 안 된다), 코드값은 명칭으로 바꿔 텍스트로, 날짜는 날짜 셀 + 서식으로.
- ⚠ **ExcelJS는 JS `Date`를 UTC로 기록한다** — 서버가 Asia/Seoul이면 09:30이 엑셀에서 **00:30으로 보인다**(실측 2026-10-14: serial 46309.0208). 현지 시각 성분을 UTC 성분으로 옮겨 넣는다:

```js
/**
 * 엑셀 날짜 셀용 변환 — 서버 현지 시각을 "벽시계 값 그대로" 엑셀에 보이게 한다
 * @param {Date} d DB에서 읽은 DATETIME (mysql2가 현지 시각 Date로 준다)
 * @returns {Date} 현지 성분을 UTC 성분으로 옮긴 Date (ExcelJS가 UTC로 기록하므로 엑셀에는 현지 시각이 보인다)
 */
const asExcelDate = (d) => new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(),
  d.getHours(), d.getMinutes(), d.getSeconds()));
```

- 사용자 입력 문자열이 `=`로 시작해도 **xlsx에서는 수식이 아니라 문자열로 저장된다**(실측: `t="s"`, `<f>` 없음). CSV는 다르다 (4절).

### 3-3. 응답

```js
// 컨트롤러 — 헤더를 먼저 보내고 행을 흘려보낸다
res.attachment(`주문목록_${today}.xlsx`);     // filename*=UTF-8''… 가 함께 나간다 (실측 — 한글 파일명)
const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: res, useSharedStrings: false });
const ws = wb.addWorksheet('주문');
ws.columns = COLUMNS;                         // 헤더·폭·서식 정의 상수
try {
  for await (const chunk of readOrdersInChunks(filters, scope)) {   // 키셋 1,000건씩
    for (const row of chunk) ws.addRow(toExcelRow(row)).commit();  // 행마다 commit — 메모리에서 바로 내보낸다
  }
  await ws.commit();
  await wb.commit();
} catch (err) {
  logger.error({ err }, '엑셀 생성 실패');
  res.destroy(err);      // 이미 200 헤더가 나갔다 — 연결을 끊어 브라우저가 "실패"로 알게 한다 (깨진 파일 저장 방지)
}
```

### 3-4. 클라이언트

- 토큰이 메모리에 있으므로(auth.md 3절) `<a href>`로 이동하면 `Authorization` 헤더가 없어 401이다 — **공용 API 클라이언트로 `responseType: 'blob'` 요청** 후 `URL.createObjectURL`로 저장한다. 파일명은 `Content-Disposition`의 `filename*=UTF-8''…`를 `decodeURIComponent`로 읽는다.
- ⚠ blob 요청이 에러(400 상한 초과 등)로 끝나면 **응답 본문도 Blob**이다 — `err.response.data.message`가 비어 사용자에게 아무 메시지도 안 보인다(실측: Chromium XHR, `[object Blob]`). 공용 에러 메시지 유틸(react.md 7절)에서 Blob이면 `await data.text()` → JSON 파싱 후 `message`를 꺼낸다.
- 생성 중에는 버튼을 잠그고 "생성 중" 표시 — 10만 행도 수 초가 걸린다.

## 4. 함정 (STRICT)

| 함정 | 증상 | 처방 |
|---|---|---|
| 일반 Workbook에 전부 쌓은 뒤 저장 | 10만 행 × 10열에 **메모리 1.2GB·13초** — 몇 명이 동시에 누르면 서버가 죽는다 (실측: 스트리밍은 151MB·1.9초) | 스트리밍 쓰기 + 행마다 `commit()` |
| 목록 API와 다른 쿼리 | 스코프 조건 누락으로 권한 밖 데이터가 엑셀로 나간다 | 같은 쿼리 함수 (3-1절) |
| 화면 마스킹을 엑셀에 미적용 | 화면에서 가린 주민번호·연락처가 엑셀에 원문으로 | 같은 마스킹 규칙 |
| 상한 없음 | 전체 테이블 추출이 DB·서버를 붙잡는다 | 건수 먼저 확인, 상한 초과는 생성 전 거절 |
| `Date`를 그대로 기록 | 엑셀 시각이 9시간 이르게 보인다 (실측) | `asExcelDate` |
| `<a href>` 다운로드 | 401 — 토큰이 헤더로 안 간다 | blob 요청 (3-4절) |
| blob 에러 본문을 JSON으로 가정 | 상한 초과·권한 오류 메시지가 사라진다 (실측) | Blob → text → JSON |
| 스트리밍 도중 에러를 그냥 둠 | 200으로 끝난 **깨진 파일**이 저장된다 | `res.destroy(err)` (실측: 5만 행 중 3만 행에서 장애 → 클라이언트 본문 읽기 실패로 인지, 정상 시 5만 행 파일 재열람 확인) |
| CSV에 BOM 없음 | 엑셀(Windows)이 시스템 코드페이지로 읽어 한글이 깨진다 — 널리 알려진 동작(이 환경에서 엑셀 실측은 못 함) | CSV는 `﻿`로 시작 |
| CSV에 `=` `+` `-` `@`로 시작하는 사용자 값 | 엑셀이 수식으로 실행한다(CSV 수식 주입) | 해당 값 앞에 `'`를 붙인다 — xlsx는 문자열 셀이라 해당 없음(실측) |
| 프록시 타임아웃 | 첫 바이트 전 처리(건수·첫 청크)가 nginx 기본 `proxy_read_timeout`(60초)을 넘으면 504 | 상한·인덱스로 첫 응답을 빠르게, 그래도 길면 비동기 생성 |

## 5. 스택별 구현

| 구성 | Express | Spring |
|---|---|---|
| 스트리밍 쓰기 | ExcelJS `stream.xlsx.WorkbookWriter({ stream: res })` | POI `SXSSFWorkbook(100)` — 메모리에 100행만 두고 나머지는 임시 파일. 끝나면 임시 파일 정리(`dispose()`/`close()` — POI 버전 확인) |
| 날짜 | `asExcelDate` 보정 필수 | `LocalDateTime` + 날짜 서식 스타일 — 시간대 개념이 없어 보정 불필요 |
| 파일명 | `res.attachment(name)` | `ContentDisposition.attachment().filename(name, UTF_8)` |
| 기록 | audit_log INSERT (개인정보 목록) | 동일 |

## 6. 검증 포인트

- 자동화 테스트: 상한 초과 → 400 / 스코프 밖 행이 결과에 없다 / 날짜 셀 serial이 현지 시각과 일치 / 마스킹 컬럼 확인.
- 실동작 검증(/live-test 렌더링 축): 실제 다운로드 파일을 열어 행 수·날짜·한글 파일명 확인, 상한 초과 시 화면에 메시지가 보이는지, 생성 중 서버 메모리.
