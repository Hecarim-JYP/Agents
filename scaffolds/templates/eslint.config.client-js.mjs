// client/eslint.config.mjs — 컨벤션을 자동 강제하는 린트 설정 (React + JavaScript)
// TS 프로젝트는 eslint.config.client.mjs를 쓴다 (언어는 체크리스트 1 — react.md 0절).
// TS 전용 규칙(any 금지)만 빠지고 나머지 강제는 동일하다.
// 필요 패키지 (⚠ eslint와 @eslint/js의 메이저를 맞춘다 — 안 맞추면 ERESOLVE로 설치가 깨진다):
//   npm i -D eslint@9 @eslint/js@9 eslint-plugin-react-hooks eslint-plugin-import globals
// package.json:  "lint": "eslint ."   (훅과 CI가 이 스크립트를 실행한다)

import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import importPlugin from 'eslint-plugin-import';
import globals from 'globals';

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },   // JSX 파싱 — 아래 JSXAttribute 셀렉터의 전제
    },
    plugins: { 'react-hooks': reactHooks, import: importPlugin },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // general.md 3절 — 순환 의존 금지
      'import/no-cycle': 'error',

      // react.md 7절 — axios 직접 import 금지, 공용 인스턴스만 사용
      'no-restricted-imports': ['error', {
        paths: [{
          name: 'axios',
          message: 'axios를 직접 import하지 않는다 — 공용 인스턴스(shared/api/client)를 사용한다 (react.md 7절).',
        }],
      }],

      'no-restricted-syntax': [
        'error',
        {
          // react.md 3절 — 생성 응답은 201이라 === 200 단독 비교는 신규 등록을 실패 처리한다
          selector: "BinaryExpression[operator='==='][right.value=200]",
          message: 'status === 200 단독 비교 금지 — 2xx 범위 또는 try/catch로 판정한다 (react.md 3절).',
        },
        {
          // design.md 2절 — 색상은 시맨틱 토큰만 (다크모드·브랜드 변경 대응)
          selector: "JSXAttribute[name.name='className'] Literal[value=/(bg|text|border|ring)-\\[#/]",
          message: '임의 hex 색상 금지 — 시맨틱 토큰(bg-primary 등)만 사용한다 (design.md 2절).',
        },
        {
          selector: "JSXAttribute[name.name='className'] Literal[value=/(bg|text|border|ring)-(red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-[0-9]/]",
          message: '팔레트 색상 직접 지정 금지 — 시맨틱 토큰(bg-primary, text-muted-foreground 등)만 사용한다 (design.md 2절).',
        },
        {
          // react.md 5절 — 공용 다이얼로그 사용 (UI 일관성)
          selector: "CallExpression[callee.name=/^(alert|confirm|prompt)$/]",
          message: '네이티브 alert/confirm/prompt 금지 — 공용 다이얼로그(showAlert/showConfirm)를 사용한다 (react.md 5절).',
        },
        {
          // auth.md 3절 — 토큰을 스토리지에 저장하면 XSS 한 번에 탈취된다
          selector: "CallExpression[callee.object.name=/^(localStorage|sessionStorage)$/][callee.property.name='setItem'] > Literal[value=/token|jwt|auth/i]",
          message: '토큰을 localStorage/sessionStorage에 저장 금지 — access는 메모리, refresh는 httpOnly 쿠키 (auth.md 3절). UI 선호값(locale·theme) 저장은 허용.',
        },
      ],
    },
  },
  {
    // 공용 API 클라이언트만 axios를 직접 import할 수 있다
    files: ['**/shared/api/**'],
    rules: { 'no-restricted-imports': 'off' },
  },
];
