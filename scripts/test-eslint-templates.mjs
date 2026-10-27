// ESLint 템플릿 검사 — scaffolds/templates/eslint.config.*.mjs를 실제 ESLint로 돌려, 규칙마다 위반 코드는 걸리고 정상 코드는 아무것도 안 걸리는지 본다.
// 선택자(no-restricted-syntax)·리졸버 설정은 틀려도 오류 없이 아무것도 잡지 않는다 — 사람이 매번 확인하는 대신 여기서 막는다
// (2026-10-19: import-x/no-cycle이 설정 누락으로 TS에서 3개월간 꺼져 있었다 / 2026-10-27: SQL 보간 선택자가 정상 코드를 대량으로 잡고 위반 두 형태를 놓쳤다).
// 설치할 패키지는 각 템플릿 머리 주석의 `npm i -D` 줄에서 읽는다 — 주석의 설치 명령이 실제로 설치되는지(ERESOLVE)도 같이 본다.
//
// 사용법: 저장소 루트에서  node scripts/test-eslint-templates.mjs [--modules <이미 설치된 node_modules — 설치를 건너뛴다>]
//         (CI verify.yml이 push/PR마다 실행)

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tplDir = path.join(repo, 'scaffolds', 'templates');
const args = process.argv.slice(2);
const modules = args.includes('--modules') ? path.resolve(args[args.indexOf('--modules') + 1]) : null;

// ── 사례: [파일, 코드, 걸려야 하는 것(메시지 일부 또는 ruleId) — 빈 배열이면 어떤 규칙에도 안 걸려야 한다] ──
const SQL = 'SQL에 요청 값';
const ENV = '환경변수에 하드코딩 폴백';
const sqlCases = (x) => [
  // 위험 — 요청 값을 SQL에 직접 끼움
  [`src/sql-like.${x}`, "export const f = (params) => `SELECT * FROM t WHERE name LIKE '%${params.keyword}%'`;", [SQL]],
  [`src/sql-req-body.${x}`, 'export const f = (req) => `\n  /* x */ UPDATE t SET v = ${req.body.v}`;', [SQL]],
  [`src/sql-req-query.${x}`, 'export const f = (req) => `SELECT * FROM t WHERE id = ${req.query.id}`;', [SQL]],
  [`src/sql-destructured.${x}`, "export const f = ({ body }) => `INSERT INTO t (a) VALUES ('${body.a}')`;", [SQL]],
  [`src/sql-before-word.${x}`, 'export const f = (queryParams) => `/* c */ ${queryParams.order} DELETE FROM t`;', [SQL]],   // `${}`가 SQL 단어보다 앞
  [`src/sql-clause-append.${x}`, "export const f = (params) => { let q = 'SELECT * FROM t WHERE 1 = 1'; q += ` AND name LIKE '%${params.keyword}%'`; return q; };", [SQL]],
  [`src/sql-clause-nested.${x}`, "export const f = (params) => `SELECT * FROM t WHERE 1 = 1 ${params.k ? `AND k = '${params.k}'` : ''}`;", [SQL]],
  [`src/sql-order-by.${x}`, 'export const f = (params) => `SELECT * FROM t ORDER BY ${params.sort}`;', [SQL]],
  [`src/sql-query-fn.${x}`, 'export const f = async (conn, params) => {\n  const query = `\n    /* f : 목록 */\n    SELECT i.id\n    FROM item AS i\n    WHERE i.company_id = ${params.company_id}\n  `;\n  return conn.query(query, params);\n};', [SQL]],
  // 안전 — 코드에 고정된 조각·자리표시·허용 목록·SQL이 아닌 문자열
  [`src/sql-ok-cond.${x}`, "export const f = (params) => `SELECT * FROM t WHERE 1 = 1 ${params.k ? 'AND k = :k' : ''}`;", []],
  [`src/sql-ok-in.${x}`, "export const f = (ids) => `SELECT * FROM t WHERE id IN (${ids.map((_, i) => `:id_${i}`).join(',')})`;", []],
  [`src/sql-ok-rows.${x}`, "export const f = (rows) => `INSERT INTO t (a, b) VALUES ${rows.map((_, i) => `(:a_${i}, :b_${i})`).join(', ')}`;", []],
  [`src/sql-ok-sort.${x}`, "const SORT = { name: 'i.name', date: 'i.created_at' };\nexport const f = (params) => `SELECT * FROM item AS i ORDER BY ${SORT[params.sort] ?? 'i.id'}`;", []],
  [`src/sql-ok-limit.${x}`, 'export const f = (params) => { const limit = Math.min(Number(params.limit) || 20, 100); return `SELECT * FROM t LIMIT ${limit}`; };', []],
  [`src/sql-ok-column.${x}`, 'export const f = (col) => `SELECT * FROM t WHERE ${col} >= :date_from`;', []],
  [`src/sql-ok-log.${x}`, 'export const f = (logger, params) => logger.warn(`[x] company ${params.company_id} has no data from ERP and will retry`);', []],
  [`src/sql-ok-url.${x}`, 'export const f = (params) => `/ct/request/create?mode=update&ct_request_id=${params.id}`;', []],
  [`src/sql-ok-message.${x}`, 'export const f = (params) => `상품 ${params.name}을(를) 찾을 수 없습니다`;', []],
  // 알려진 한계 — 템플릿 주석의 ⚠와 같다. 잡게 되면 주석·이 사례를 함께 고친다
  [`src/sql-limit-local.${x}`, "export const f = (params) => { const { keyword } = params; return `SELECT * FROM t WHERE name LIKE '%${keyword}%'`; };", []],
  [`src/sql-limit-lower.${x}`, 'export const f = (params) => `select * from t where id = ${params.id}`;', []],
  // 마이그레이션 러너·스크립트는 예외
  [`scripts/migrate.${x}`, 'export const f = (params) => `DELETE FROM t WHERE id = ${params.id}`;', []],
];
const serverCases = (x) => [
  ...sqlCases(x),
  // 환경변수 폴백 — 그대로·변환을 거친 것·구조 분해 기본값
  [`src/env-or.${x}`, "export const url = process.env.DB_URL || 'mysql://localhost';", [ENV]],
  [`src/env-nullish.${x}`, "export const url = process.env.DB_URL ?? 'mysql://localhost';", [ENV]],
  [`src/env-computed.${x}`, "export const url = process.env['DB_URL'] || 'mysql://localhost';", [ENV]],
  [`src/env-number.${x}`, 'export const max = Number(process.env.CACHE_MAX_ENTRIES) || 50000;', [ENV]],
  [`src/env-parseint.${x}`, 'export const port = parseInt(process.env.PORT, 10) || 3000;', [ENV]],
  [`src/env-chain.${x}`, "export const origins = process.env.ORIGINS?.split(',') ?? ['http://localhost:5173'];", [ENV]],
  [`src/env-method.${x}`, "export const api = process.env.API_URL.trim() || 'http://internal:8080';", [ENV]],
  [`src/env-destructure.${x}`, 'export const { PORT = 3000 } = process.env;', [ENV]],
  [`src/env-destructure-rename.${x}`, "const { DB_HOST: host = 'localhost' } = process.env;\nexport { host };", [ENV]],
  [`src/env-ok.${x}`, 'export const url = process.env.DB_URL;', []],
  [`src/env-ok-number.${x}`, 'export const port = Number(process.env.PORT);', []],
  [`src/env-ok-destructure.${x}`, 'export const { PORT } = process.env;', []],
  [`src/env-ok-condition.${x}`, "const isOn = (v) => v === '1';\nexport const f = (force) => isOn(process.env.FEATURE_X) || force;", []],   // 조건끼리의 ||
  [`src/env-ok-compare.${x}`, "export const f = (isTest) => process.env.NODE_ENV === 'production' || isTest;", []],
  [`src/env-ok-other.${x}`, 'export const f = (cfg) => Number(cfg.timeout) || 3000;', []],
  // 알려진 한계 — 템플릿 주석의 ⚠("lint 0 ≠ 폴백 0")와 같다
  [`src/env-limit-ternary.${x}`, 'const t = Number(process.env.TTL);\nexport const ttl = Number.isFinite(t) ? t : 300000;', []],
  [`src/env-limit-default.${x}`, 'export const parse = (raw, fallback = 60_000) => Number(raw) || fallback;', []],
  [`src/log-bare.${x}`, 'export const f = (err) => console.error(err);', ['console.error(err)']],
  [`src/log-ok.${x}`, "export const f = (err, id) => console.error('[order] 저장 실패', { id, err });", []],
  // 순환 — 확장자를 붙인 ESM 경로(TS는 '.js'로 쓴 TS 경로)를 따라가야 잡힌다
  [`src/cyc-a.${x}`, "import { b } from './cyc-b.js';\nexport const a = () => b();", ['import-x/no-cycle']],
  [`src/cyc-b.${x}`, "import { a } from './cyc-a.js';\nexport const b = () => a;", ['import-x/no-cycle']],
  // 설정·테스트 준비 파일(.mjs)에 Node 전역 — 없으면 'process is not defined'
  ['vitest.config.mjs', 'export default { test: { env: { A: process.env.A } } };', []],
];
const clientCases = (x) => [
  [`src/status-bad.${x}`, 'export const ok = (r) => r.status === 200;', ['status === 200']],
  [`src/status-ok.${x}`, 'export const ok = (r) => r.status >= 200 && r.status < 300;', []],
  [`src/color-hex.${x}`, 'export const A = () => <div className="bg-[#ff0000] p-2" />;', ['임의 hex']],
  [`src/color-palette.${x}`, 'export const A = () => <div className="text-red-500" />;', ['팔레트 색상']],
  [`src/color-ok.${x}`, 'export const A = () => <div className="bg-primary text-muted-foreground" />;', []],
  [`src/alert-bad.${x}`, "export const f = () => alert('저장했습니다');", ['네이티브 alert']],
  [`src/alert-ok.${x}`, "export const f = (showAlert) => showAlert('저장했습니다');", []],
  [`src/token-bad.${x}`, "export const f = (t) => localStorage.setItem('accessToken', t);", ['토큰을 localStorage']],
  [`src/token-ok.${x}`, "export const f = () => localStorage.setItem('theme', 'dark');", []],
  [`src/features/order/api.${x}`, "import axios from 'axios';\nexport const get = () => axios.get('/x');", ['axios를 직접']],
  [`src/shared/api/client.${x}`, "import axios from 'axios';\nexport const get = () => axios.get('/x');", []],
  [`src/hooks-bad.${x}`, "import { useState } from 'react';\nexport function C({ on }) { if (on) { useState(0); } return null; }", ['react-hooks/rules-of-hooks']],
  // 순환 — 확장자 없는 경로를 따라가야 잡힌다
  [`src/cyc-a.${x}`, "import { b } from './cyc-b';\nexport const a = () => b();", ['import-x/no-cycle']],
  [`src/cyc-b.${x}`, "import { a } from './cyc-a';\nexport const b = () => a;", ['import-x/no-cycle']],
];
const anyCase = (x) => [[`src/any.${x}`, 'export const f = (x: any) => x;', ['@typescript-eslint/no-explicit-any']]];
const TSCONFIG_SERVER = { compilerOptions: { strict: true, module: 'nodenext', moduleResolution: 'nodenext' }, include: ['**/*'] };
const TSCONFIG_CLIENT = { compilerOptions: { strict: true, module: 'esnext', moduleResolution: 'bundler', jsx: 'react-jsx' }, include: ['**/*'] };
const TEMPLATES = [
  ['eslint.config.server-js.mjs', serverCases('js')],
  ['eslint.config.server.mjs', [...serverCases('ts'), ...anyCase('ts')], TSCONFIG_SERVER],
  ['eslint.config.client-js.mjs', clientCases('jsx')],
  ['eslint.config.client.mjs', [...clientCases('tsx'), ...anyCase('tsx')], TSCONFIG_CLIENT],
];

let failed = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};

const work = mkdtempSync(path.join(tmpdir(), 'jyp-eslint-test-'));
try {
  // ── 패키지 설치 — 템플릿 주석의 설치 명령 그대로 (같은 패키지가 여러 템플릿에 있으면 버전을 적은 쪽) ──
  const specs = new Map();
  for (const [name] of TEMPLATES) {
    for (const m of readFileSync(path.join(tplDir, name), 'utf8').matchAll(/npm i -D((?: [@\w][\w@./~^-]*)+)(?=[\s)]|$)/gm)) {
      for (const spec of m[1].trim().split(' ')) {
        const pkg = spec.replace(/(?<=.)@.*$/, '');
        if (!specs.has(pkg) || spec !== pkg) specs.set(pkg, spec);
      }
    }
  }
  writeFileSync(path.join(work, 'package.json'), '{ "private": true }\n');
  if (modules) {
    symlinkSync(modules, path.join(work, 'node_modules'), 'junction');
  } else {
    console.log(`설치: ${[...specs.values()].join(' ')}`);
    const npm = spawnSync('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error', ...specs.values()], { cwd: work, encoding: 'utf8', shell: process.platform === 'win32' });
    if (npm.status !== 0) throw new Error(`템플릿 주석의 설치 명령이 실패했다:\n${npm.stdout}${npm.stderr}`);
  }
  // 템플릿마다 eslint CLI를 따로 띄운다 — 실제 프로젝트처럼 프로세스당 설정 하나 (한 프로세스에서 TS 설정 둘을 불러오면
  // typescript-eslint가 tsconfigRootDir 후보가 여럿이라며 파싱을 거부한다 — 시험 방식의 문제지 템플릿 결함이 아니다)
  const eslintPkg = createRequire(path.join(work, 'package.json')).resolve('eslint/package.json');
  const bin = path.join(path.dirname(eslintPkg), JSON.parse(readFileSync(eslintPkg, 'utf8')).bin.eslint);

  for (const [name, cases, tsconfig] of TEMPLATES) {
    console.log(name);
    const dir = path.join(work, name.replace(/\.mjs$/, ''));
    mkdirSync(dir);
    writeFileSync(path.join(dir, 'eslint.config.mjs'), readFileSync(path.join(tplDir, name)));
    if (tsconfig) writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify(tsconfig));
    for (const [file, code] of cases) {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      writeFileSync(path.join(dir, file), `${code}\n`);
    }
    const run = spawnSync(process.execPath, [bin, '--format', 'json', ...cases.map(([file]) => file)], { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    let results;
    try { results = JSON.parse(run.stdout); } catch { throw new Error(`${name} — ESLint가 결과를 내지 못했다(설정 로드 실패):\n${run.stdout}${run.stderr}`); }
    const byFile = new Map(results.map((r) => [path.relative(dir, r.filePath).split(path.sep).join('/'), r.messages]));
    for (const [file, , expect] of cases) {
      const messages = byFile.get(file) ?? [{ ruleId: null, message: 'lint 결과 없음 — 무시 대상이 됐다' }];
      // 걸린 것 하나하나가 기대 목록 중 하나여야 하고, 기대한 것은 모두 걸려야 한다 — 다른 규칙의 오탐도 실패로 본다
      const hits = messages.map((m) => expect.find((e) => m.ruleId === e || m.message.includes(e)) ?? `${m.ruleId ?? '파싱'}: ${m.message}`);
      const unexpected = hits.filter((h) => !expect.includes(h));
      const missing = expect.filter((e) => !hits.includes(e));
      check(`${file} → ${expect.length ? expect.join(', ') : '걸리지 않음'}`, !unexpected.length && !missing.length,
        [missing.length && `안 걸림: ${missing.join(', ')}`, unexpected.length && `예상 밖: ${unexpected.join(' / ')}`].filter(Boolean).join(' · '));
    }
  }
} catch (e) {
  console.log(`  ✗ 실행 실패 — ${e.message}`);
  failed++;
} finally {
  rmSync(work, { recursive: true, force: true });
}
console.log(failed ? `결과: 실패 ${failed}건` : '결과: 통과');
process.exit(failed ? 1 : 0);
