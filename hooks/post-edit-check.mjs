// PostToolUse(Write|Edit) 훅 — 코드 파일 수정 직후 lint/typecheck를 실행한다.
// 실패 시 exit 2로 stderr를 Claude에게 피드백하여 즉시 고치게 한다.
// 지원 스택: Node/TS(package.json) · JVM/Gradle(gradlew). 둘 다 아니면 조용히 통과한다.
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

let data = {};
try { data = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

const file = data.tool_input?.file_path || data.tool_response?.filePath || '';
const isNodeFile = /\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(file);
const isJavaFile = /\.java$/i.test(file);
if (!isNodeFile && !isJavaFile) process.exit(0);

// 수정된 파일에서 위로 올라가며 프로젝트 루트를 찾는다 (모노레포 대응)
const marker = isJavaFile ? 'gradlew' : 'package.json';
let dir = path.dirname(path.resolve(file));
let root = null;
for (;;) {
  if (existsSync(path.join(dir, marker))) { root = dir; break; }
  const parent = path.dirname(dir);
  if (parent === dir) break;
  dir = parent;
}
if (!root) process.exit(0);

// Stop 훅에게 "이번 턴에 코드가 수정됐다"는 마커를 남긴다 (턴 종료 시 테스트 트리거)
if (data.session_id) {
  try { writeFileSync(path.join(tmpdir(), `claude-needs-test-${data.session_id}`), root); } catch {}
}

const failures = [];
const run = (label, cmd) => {
  try {
    execSync(cmd, { cwd: root, stdio: 'pipe', encoding: 'utf8', timeout: 120_000 });
  } catch (e) {
    const out = `${e.stdout || ''}${e.stderr || ''}`.trim() || String(e.message);
    failures.push(`[${label}] 실패:\n${out.split('\n').slice(-40).join('\n')}`);
  }
};

if (isJavaFile) {
  // Gradle: 포맷(Spotless)과 컴파일까지만 — 테스트는 Stop 훅이 실행한다
  const gw = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
  const build = ['build.gradle', 'build.gradle.kts'].map((f) => path.join(root, f)).find(existsSync);
  const hasSpotless = build ? /spotless/.test(readFileSync(build, 'utf8')) : false;
  if (hasSpotless) run('spotlessCheck', `${gw} spotlessCheck --quiet --offline`);
  run('compileJava', `${gw} compileJava --quiet --offline`);
} else {
  let pkg = {};
  try { pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')); } catch { process.exit(0); }
  const scripts = pkg.scripts || {};
  if (scripts.lint) run('lint', 'npm run -s lint');
  if (scripts.typecheck) run('typecheck', 'npm run -s typecheck');
  else if (existsSync(path.join(root, 'tsconfig.json'))) run('typecheck', 'npx tsc --noEmit');
}

if (failures.length) {
  console.error(failures.join('\n\n'));
  process.exit(2);
}
process.exit(0);
