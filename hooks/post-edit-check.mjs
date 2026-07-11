// PostToolUse(Write|Edit) 훅 — 코드 파일 수정 직후 lint/typecheck를 실행한다.
// 실패 시 exit 2로 stderr를 Claude에게 피드백하여 즉시 고치게 한다.
// JS/TS 프로젝트가 아니면(package.json 없음) 조용히 통과한다.
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

let data = {};
try { data = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

const file = data.tool_input?.file_path || data.tool_response?.filePath || '';
if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(file)) process.exit(0);

// 수정된 파일 기준으로 가장 가까운 package.json을 찾는다 (모노레포 대응)
let dir = path.dirname(path.resolve(file));
let root = null;
for (;;) {
  if (existsSync(path.join(dir, 'package.json'))) { root = dir; break; }
  const parent = path.dirname(dir);
  if (parent === dir) break;
  dir = parent;
}
if (!root) process.exit(0);

// Stop 훅에게 "이번 턴에 코드가 수정됐다"는 마커를 남긴다 (턴 종료 시 테스트 트리거)
if (data.session_id) {
  try { writeFileSync(path.join(tmpdir(), `claude-needs-test-${data.session_id}`), root); } catch {}
}

let pkg = {};
try { pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')); } catch { process.exit(0); }
const scripts = pkg.scripts || {};

const failures = [];
const run = (label, cmd) => {
  try {
    execSync(cmd, { cwd: root, stdio: 'pipe', encoding: 'utf8', timeout: 90_000 });
  } catch (e) {
    const out = `${e.stdout || ''}${e.stderr || ''}`.trim() || String(e.message);
    failures.push(`[${label}] 실패:\n${out.split('\n').slice(-40).join('\n')}`);
  }
};

if (scripts.lint) run('lint', 'npm run -s lint');
if (scripts.typecheck) run('typecheck', 'npm run -s typecheck');
else if (existsSync(path.join(root, 'tsconfig.json'))) run('typecheck', 'npx tsc --noEmit');

if (failures.length) {
  console.error(failures.join('\n\n'));
  process.exit(2);
}
process.exit(0);
