# 구현 패턴 — Express/Node 서버 (JYP)

LTMS에서 검증된 서버 구현 패턴. `patterns.md`(언어 무관)를 전제로 한다.

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
- 응답은 공용 응답 헬퍼로만. **헬퍼별 응답 키 계약을 정하고 혼용 금지** (LTMS 계약: `listResponse`/`detailResponse` → `result` 키, `createdResponse`/`updatedResponse`/`deletedResponse` → `data` 키).
- 에러 응답 본문 키도 계약으로 고정 (LTMS: `message` + `error` + `field`).

## 3. Service

```js
export const getItems = async (params) => {
  utils.checkRequiredParams(params, ['scope_key']);   // ① 필수 파라미터 검증 최상단
  const queryParams = {
    scope_key: utils.toNumberOrNull(params.scope_key), // ② 타입 정규화 = 서비스 책임
    keyword:   utils.toStringOrEmpty(params.keyword),
  };
  // ③ 비즈니스 규칙 위반: throw new ValidationError('메시지')
  // ④ DB 에러: catch 없이 상위로 throw (asyncHandler → errorHandler가 처리)
  return await itemQuery.findItems(conn, queryParams);
};
```

- 쿼리 함수 내부의 인라인 형변환(`String(params.x ?? '')`) 금지 — 정규화는 여기서 끝낸다.

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

- 롤백 시 부수 자원(업로드된 파일 등)도 함께 정리한다.
- 채번(일련번호)은 트랜잭션 내 재산정 + UNIQUE 제약 + 중복 키 재시도.

## 5. 신뢰값 주입 (STRICT)

- 스코프 값(테넌트/회사 ID)·행위자 값(`created_by`/`updated_by`)·권한 판단 재료는 **클라이언트 전송값을 무시하고 `req.user`(토큰 검증값)로 강제 주입**한다. 인증 미들웨어 직후 단일 지점에서 덮어쓰는 방식이 누락이 없다 (근거: LTMS SEC-01/SEC-18/SEC-19).
- 소유권/배정 비교도 클라 전송값이 아니라 `req.user.id` 기준. `null == null` 거짓 통과 방지를 위해 양쪽 null 가드 필수.
- 관리자/설정 엔드포인트는 로그인 여부(`authenticateToken`)만으로 부족 — `requireRole`/`requirePermission` 같은 권한 게이트를 반드시 부착한다 (근거: LTMS SEC-02 — 정의만 있고 미적용이라 일반 사용자가 관리 API 호출 가능했음).

## 6. 기타

- MariaDB/MySQL 드라이버가 BigInt를 반환하는 값(count, affectedRows, insertId)은 `Number()` 변환 후 사용 (근거: LTMS #34 — BigInt 직렬화 오류).
- 환경변수 시크릿/내부 주소에 하드코딩 폴백 금지 — 미설정 시 부팅 실패 (patterns.md 4절).
- 소프트삭제·쿼리 스타일은 `sql.md` 참조.
