// 훅 동작 검사 — hooks/의 post-edit-check·stop-test를 표본 프로젝트에 실제로 돌려 판정·종료 코드·프로세스 정리를 확인한다.
// 저장소 CLAUDE.md의 훅 검증("깨진 코드로 exit 2, 정상 코드로 exit 0")과 시간 초과 처리(막지 않음 + 손자 프로세스까지 종료)를
// 사람의 수동 확인 대신 여기서 강제한다. (2026-10-27 — 시간 초과를 실패로 막고, 셸만 죽여 테스트가 뒤에서 계속 돌던 결함)
// 외부 의존성 없음 — ESLint는 받은 인자만 기록하는 가짜 패키지로 대신한다(어떤 인자로 불렸는지가 검사 대상이다).
// Gradle 경로(gradlew test·spotlessCheck)는 JDK·의존성 캐시가 필요해 여기서 다루지 않는다 — 변경 시 표본 프로젝트로 직접 확인한다.
//
// 사용법: 저장소 루트에서  node scripts/test-hooks.mjs   (CI verify.yml·verify-windows.yml이 push/PR마다 실행)

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(path.join(tmpdir(), 'jyp-hook-test-'));
const SHORT_MS = 4_000;   // 시험용 시간 한도 — 원본 상수(270초·170초)를 복사본에서만 줄인다

// 1) 훅 복사본 — 시간 한도만 줄인다. 상수 이름이 바뀌어 치환이 안 되면 시험이 무의미하므로 바로 실패한다
const hooksDir = path.join(work, 'hooks');
mkdirSync(hooksDir);
for (const f of readdirSync(path.join(repo, 'hooks')).filter((n) => n.endsWith('.mjs'))) copyFileSync(path.join(repo, 'hooks', f), path.join(hooksDir, f));
for (const f of ['stop-test.mjs', 'post-edit-check.mjs']) {
  const p = path.join(hooksDir, f);
  const src = readFileSync(p, 'utf8');
  const patched = src.replace(/^const TIMEOUT_MS = [\d_]+;/m, `const TIMEOUT_MS = ${SHORT_MS};`);
  if (patched === src) { console.error(`${f}: "const TIMEOUT_MS = ...;" 를 찾지 못했다 — 시험 스크립트를 함께 고친다`); process.exit(1); }
  writeFileSync(p, patched);
}

// 2) 표본 프로젝트
const write = (p, s) => { mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, s); };
const project = (name, pkg, files = {}) => {
  const dir = path.join(work, name);
  write(path.join(dir, 'package.json'), JSON.stringify({ name, private: true, ...pkg }));
  for (const [f, s] of Object.entries(files)) write(path.join(dir, f), s);
  return dir;
};
// 오래 도는 테스트·lint — 자신과 손자 프로세스의 PID를 남긴다. 시간 초과 뒤 둘 다 사라져야 한다
const SLOW = `
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
fs.writeFileSync(path.join(__dirname, 'pid-child.txt'), String(process.pid));
const g = spawn(process.execPath, ['-e', "require('fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)", path.join(__dirname, 'pid-grandchild.txt')], { stdio: 'inherit' });
setInterval(() => {}, 1000);
`;
const pass = project('test-pass', { scripts: { test: 'node t.cjs' } }, { 't.cjs': "require('fs').writeFileSync(__dirname + '/ran.txt', 'ran');" });
const fail = project('test-fail', { scripts: { test: 'node t.cjs' } }, { 't.cjs': "console.log('ASSERT_FAILED_MARKER'); process.exit(1);" });
const slow = project('test-slow', { scripts: { test: 'node t.cjs' } }, { 't.cjs': SLOW });
const FAKE_ESLINT = `
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(path.join(process.cwd(), 'calls.log'), JSON.stringify(args) + '\\n');
if (args.some((a) => a.endsWith('slow.js'))) { ${SLOW.replace(/__dirname/g, 'process.cwd()')} }
else if (args.some((a) => a.endsWith('bad.js'))) { console.log('BAD_LINT_MARKER'); process.exit(1); }
`;
const lint = project('lint-eslint', { scripts: { lint: 'eslint . --max-warnings 0' } }, {
  'node_modules/eslint/package.json': JSON.stringify({ name: 'eslint', version: '10.0.0', bin: { eslint: 'bin/eslint.js' } }),
  'node_modules/eslint/bin/eslint.js': FAKE_ESLINT,
  'src/good.js': 'export const a = 1;\n', 'src/bad.js': 'export const b = 1;\n', 'src/slow.js': 'export const c = 1;\n',
});
const lintOther = project('lint-other', { scripts: { lint: 'node lint-all.cjs' } }, {
  'lint-all.cjs': "require('fs').appendFileSync(__dirname + '/calls.log', 'FULL\\n');", 'src/x.js': 'export const x = 1;\n',
});

// 3) 실행·판정
let sid = 0;
const markerOf = (s) => path.join(tmpdir(), `claude-needs-test-${s}`);
const hook = (name, payload) => {
  const t = Date.now();
  const r = spawnSync(process.execPath, [path.join(hooksDir, name)], { input: JSON.stringify(payload), encoding: 'utf8', timeout: 60_000 });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '', ms: Date.now() - t };
};
const stop = (root, extra = {}) => {
  const s = `jyp-hook-test-${process.pid}-${++sid}`;
  if (root) writeFileSync(markerOf(s), root);
  return { ...hook('stop-test.mjs', { session_id: s, stop_hook_active: false, ...extra }), marker: markerOf(s) };
};
const edit = (file) => {
  const s = `jyp-hook-test-${process.pid}-${++sid}`;
  const r = hook('post-edit-check.mjs', { session_id: s, tool_input: { file_path: file } });
  const m = markerOf(s);
  const marked = existsSync(m) ? readFileSync(m, 'utf8') : null;
  rmSync(m, { force: true });
  return { ...r, marked };
};
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const pidsIn = (dir) => ['pid-child.txt', 'pid-grandchild.txt'].map((f) => path.join(dir, f)).filter(existsSync).map((f) => Number(readFileSync(f, 'utf8')));
// 기록이 없으면 빈 값 — 대조군(수정 전 훅)처럼 lint가 아예 다른 경로로 돌면 판정이 ✗로 남게 한다
const lastCall = (dir) => { const f = path.join(dir, 'calls.log'); return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').at(-1) : ''; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const systemMessage = (out) => { try { return JSON.parse(out.trim().split('\n').pop()).systemMessage ?? ''; } catch { return ''; } };

let failed = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};

try {
  console.log('stop-test');
  let r = stop(null);
  check('마커 없음 → 테스트 안 돌고 exit 0', r.code === 0 && !existsSync(path.join(pass, 'ran.txt')), `exit ${r.code}`);
  r = stop(pass, { stop_hook_active: true });
  check('stop_hook_active → 재실행 안 함', r.code === 0 && !existsSync(path.join(pass, 'ran.txt')), `exit ${r.code}`);
  rmSync(r.marker, { force: true });
  r = stop(pass);
  check('통과하는 테스트 → exit 0 + 마커 삭제', r.code === 0 && existsSync(path.join(pass, 'ran.txt')) && !existsSync(r.marker), `exit ${r.code} ${r.err}`);
  r = stop(fail);
  check('실패하는 테스트 → exit 2 + 실패 출력 전달', r.code === 2 && r.err.includes('ASSERT_FAILED_MARKER'), `exit ${r.code} ${r.err}`);
  r = stop(slow);
  await sleep(1_000);
  const sp = pidsIn(slow);
  check('시간 초과 → 막지 않음(exit 0)', r.code === 0, `exit ${r.code} ${r.err}`);
  check('시간 초과 → 사용자 경고(systemMessage)', systemMessage(r.out).includes('끝나지 않아'), r.out);
  check('시간 초과 → 테스트·손자 프로세스 모두 종료', sp.length === 2 && sp.every((p) => !alive(p)), `pid ${sp.map((p) => `${p}:${alive(p) ? '생존' : '종료'}`).join(' ')}`);
  check(`시간 초과 → 한도(${SHORT_MS / 1000}초) + 정리 유예 안에 끝남`, r.ms < SHORT_MS + 10_000, `${r.ms}ms`);

  console.log('post-edit-check');
  r = edit(path.join(lint, 'src', 'good.js'));
  const args = JSON.parse(lastCall(lint) || '[]');
  check('정상 파일 → exit 0 + 테스트 마커 기록', r.code === 0 && r.marked === lint, `exit ${r.code} ${r.err}`);
  check('lint는 편집한 파일만 (프로젝트 전체 "." 아님)', args.at(-1) === path.join(lint, 'src', 'good.js') && !args.includes('.'), JSON.stringify(args));
  check('lint 스크립트의 --max-warnings 유지 + --no-warn-ignored', args.join(' ').includes('--max-warnings 0') && args.includes('--no-warn-ignored'), JSON.stringify(args));
  r = edit(path.join(lint, 'src', 'bad.js'));
  check('lint 위반 → exit 2 + 위반 출력 전달', r.code === 2 && r.err.includes('BAD_LINT_MARKER'), `exit ${r.code} ${r.err}`);
  r = edit(path.join(lint, 'src', 'slow.js'));
  await sleep(1_000);
  const lp = pidsIn(lint);
  check('lint 시간 초과 → 막지 않음 + 사용자 경고', r.code === 0 && systemMessage(r.out).includes('끝나지 않아'), `exit ${r.code} ${r.out}`);
  check('lint 시간 초과 → lint·손자 프로세스 모두 종료', lp.length === 2 && lp.every((p) => !alive(p)), `pid ${lp.map((p) => `${p}:${alive(p) ? '생존' : '종료'}`).join(' ')}`);
  r = edit(path.join(lintOther, 'src', 'x.js'));
  check('ESLint가 아닌 lint 스크립트 → 기존처럼 스크립트 전체 실행', r.code === 0 && lastCall(lintOther) === 'FULL', `exit ${r.code} ${r.err}`);
  r = edit(path.join(lint, 'README.md'));
  check('코드 파일이 아님 → 검사·마커 없음', r.code === 0 && r.marked === null, `exit ${r.code}`);
} finally {
  // 시험이 실패해도 표본 프로세스를 남기지 않는다 (Windows는 실행 중 파일을 지울 수 없다)
  for (const dir of [slow, lint]) for (const p of pidsIn(dir)) if (alive(p)) try { process.kill(p, 'SIGKILL'); } catch {}
  await sleep(500);
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}

console.log(failed ? `결과: 실패 ${failed}건` : '결과: 통과');
process.exit(failed ? 1 : 0);
