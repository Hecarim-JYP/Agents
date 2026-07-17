// server/eslint.config.mjs — 컨벤션을 자동 강제하는 린트 설정 (Node/Express + JavaScript)
// TS 프로젝트는 eslint.config.server.mjs를 쓴다 (언어는 체크리스트 1 — express.md 0절).
// TS 전용 규칙(any 금지)만 빠지고 나머지 강제는 동일하다.
// 필요 패키지 (⚠ eslint와 @eslint/js의 메이저를 맞춘다 — 안 맞추면 ERESOLVE로 설치가 깨진다):
//   npm i -D eslint@9 @eslint/js@9 eslint-plugin-import globals
// package.json:  "lint": "eslint ."   (훅과 CI가 이 스크립트를 실행한다)

import js from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import globals from 'globals';

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: { globals: globals.node },
    plugins: { import: importPlugin },
    rules: {
      // patterns.md 1절 — 계층 단방향 (순환 의존 금지)
      'import/no-cycle': 'error',

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
];
