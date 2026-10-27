// 훅 공용 명령 실행 — post-edit-check·stop-test가 lint·typecheck·테스트를 돌릴 때 쓴다 (훅으로 등록하지 않는 모듈).
// 시간 한도를 넘으면 셸만이 아니라 그 아래 프로세스 트리 전체를 끝낸다.
// (실측 2026-10-27: execSync의 timeout은 /bin/sh만 죽여 npm → vitest → 워커, gradlew 클라이언트가 부모 없이(ppid 1) 계속 돌았다.
//  Gradle은 클라이언트가 살아 있는 한 데몬의 테스트 JVM도 멈추지 않는다 — 클라이언트까지 끝내면 데몬이 2초 안에 빌드를 취소한다)
import { spawn, spawnSync } from 'node:child_process';

const KEEP_CHARS = 200_000;   // 출력은 끝부분만 보관한다 — 실패 원인은 끝에 있고, 긴 로그로 메모리를 잡지 않는다
const KILL_GRACE_MS = 3_000;  // SIGTERM 뒤 이만큼 기다렸다가 남은 것을 SIGKILL (Gradle 클라이언트가 데몬에 취소를 알릴 시간)
const CLOSE_WAIT_MS = 2_000;  // 정상 종료 뒤 출력 파이프가 닫히기를 기다리는 최대 시간
const isWin = process.platform === 'win32';

// 프로세스 트리 종료 — POSIX는 프로세스 그룹째(detached로 띄워 그룹 리더가 됨), Windows는 taskkill /T(자식 트리, /F 강제)
function killTree(pid, signal) {
  if (isWin) {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    return;
  }
  try { process.kill(-pid, signal); } catch { /* 그룹이 이미 비었다 */ }
}

/**
 * 명령을 시간 한도 안에서 실행한다.
 * - args를 주면 셸 없이 실행(경로 인용 문제 없음), 안 주면 command를 셸 명령줄로 실행한다.
 * @returns {Promise<{ status: 'ok' | 'fail' | 'timeout' | 'error', output: string }>}
 *   ok: 종료 코드 0 / fail: 0 아닌 종료 / timeout: 한도 초과로 트리를 끝냄 / error: 실행 자체를 못 함
 */
export function runCommand(command, { cwd, timeoutMs, args }) {
  return new Promise((resolve) => {
    let output = '';
    let timedOut = false;
    let settled = false;
    let timer;
    const finish = (status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ status, output: output.trim() });
    };

    let child;
    try {
      child = spawn(command, args ?? [], {
        cwd,
        shell: !args,
        detached: !isWin,       // POSIX: 새 프로세스 그룹 — 시간 초과 때 손자 프로세스까지 한 번에 끝내기 위해
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      resolve({ status: 'error', output: String(e.message) });
      return;
    }

    const collect = (chunk) => {
      output += chunk;
      if (output.length > KEEP_CHARS) output = output.slice(-KEEP_CHARS);
    };
    child.stdout.setEncoding('utf8').on('data', collect);
    child.stderr.setEncoding('utf8').on('data', collect);

    // 시간 초과: SIGTERM → 유예 → SIGKILL을 항상 거친 뒤 끝낸다 (먼저 끝난 부모만 보고 손자를 남기지 않도록)
    timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid, 'SIGTERM');
      setTimeout(() => {
        killTree(child.pid, 'SIGKILL');
        finish('timeout');
      }, KILL_GRACE_MS);
    }, timeoutMs);

    const done = (code) => { if (!timedOut) finish(code === 0 ? 'ok' : 'fail'); };
    child.on('error', (e) => { output += `\n${e.message}`; if (!timedOut) finish('error'); });
    // close = 프로세스 종료 + 출력 파이프 닫힘. 손자가 파이프를 쥔 채 남으면 close가 오지 않으므로 exit 뒤 잠깐만 기다린다
    child.on('exit', (code) => setTimeout(() => done(code), CLOSE_WAIT_MS));
    child.on('close', done);
  });
}

// 사용자에게만 보이는 경고 — exit 0과 함께 stdout JSON의 systemMessage로 낸다 (Claude에게는 가지 않아 턴이 이어지지 않는다)
export function notifyUser(message) {
  process.stdout.write(`${JSON.stringify({ systemMessage: message })}\n`);
}
