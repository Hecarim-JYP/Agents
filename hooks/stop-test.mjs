// Stop 훅 — 이번 턴에 코드 수정이 있었다면(마커 존재) 턴 종료 시 테스트를 실행한다.
// 실패 시 exit 2로 턴 종료를 막고 Claude가 테스트를 고치게 한다.
// 코드 수정이 없던 턴(질문/조회)에는 테스트를 돌리지 않는다.
// 지원 스택: Node(package.json의 test 스크립트) · JVM/Gradle(gradlew test).
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

let data = {};
try { data = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }

// 이미 Stop 훅 피드백으로 이어진 턴이면 재실행하지 않는다 (무한 루프 방지)
if (data.stop_hook_active) process.exit(0);

// PostToolUse 훅이 남긴 "코드 수정됨" 마커 확인 — 없으면 테스트 생략
const marker = data.session_id ? path.join(tmpdir(), `claude-needs-test-${data.session_id}`) : null;
if (!marker || !existsSync(marker)) process.exit(0);

let root = '';
try { root = readFileSync(marker, 'utf8').trim(); } catch {}
try { unlinkSync(marker); } catch {}
if (!root) process.exit(0);

// 스택 판별 — Gradle 프로젝트면 gradlew test, Node면 npm test
const isGradle = existsSync(path.join(root, 'gradlew'));
let cmd = null;

if (isGradle) {
  cmd = `${process.platform === 'win32' ? 'gradlew.bat' : './gradlew'} test --quiet --offline`;
} else if (existsSync(path.join(root, 'package.json'))) {
  let pkg = {};
  try { pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')); } catch { process.exit(0); }
  const test = pkg.scripts?.test;
  if (!test || /no test specified/.test(test)) process.exit(0);
  cmd = 'npm test --silent';
}
if (!cmd) process.exit(0);

try {
  execSync(cmd, { cwd: root, stdio: 'pipe', encoding: 'utf8', timeout: 270_000 });
} catch (e) {
  const out = `${e.stdout || ''}${e.stderr || ''}`.trim() || String(e.message);
  console.error(`[test] 턴 종료 전 테스트 실패 — 고치고 종료하세요:\n${out.split('\n').slice(-50).join('\n')}`);
  process.exit(2);
}
process.exit(0);
