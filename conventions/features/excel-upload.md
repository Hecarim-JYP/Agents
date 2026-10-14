# 레시피: 엑셀 업로드 (일괄 등록) `[사내]`

> 확정: 2026-10-14 | 관련: excel-download.md, express.md 3·6절(경계 검증·파일 업로드), change-history.md
> 사용자가 템플릿에 채운 엑셀을 올리면 **행마다 단건 등록과 같은 검증**을 하고, 오류가 하나도 없을 때만 **한 트랜잭션으로** 등록한다. 오류는 행·열·사유를 모아 한 번에 돌려준다.

## 1. 언제 쓰나

같은 형식의 데이터를 수십~수천 건 한 번에 등록·수정할 때(초기 데이터 이관, 월별 계획 입력 등). 수만 건 이상 정기 적재는 업로드가 아니라 배치·연동(batch.md·integration.md) 대상이다.

## 2. 결정 항목 (기본값)

| 결정 | 기본값 | 대안 / 비고 |
|---|---|---|
| 반영 정책 | **전부 통과해야 반영** (오류가 하나라도 있으면 0건 등록) | 성공 행만 반영은 "어디까지 들어갔는지" 추적 부담이 커서 요청이 있을 때만 |
| 단계 | **검증 → 확정 2단계**, 서버는 상태를 들고 있지 않는다 — 확정 때 같은 파일을 다시 받아 다시 검증 | 임시 적재 테이블은 대용량·장시간 검토가 필요할 때만 |
| 상한 | **5,000행 · 10MB** | 프록시 상한 > 앱 상한 (3-2절 체인) |
| 템플릿 | **서버가 생성해 내려준다** — 헤더·텍스트 서식·드롭다운 포함 | 사용자가 만든 양식을 받지 않는다 |
| 원본 보관 | 업로드 원본은 `files`(03_files.sql)에 보관, 등록된 행마다 change_log `CREATE` + 사유에 파일 ID | |

## 3. 표준 설계

### 3-1. 템플릿

- 헤더 행(1행) + 설명 시트. 헤더 이름이 열 매핑의 기준이다.
- **코드성 열(거래처코드·사번 등)은 텍스트 서식(`@`)** — 일반 서식이면 엑셀이 `00123`을 숫자 `123`으로 바꿔 저장한다. ⚠ ExcelJS에서 `columns[].style`의 서식은 **빈 셀에 적용되지 않는다** — 입력 범위(예: 2~1001행)의 셀마다 `numFmt = '@'`를 지정해야 파일에 반영된다(실측 2026-10-14).
- 공통코드 열은 **명칭 드롭다운**(데이터 유효성 목록) — 업로드 시 서버가 명칭 → 코드로 변환한다.

### 3-2. 수신

- 확장자 `.xlsx` + 파일 시그니처(zip의 `PK`) 확인. 구형 `.xls`는 거부한다(ExcelJS는 xlsx만 읽는다).
- 크기 상한은 **세 층이 맞물린다**: 프록시 `client_max_body_size`(스캐폴드 nginx 템플릿 20MB) > 앱 업로드 상한(10MB). 프록시가 더 작으면 앱에 닿기 전에 nginx가 **HTML 413**을 돌려줘 화면에 우리 에러 메시지가 안 나온다(실측: nginx 기본 1MB → 2MB 업로드 413). Spring은 `spring.servlet.multipart.max-file-size` 기본이 **1MB**다(소스 확인 — 3.5.6 `MultipartProperties`) — 명시적으로 올린다.

### 3-3. 파싱 — 헤더 이름으로 매핑, 셀은 정규화

```js
/**
 * ExcelJS 셀 값을 원시값으로 — 수식은 계산 결과, 서식 텍스트·하이퍼링크는 글자, 날짜는 엑셀에 보이던 값
 * @param {unknown} v ExcelJS cell.value
 * @returns {string|number|boolean|null} 정규화된 값
 * @throws {Error} FORMULA_WITHOUT_RESULT(계산된 적 없는 수식) / CELL_ERROR(#N/A 등) — 행 오류로 수집한다
 */
export function cellToPrimitive(v) {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {                                    // ExcelJS는 날짜 serial을 UTC로 해석 → UTC 성분이 엑셀에 보이던 값
    const p = (n) => String(n).padStart(2, '0');
    const date = `${v.getUTCFullYear()}-${p(v.getUTCMonth() + 1)}-${p(v.getUTCDate())}`;
    const time = `${p(v.getUTCHours())}:${p(v.getUTCMinutes())}:${p(v.getUTCSeconds())}`;
    return time === '00:00:00' ? date : `${date} ${time}`;
  }
  if (typeof v === 'object') {
    if ('formula' in v || 'sharedFormula' in v) {
      if (v.result === undefined || v.result === null) throw new Error('FORMULA_WITHOUT_RESULT');
      return cellToPrimitive(v.result);
    }
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('').trim();   // 부분 서식 텍스트
    if ('text' in v) return String(v.text).trim();                                          // 하이퍼링크
    if ('error' in v) throw new Error('CELL_ERROR');
  }
  return typeof v === 'string' ? v.trim() : v;
}
```

- 1행에서 **헤더 이름 → 열 번호** 맵을 만들고 이름으로 읽는다. 필수 헤더가 없으면 행 검증 전에 400.
- 빈 행은 건너뛴다. 행 수가 상한을 넘으면 그 자리에서 중단하고 400.
- 같은 열에 **날짜·문자열·숫자가 섞여 들어온다**(실측: 날짜 서식 셀은 `Date`, 사용자가 `2026/10/15`로 친 셀은 문자열) — 열 타입별 파서가 허용 형식(`YYYY-MM-DD`, `YYYY/MM/DD`)을 모두 받아 하나로 맞춘다.
- 코드 열에 숫자가 들어오면(`123`) 문자열로 바꾸고, **고정 길이 코드면 0을 채우고**(`padStart`) 아니면 행 오류로 돌려보낸다.

### 3-4. 검증 — 단건 등록과 같은 스키마

- 행마다 **단건 등록 API와 같은 zod 스키마**(express.md 3절)로 검증한다 — 엑셀로만 들어오는 불량 데이터를 막는다. 첫 오류에서 멈추지 않고 전 행을 검사해 `{ row, column, message }`를 모은다(최대 500개).
- 공통코드 명칭 → 코드 변환, 없는 명칭은 오류.
- **파일 안 중복**(같은 자연키 두 행)과 **DB 중복**(이미 있는 자연키)을 검사한다. DB 조회는 자연키 목록을 IN으로 — mysql2 `query` 사용(`execute`는 배열을 펼치지 않아 조용히 0건 — state-machine.md 3-4절).
- 결과는 **원본 파일에 "오류" 열을 덧붙인 엑셀**로도 내려준다 — 사용자가 그 파일을 고쳐 다시 올린다.

### 3-5. 확정 — 한 트랜잭션

- 같은 파일로 3-3·3-4절을 다시 수행 → 오류 0건이면 **한 트랜잭션에서 1,000행 단위 다건 INSERT** → 행마다 change_log `CREATE`(사유: 업로드 파일 ID) → 원본 파일 `files` 저장 → 커밋.
- 검증과 확정 사이에 다른 사용자가 같은 자연키를 등록했다면 UNIQUE 위반 → **전체 롤백 + 409**("다시 검증해 주세요"). UNIQUE가 최종 방어선이다 (database.md 5절).

## 4. 함정 (STRICT)

| 함정 | 증상 | 처방 |
|---|---|---|
| 열 **순서**로 매핑 | 사용자가 열 하나만 옮겨도 수량이 단가 칸에 들어간다 | 헤더 이름 매핑 (3-3절) |
| 결과 없는 수식 셀 | 값이 `undefined`로 읽혀 빈칸·0으로 등록 (실측: `{formula}`만 있고 `result` 없음) | 행 오류 "엑셀에서 열어 저장 후 다시 업로드" |
| 날짜 셀을 현지 시각으로 해석 | ExcelJS가 serial을 UTC로 주므로(실측: `2026-10-14T00:00:00Z`) 시각이 있는 셀은 9시간 어긋난다 | UTC 성분으로 읽기 |
| 코드 앞자리 0 소실 | 일반 서식 셀에 `00123` → 엑셀이 숫자 `123`으로 저장(엑셀의 알려진 동작 — 엑셀 프로그램은 이 환경에서 실측 못 함). 숫자 셀이 `number`로 읽히는 것은 실측 | 템플릿 텍스트 서식(셀마다) + 고정 길이면 0 채움 |
| 템플릿 서식을 열 스타일로만 지정 | 빈 셀에 서식이 안 들어가 위 문제가 그대로 (실측) | 셀마다 `numFmt = '@'` |
| 공백·서식 텍스트 그대로 | `"  A-01  "`·리치텍스트 객체가 저장된다 (실측: 앞뒤 공백 유지) | `cellToPrimitive` |
| 행마다 INSERT·커밋 | 중간 실패 시 앞부분만 들어가 재업로드하면 중복 | 한 트랜잭션 (3-5절) |
| 단건 등록과 다른 검증 | 화면으로는 못 넣는 값이 엑셀로 들어온다 | 같은 zod 스키마 |
| 프록시·프레임워크 기본 상한 | nginx 1MB(실측 413)·Spring 1MB(소스 확인)에서 업로드가 HTML 오류로 실패 | 3-2절 상한 체인 |
| 상한 없이 파일 전체 로드 | 큰 파일 하나로 서버 메모리 급증 (ExcelJS 일반 로드는 파일 전체를 메모리에 올린다) | 10MB·5,000행 상한, 더 크면 스트리밍 리더(`stream.xlsx.WorkbookReader`) |

## 5. 스택별 구현

| 구성 | Express | Spring |
|---|---|---|
| 수신 | multer — `limits.fileSize` 10MB (multer 기본은 무제한) | `MultipartFile` + `spring.servlet.multipart.max-file-size: 10MB` (기본 1MB) |
| 파싱 | ExcelJS `xlsx.load(buffer)` + 3-3절 정규화 | POI `XSSFWorkbook` + `DataFormatter`(셀을 화면에 보이는 문자열로) — 대용량은 이벤트 모델 |
| 검증 | 단건 등록 zod 스키마 재사용 | 단건 등록 DTO + Bean Validation(`Validator.validate`) 재사용 |
| 템플릿 | ExcelJS — 셀마다 `numFmt='@'`, `dataValidation` 목록 | POI `DataValidationHelper`, 셀 스타일 `@` |

## 6. 검증 포인트

- 자동화 테스트: 열 순서를 바꾼 파일 → 정상 매핑 / 결과 없는 수식 → 해당 행 오류 / 오류 1건 섞인 파일 → 0건 등록 / 파일 안 중복·DB 중복 → 오류 / 확정 중 UNIQUE 충돌 → 전체 롤백.
- 실동작 검증(/live-test 관찰자 모드): **실제 엑셀(Windows)에서** 템플릿을 열어 `00123` 입력·날짜 입력·행 이동 후 업로드 → 오류 리포트 파일 확인 → 고쳐서 확정 → DB 행 수·change_log 확인. 이 단계만 엑셀 프로그램 동작에 의존한다.
