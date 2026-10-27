// server/eslint.config.mjs — 컨벤션을 자동 강제하는 린트 설정 (Node/Express + TypeScript)
// 필요 패키지 (⚠ eslint와 @eslint/js의 메이저를 맞춘다 — 안 맞추면 ERESOLVE로 설치가 깨진다):
//   npm i -D eslint@10 @eslint/js@10 typescript-eslint eslint-plugin-import-x globals eslint-import-resolver-typescript
// ⚠ import 규칙은 eslint-plugin-import-x를 쓴다 — eslint-plugin-import(2.32, 2025-06 이후 출시 없음)는 ESLint 10을 지원하지 않고(peer ~^9),
//   ESLint 9는 2026-08-06 지원 종료(eslint.org version-support)라 9에 묶어 둘 수 없다 (2026-10-21 확인)
// ⚠ TypeScript는 6.0.x로 고정한다 (npm i -D typescript@~6.0.3) — typescript-eslint가 아직 TS 7을 지원하지 않아(peer <6.1.0)
//   최신 Vite 템플릿(TS 7)·`npm i -D typescript`(7.x) 그대로면 위 설치가 ERESOLVE로 깨진다 (2026-10-19 실측)
// package.json:  "lint": "eslint ."   (훅과 CI가 이 스크립트를 실행한다)

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { importX, createNodeResolver } from 'eslint-plugin-import-x';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: { globals: globals.node },
    // import-x/no-cycle이 실제로 돌게 하는 설정 (2026-10-21 실측 — parsers가 없으면 TS 파일을 못 읽어 순환을 하나도 못 잡는다):
    // TS 파서로 의존 파일을 읽고, typescript 리졸버로 확장자 없는 경로·'.js'로 쓴 TS 경로·tsconfig paths 별칭(@/)까지 따라간다
    settings: {
      'import-x/parsers': { '@typescript-eslint/parser': ['.ts', '.tsx'] },
      'import-x/resolver-next': [createTypeScriptImportResolver(), createNodeResolver()],
    },
    plugins: { 'import-x': importX },
    rules: {
      // express.md 0절 — any 금지, 모르면 unknown으로 좁혀 쓴다
      '@typescript-eslint/no-explicit-any': 'error',

      // patterns.md 1절 — 계층 단방향 (순환 의존 금지)
      'import-x/no-cycle': 'error',

      'no-restricted-syntax': [
        'error',
        {
          // patterns.md 4절 — 시크릿·내부 주소에 하드코딩 폴백 금지 (미설정이면 기동 실패로 드러나야 한다)
          // 잡는 형태: ① process.env.X || 값 · ?? 값  ② 변환을 거친 Number(process.env.X) || 50000 · process.env.X?.split(',') ?? [...]
          // — 오른쪽이 리터럴일 때만(isOn(process.env.FLAG) || force 같은 조건끼리의 ||는 폴백이 아니다)  ③ 구조 분해 기본값
          // const { PORT = 3000 } = process.env (2026-10-27 — ①만 잡아 ②③ 폴백이 오류 없이 통과했다)
          // ⚠ lint 0 ≠ 폴백 0: 변수에 옮긴 뒤의 삼항(Number.isFinite(t) ? t : 300000)·함수 기본 인자(fallback = 60_000)는 못 잡는다 — 리뷰에서 본다
          selector: [
            "LogicalExpression[operator=/^(\\|\\||\\?\\?)$/][left.object.object.name='process'][left.object.property.name='env']",
            "LogicalExpression[operator=/^(\\|\\||\\?\\?)$/][right.type=/^(Literal|ArrayExpression|ObjectExpression|TemplateLiteral|UnaryExpression)$/] > :matches(CallExpression, ChainExpression).left:has(MemberExpression[object.object.name='process'][object.property.name='env'])",
            "VariableDeclarator[init.object.name='process'][init.property.name='env'] > ObjectPattern > Property > AssignmentPattern",
          ].join(', '),
          message: '환경변수에 하드코딩 폴백 금지 — 미설정이면 기동 실패로 즉시 드러나게 한다 (patterns.md 4절).',
        },
        {
          // ops.md 3절 — 에러 로그에는 맥락이 필요하다 (무슨 작업·어떤 입력·어느 요청인지)
          selector: "CallExpression[callee.object.name='console'][callee.property.name='error'][arguments.length=1]",
          message: 'console.error(err) 한 줄 금지 — 맥락(작업·입력·요청 ID)을 함께 로깅한다 (ops.md 3절).',
        },
        {
          // sql.md 7절 — 문자열 연결로 쿼리를 조립하지 않는다 (인젝션)
          // 요청 값(params.x · queryParams.x · body.x · query.x · req.*.x)을 SQL 문자열에 직접 끼운 경우만 잡는다 — 코드에 고정된
          // 조건절 조각·자리표시 목록(`${cond ? 'AND k = :k' : ''}` · `IN (:id_0, …)`)은 정상 설계라 잡지 않는다.
          // SQL 단어는 모든 글자 조각에서, 절 단어(AND·LIKE·ORDER BY …)까지 찾는다 — 첫 조각의 문장 단어만 보면 `${}`가 앞에 오는
          // 문자열과 조건절 조각에 넣은 값을 놓친다. 대문자만 본다(sql.md 1절) — 영문 로그·화면 주소(`?mode=update`)는 거른다.
          // (2026-10-27 — 이전 선택자는 기존 프로젝트에서 정상 코드 81건을 잡고 위 두 형태를 놓쳤다)
          // ⚠ 못 잡는다: 지역 변수로 옮긴 값(`const { keyword } = params`)·소문자 SQL·요청 키로 만든 컬럼 목록 — 리뷰에서 본다
          selector:
            'TemplateLiteral:has(TemplateElement[value.raw=/\\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|AND|OR|LIKE|IN|SET|VALUES|ORDER BY|GROUP BY|HAVING|LIMIT|OFFSET|JOIN|ON)\\b/])' +
            ' > MemberExpression:matches([object.name=/^(params|queryParams|body|query)$/], [object.object.name="req"])',
          message: 'SQL에 요청 값 직접 보간 금지 — 값은 바인딩 파라미터로, 컬럼·정렬 방향은 허용 목록에서 골라 넣는다 (sql.md 7절).',
        },
      ],
    },
  },
  {
    // 마이그레이션 러너·스크립트는 SQL 문자열 조립 제약에서 제외 (파일 내용을 그대로 실행)
    files: ['scripts/**', 'src/migrate/**'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    // 설정·테스트 준비 파일(vitest.config.mjs, test/setup/*.mjs)은 JS다 — Node 전역을 주지 않으면
    // 'process is not defined'로 lint가 실패한다 (2026-10-27 실측)
    files: ['**/*.{js,mjs}'],
    languageOptions: { globals: globals.node },
  },
);
