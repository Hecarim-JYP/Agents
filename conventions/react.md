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
