// Stop 훅 — 이번 턴에 코드 수정이 있었다면(마커 존재) 턴 종료 시 테스트를 실행한다.
// 실패 시 exit 2로 턴 종료를 막고 Claude가 테스트를 고치게 한다.
// 시간 초과·실행 불가는 테스트 실패가 아니므로 막지 않고 사용자에게만 알린다 — 테스트는 프로세스 트리째 끝낸다(run-command.mjs).
// 코드 수정이 없던 턴(질문/조회)에는 테스트를 돌리지 않는다.
// 지원 스택: Node(package.json의 test 스크립트) · JVM/Gradle(gradlew test).
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCommand, notifyUser } from './run-command.mjs';

// settings.json 등록 timeout(300초, register-hooks.mjs)보다 짧게 — 넘기면 Claude Code가 훅을 취소해 결과도 경고도 사라진다
const TIMEOUT_MS = 270_000;

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
  // Windows는 절대 경로로 — 'gradlew.bat'만 쓰면 cmd가 PATH에서만 찾아 실패한다
  const gw = process.platform === 'win32' ? `"${path.join(root, 'gradlew.bat')}"` : './gradlew';
  cmd = `${gw} test --quiet`;   // --offline 금지: 캐시가 비면 정상 코드도 실패한다
} else if (existsSync(path.join(root, 'package.json'))) {
  let pkg = {};
  try { pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')); } catch { process.exit(0); }
  const test = pkg.scripts?.test;
  if (!test || /no test specified/.test(test)) process.exit(0);
  cmd = 'npm test --silent';
}
if (!cmd) process.exit(0);

const { status, output } = await runCommand(cmd, { cwd: root, timeoutMs: TIMEOUT_MS });
if (status === 'fail') {
  console.error(`[test] 턴 종료 전 테스트 실패 — 고치고 종료하세요:\n${output.split('\n').slice(-50).join('\n')}`);
  process.exit(2);
}
// 시간 초과를 실패로 막으면 고칠 것이 없는데도 Claude가 한 번 더 이어서 작업한다 (2026-10-27 실측 — 매 턴 한도만큼 대기 + 추가 턴)
if (status === 'timeout') {
  notifyUser(`[test] 테스트가 ${TIMEOUT_MS / 1000}초 안에 끝나지 않아 중단했다(결과 미확인) — ${root}에서 직접 \`${cmd}\` 또는 CI로 확인한다`);
} else if (status === 'error') {
  notifyUser(`[test] 테스트를 실행하지 못했다(결과 미확인): ${output.split('\n').slice(-3).join(' ')}`);
}
process.exit(0);
