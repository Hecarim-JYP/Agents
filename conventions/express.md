# 구현 패턴 — Express/Node 서버 (JYP)

실무에서 검증된 Express 서버 구현 패턴. `patterns.md`(언어 무관)를 전제로 한다.

## 0. 언어 (신규 프로젝트)

- **신규 Express/Node 서버는 TypeScript(`.ts`) 기본**, `tsconfig.json`은 `strict: true` 고정. JavaScript는 사용자가 명시적으로 요청할 때만 (react.md 0절과 동일 근거 — 2026-07-11 확정).
- `any` 사용 금지 — 타입을 모르면 `unknown`으로 받아 좁혀서 사용.
- 실행/빌드: 개발은 `tsx watch src/index.ts`, 배포는 `tsc`로 `dist/` 빌드 후 `node dist/index.js`.
- `req.user` 같은 커스텀 필드는 타입 확장(declaration merging)으로 선언해 전 컨트롤러에서 타입 안전하게 사용 — 신뢰값 주입(5절)의 재료가 타입으로 보장된다:

```ts
// src/types/express.d.ts
declare global {
  namespace Express {
    interface Request {
      user?: { id: number; companyId: number; roleCode: string };
    }
  }
}
```

- 응답 헬퍼·에러 클래스·쿼리 함수의 파라미터/반환값에 타입을 선언해 **응답 키 계약(2절)과 계층 간 계약을 컴파일 타임에 강제**한다. 단, 런타임엔 타입이 사라지므로 외부 입력 검증(3절)과 신뢰값 주입(5절)은 타입과 별개로 유지.
- 기존 JavaScript 프로젝트는 전환하지 않는다 — 현행 유지.

## 1. 계층 구조

```
src/
├── controller/{module}/    # 라우팅 + 응답 반환 (asyncHandler + 응답 헬퍼)
├── service/{module}/       # 비즈니스 로직 + 파라미터 검증/정규화
├── repository/{module}/    # SQL 쿼리 함수 (sql.md 스타일)
├── common/                 # 공용 유틸, 도메인 횡단 헬퍼
└── middleware/             # 인증, 에러 핸들러, 응답 헬퍼
```

- ES Modules(`"type": "module"`) — `require()` 금지, `import/export`만.
- 미들웨어 순서: **라우터 → notFoundHandler → errorHandler** 순서 필수 (순서가 틀리면 404/에러 응답이 깨진다).
- 네이밍: `{module}Controller.js` / `{module}Service.js` / `{module}Query.js`.

## 2. Controller (MANDATORY)

```js
// ✅ asyncHandler 필수 — try-catch 직접 작성 금지
router.get('/endpoint', asyncHandler(async (req, res) => {
  const result = await myService.getData(req.query);
  listResponse(res, { result });
}));
```

- 모든 라우트는 `asyncHandler`로 감싼다. 직접 try-catch 금지 (예외: SSE처럼 스트림을 직접 관리하는 특수 라우트만 — 예외는 CLAUDE.md에 사유와 함께 기록).
- 응답은 공용 응답 헬퍼로만. **응답 키 계약을 프로젝트 초기에 정하고 혼용 금지** — 신규 프로젝트는 단일 봉투(예: 모든 헬퍼가 `data` 키) 권장, 계약은 CLAUDE.md에 기록.
- 에러 응답 본문 키도 계약으로 고정 (예: `message` + `error` + `field`).

## 3. Service — 경계 검증 = zod (STRICT)

외부 입력(요청 body/query/params)은 서비스 진입 시 **zod 스키마로 검증·파싱**한다 — TypeScript 타입은 런타임에 사라지므로(patterns.md 4절) 스키마 검증이 실제 방어선이다.

```ts
const GetItemsParams = z.object({
  scope_key: z.coerce.number().int(),      // coerce/default가 타입 정규화를 대신한다
  keyword:   z.string().trim().default(''),
});
type GetItemsParams = z.infer<typeof GetItemsParams>;  // 검증과 타입을 한 곳에서 — 이중 정의 금지

export const getItems = async (raw: unknown) => {
  const params = GetItemsParams.parse(raw);  // ① 검증+정규화 최상단 — 실패(ZodError)는 errorHandler가 400으로
  // ② 비즈니스 규칙 위반: throw new ValidationError('메시지')
  // ③ DB 에러: catch 없이 상위로 throw (asyncHandler → errorHandler가 처리)
  return await itemQuery.findItems(conn, params);
};
```

- ZodError는 중앙 errorHandler에서 400 + 에러 키 계약(`message`/`error`/`field`)으로 변환한다.
- 쿼리 함수에는 검증된 값만 전달하고, 쿼리 함수 내부의 인라인 형변환(`String(params.x ?? '')`)은 금지 — 정규화는 여기서 끝낸다.
- 기존 JS 프로젝트는 기존 방식(`checkRequiredParams` + `toNumberOrNull` 유틸) 유지.

## 4. 트랜잭션

```js
let conn;
try {
  conn = await getPool().getConnection();
  await conn.beginTransaction();
  // ... 다중 쓰기
  await conn.commit();
} catch (err) {
  if (conn) await conn.rollback();
  throw err;   // 롤백 후 반드시 재던짐 — 삼키지 않는다
} finally {
  if (conn) conn.release();
}
```

- **트랜잭션 경계 = 서비스 소유 (STRICT).** 여러 쿼리를 묶는 단위는 비즈니스 절차의 단위이므로, 커넥션 획득·begin·commit·rollback은 서비스가 한다. **쿼리 함수는 `conn`을 인자로 받아 쓰기만** 하고 스스로 커넥션을 잡지 않는다 — 쿼리 함수가 자체 커넥션을 열면 같은 절차 안의 쓰기가 서로 다른 트랜잭션으로 쪼개져 부분 커밋 사고가 난다.
- 롤백 시 부수 자원(업로드된 파일 등)도 함께 정리한다.
- 채번(일련번호)은 트랜잭션 내 재산정 + UNIQUE 제약 + 중복 키 재시도.

## 5. 신뢰값 주입 (STRICT)

- 스코프 값(테넌트/회사 ID)·행위자 값(`created_by`/`updated_by`)·권한 판단 재료는 **클라이언트 전송값을 무시하고 `req.user`(토큰 검증값)로 강제 주입**한다. 인증 미들웨어 직후 단일 지점에서 덮어쓰는 방식이 누락이 없다.
- 소유권/배정 비교도 클라 전송값이 아니라 `req.user.id` 기준. `null == null` 거짓 통과 방지를 위해 양쪽 null 가드 필수.
- 관리자/설정 엔드포인트는 로그인 여부(`authenticateToken`)만으로 부족 — `requireRole`/`requirePermission` 같은 권한 게이트를 반드시 부착한다 (근거: 게이트를 정의만 하고 라우트에 미적용하면 일반 사용자가 관리 API를 호출할 수 있다).

## 6. 파일 업로드 (STRICT)

- **저장 파일명은 서버가 생성**(UUID/타임스탬프) — 사용자가 보낸 파일명·경로를 저장 경로에 사용 금지 (근거: 경로 트래버설 공격의 원천 차단). 원본 파일명은 DB 메타에만 보관.
- 저장 경로는 `uploads/{module}/{type}/` 구조로 서버가 정적으로 결정. 검증: 확장자 화이트리스트 + MIME + 크기 제한.
- **파일과 DB 메타는 항상 쌍**: 원본 파일명, 저장 경로, 크기, 소속(module/reference_id), `created_by`를 기록한다 — 어느 하나만 있으면 고아 파일/깨진 링크가 된다. 트랜잭션 롤백 시 저장된 파일도 삭제(4절).
- 다운로드는 **권한 검사 후** DB에 기록된 경로로만 제공 (요청 파라미터의 경로 사용 금지). 미리보기는 `disposition=inline` 분기.
- 클라이언트 FormData는 텍스트 필드를 먼저, 파일(`files`)을 마지막에 append — multipart 파서가 필드를 파일보다 먼저 읽어야 하는 제약. 키 케이싱은 서버와 일치.
- 업로드 폴더는 git 비추적(`.gitignore`), 컨테이너에서는 볼륨(docker.md 4절), 백업 대상(ops.md 6절).

## 7. 기타

- MariaDB/MySQL 드라이버가 BigInt를 반환하는 값(count, affectedRows, insertId)은 `Number()` 변환 후 사용 (근거: BigInt는 JSON 직렬화 시 오류를 일으킨다).
- 환경변수 시크릿/내부 주소에 하드코딩 폴백 금지 — 미설정 시 부팅 실패 (patterns.md 4절).
- 소프트삭제·쿼리 스타일은 `sql.md` 참조.
