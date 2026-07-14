# 구현 패턴 — React 클라이언트 (JYP)

실무에서 검증된 React 구현 패턴. `patterns.md`(언어 무관)를 전제로 한다.

## 0. 언어 (신규 프로젝트)

- **신규 React 프로젝트는 TypeScript(`.tsx`) 기본**, `tsconfig.json`은 `strict: true` 고정. JavaScript(JSX)는 사용자가 명시적으로 요청할 때만 (근거: 응답 키 계약·props 문서화·`??` vs `||` 같은 STRICT 규칙의 상당수가 타입으로 컴파일 타임에 강제되어 규칙 의존이 줄어듦 — 2026-07-11 확정).
- `any` 사용 금지 — 타입을 모르면 `unknown`으로 받아 좁혀서 사용. 외부 데이터(API 응답)는 타입 선언만으로 보장되지 않으므로 경계 검증(patterns.md 4절)은 여전히 적용.
- props 타입은 `interface`로 선언 — 타입 선언이 JSDoc `@param`의 역할을 대신한다 (설명이 더 필요한 prop만 주석 보강).
- 기존 JSX 프로젝트는 전환하지 않는다 — 현행 유지.

## 1. 구조와 네이밍

```
src/
├── features/{module}/{feature}/
│   ├── pages/        # CtRequestRead.tsx (PascalCase — 모듈+기능+동작)
│   ├── hooks/        # useCtRequestApi.ts 등 역할별 훅 (camelCase)
│   ├── constants/    # ctRequestRead.constants.ts (컬럼 정의 등)
│   └── components/   # 화면 구성 섹션 컴포넌트 (PascalCase)
└── shared/
    ├── contexts/     # 인증, 공통코드, 다이얼로그 등 전역 컨텍스트
    ├── hooks/        # 공용 훅
    ├── components/   # 공용 컴포넌트
    └── utils/
```

**네이밍 (React 생태계 표준 — 2026-07-11 PascalCase로 확정)**:

| 대상 | 패턴 | 예시 |
|---|---|---|
| 컴포넌트/페이지 파일 | PascalCase, 언더스코어 없음 | `CtRequestRead.tsx`, `CtRequestSearchForm.tsx` |
| 훅 파일 | camelCase, `use` 접두사 | `useCtRequestApi.ts`, `useCtCreateForm.ts` |
| 상수 파일 | camelCase + `.constants.ts` | `ctRequestRead.constants.ts` |
| 유틸/일반 모듈 | camelCase | `printDocument.ts`, `dateUtils.ts` |
| 폴더 | 소문자 camelCase | `features/ct/request/` |

- 파일명에 모듈 접두사(`Ct`, `Internal` 등)는 유지한다 — 폴더 밖에서도 검색·식별이 쉽도록 (구 언더스코어 컨벤션의 grep 편의성 보존).
- 컴포넌트 이름과 파일명은 일치시킨다 (`CtRequestRead.tsx` → `export default function CtRequestRead()`).
- **기존 프로젝트는 그 프로젝트의 기존 네이밍 컨벤션 유지** — 한 코드베이스 안에서 두 스타일 혼용이 최악이다. 신규 프로젝트부터 적용.

모듈(도메인) 단위로 묶고, 화면 로직은 **역할별 훅으로 분리**한다: API 훅(`use*Api`) / 폼 상태(`use*Form`) / 검증(`use*Validation`) / 검색·필터(`use*Search`). 페이지 컴포넌트는 훅 조립과 레이아웃만.

## 2. 권한 게이트

- **역할 capability**(이 역할이 애초에 못 하는 동작)는 **조건부 렌더로 숨김**: `{canCreate && <button>}`. 없는 기능을 보여줘서 눌렀다 거부당하는 UX를 피한다.
- **상태 때문에 막힘**(완료 건이라 수정 불가, 본인 차례 아님)은 **`disabled` + 이유(툴팁/문구)**. 숨기면 "버튼이 어디 갔지?" 혼란이 생긴다.
- ⚠ 어느 쪽이든 UI는 보안이 아니다 — 서버가 동일 권한 코드로 최종 차단 (`patterns.md` 4절).

## 3. API 호출 (STRICT)

```jsx
// ❌ const res = await axios.post(url, params); if (res.status === 200) { ...성공... }
// ✅ try 성공 / catch 실패 — axios는 비-2xx에서 throw
try {
  await axios.post(url, params);   // 2xx(200/201/204) 통과 = 성공
  await showAlert({ message: '저장되었습니다.', icon: 'success' });
  refetch();
} catch (err) {
  await showAlert({ message: err.response?.data?.message || '저장 실패', icon: 'error' });
}
```

- `status === 200` 단독 비교 금지 (근거: 생성 응답은 201이라 신규 등록이 실패 처리되는 버그 반복).
- 기존값 보존 병합에는 `||` 대신 `??` — 빈 문자열 `""`도 유효한 입력값이다 (근거: `||`는 빈 문자열을 falsy 처리해 사용자가 지운 입력이 기존값으로 되돌아가는 버그를 만든다).

## 4. 목록 화면

- **페이지가 `<tbody>`를 소유**하고 `{loading ? <Loading> : empty ? <빈행> : data.map(<TableRow>)}` 분기. `TableRow`는 **단일 item의 행만 렌더하는 순수 컴포넌트**(React.memo 효율 + 책임 분리).
- key/prop에 배열 index 사용 금지 — React.memo가 무력화된다. 안정적 rowKey(`row.id ?? 'new-' + row.sort_order`) 사용.
- 검색 입력은 디바운스(300ms) 필수. **즉시상태(입력값)는 페이지가 아니라 툴바 같은 가벼운 컴포넌트 내부**에 둔다 — 페이지에 두면 키 입력마다 무거운 화면 전체가 리렌더되어 타이핑 렉이 발생한다. input을 디바운스 결과값에 바인딩하는 것도 금지(글자가 늦게 표시됨).
- 조회 화면의 검색 상태는 URL 쿼리를 단일 출처로 (뒤로가기/새로고침/링크 공유 보존).

## 5. 공통 UI 규칙

- 네이티브 `window.confirm`/`alert`/`prompt` 금지 — 공용 다이얼로그(`showAlert`/`showConfirm`) 사용 (UI 일관성).
- 평문 "로딩 중..." 텍스트 금지 — 공용 `<Loading>` 컴포넌트 사용.
- render 중 다이얼로그 등 상태 변경 side-effect 직접 호출 금지 — 이벤트 핸들러나 effect에서만 (render 중 상태 변경은 React 경고·무한 리렌더의 원인).
- **신규 프로젝트의 스타일링·테마·UX 규칙은 `design.md`를 따른다** (Tailwind + shadcn/ui 표준, 시맨틱 토큰, 업무/서비스 두 모드). 기존 프로젝트는 그 프로젝트의 기존 CSS 정책을 유지하고, 신규 keyframe·클래스에 모듈 접두사를 붙여 충돌을 방지한다. 새 창(window.open) 렌더링 컴포넌트는 전역 CSS가 적용되지 않으므로 컴포넌트 내부 `<style>` 삽입 패턴 사용.

## 6. 성능

- 무거운 외부 라이브러리(에디터, 차트 등)는 지연 로드(dynamic import).
- 같은 계산을 여러 곳에서 반복하면 `useMemo`, 자식에 내려주는 콜백은 `useCallback` — 단, 측정 없이 기계적으로 붙이지 않는다(리렌더 문제가 실재할 때).

## 7. API 클라이언트 (공통 인스턴스 + 인터셉터, STRICT)

auth.md 3절(access 메모리 + refresh httpOnly 쿠키)의 클라이언트 구현 규칙.

- API 클라이언트 인스턴스는 **프로젝트에 하나** — 화면/훅에서 `axios`를 직접 import하지 않고 공용 인스턴스(`shared/api/client.ts`)만 사용한다.
- **`baseURL`은 상대 경로 `/api` 고정 (STRICT)** — `http://localhost:3000` 같은 절대 주소나 `VITE_API_URL` 환경변수 금지 (근거: 클라이언트는 자신이 서빙된 출처로만 호출해야 동일 출처가 유지된다 — 라우팅은 로컬 Vite `server.proxy`, 배포는 프록시가 담당(docker.md 7절). 절대 주소를 쓰는 순간 CORS와 환경별 빌드가 되살아난다). 프록시 뒤가 아닌 특수 클라이언트(모바일 앱 등)만 예외로 하고 CLAUDE.md에 기록.
- **요청 인터셉터**: 메모리에 보관된 access token을 `Authorization: Bearer`로 자동 첨부. 개별 호출 지점에서 헤더를 수동으로 붙이지 않는다.
- **응답 인터셉터 (401 처리)**: 401 수신 시 refresh 엔드포인트로 재발급 → 원 요청 **1회만** 재시도. 실패하면 메모리 토큰 정리 + 로그인 화면 이동.
  - 무한루프 가드 필수: 재시도 플래그를 요청에 표시하고, **refresh 요청 자체의 401은 재시도 금지**.
  - 동시에 여러 요청이 401을 받으면 refresh는 **한 번만** 수행한다 (진행 중인 refresh Promise를 공유하고 나머지는 대기).
- 에러 메시지 추출(`err.response?.data?.message` 접근)은 단일 유틸 함수로 통일한다 — 호출 지점마다 접근식을 복제하지 않는다 (SSOT).

## 8. 라우팅·인증 가드

- 경로는 소문자 kebab-case, 리소스 중심: `/ct/requests`, `/settings/users`. 화면 추가 시 경로 체계를 프로젝트 CLAUDE.md에 누적 기록.
- **인증 가드**: 보호가 필요한 라우트 전체를 보호 레이아웃(ProtectedRoute) 아래에 둔다 — 미로그인 시 로그인 화면으로 리다이렉트하고, 로그인 성공 후 원래 목적지로 복귀(returnUrl 보존).
- **권한 가드**: 접근 권한이 없는 라우트는 **403 안내 화면**을 보여준다 (빈 화면·무한 로딩 금지). 존재하지 않는 경로는 404 화면. UI 가드는 UX일 뿐 — 서버가 같은 권한으로 최종 차단한다 (auth.md 4절).
- 조회 화면의 검색·필터 상태는 URL 쿼리를 단일 출처로 (4절과 동일 원칙 — 새로고침·뒤로가기·링크 공유 보존).
