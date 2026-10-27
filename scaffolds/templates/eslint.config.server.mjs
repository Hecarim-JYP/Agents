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
          selector: "LogicalExpression[operator=/^(\\|\\||\\?\\?)$/][left.object.object.name='process'][left.object.property.name='env']",
          message: '환경변수에 하드코딩 폴백 금지 — 미설정이면 기동 실패로 즉시 드러나게 한다 (patterns.md 4절).',
        },
        {
          // ops.md 3절 — 에러 로그에는 맥락이 필요하다 (무슨 작업·어떤 입력·어느 요청인지)
          selector: "CallExpression[callee.object.name='console'][callee.property.name='error'][arguments.length=1]",
          message: 'console.error(err) 한 줄 금지 — 맥락(작업·입력·요청 ID)을 함께 로깅한다 (ops.md 3절).',
        },
        {
          // sql.md 7절 — 문자열 연결로 쿼리를 조립하지 않는다 (인젝션)
          selector: "TemplateLiteral[expressions.length>0][quasis.0.value.raw=/\\b(select|insert|update|delete)\\b/i]",
          message: 'SQL에 템플릿 리터럴 보간 금지 — 값은 항상 바인딩 파라미터로 전달한다 (sql.md 7절).',
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
