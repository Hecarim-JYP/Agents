// PostToolUse(Write|Edit) 훅 — 코드 파일 수정 직후 lint/typecheck를 실행한다.
// 실패 시 exit 2로 stderr를 Claude에게 피드백하여 즉시 고치게 한다.
// lint는 편집한 파일만 검사한다(ESLint일 때) — 프로젝트 전체 검사는 CI(test.yml)의 몫이다.
// 시간 초과는 막지 않고 사용자에게만 알린다 — 명령은 프로세스 트리째 끝낸다(run-command.mjs).
// 지원 스택: Node/TS(package.json) · JVM/Gradle(gradlew). 둘 다 아니면 조용히 통과한다.
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runCommand, notifyUser } from './run-command.mjs';

// settings.json 등록 timeout(180초, register-hooks.mjs)보다 짧게 — 명령이 여러 개면 남은 시간을 나눠 쓴다
const TIMEOUT_MS = 170_000;

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

const deadline = Date.now() + TIMEOUT_MS;
const failures = [];
const timeouts = [];
// 명령 하나를 남은 시간 안에서 실행 — args가 있으면 셸 없이(command = 실행 파일)
const run = async (label, command, args) => {
  const left = deadline - Date.now();
  if (left <= 0) { timeouts.push(label); return; }
  const { status, output } = await runCommand(command, { cwd: root, timeoutMs: left, args });
  if (status === 'timeout') timeouts.push(label);
  else if (status !== 'ok') failures.push(`[${label}] 실패:\n${output.split('\n').slice(-40).join('\n')}`);
};

// ESLint 설치 위치 — 모노레포는 상위 node_modules로 끌어올려져(hoist) 있을 수 있어 루트에서 위로 찾는다
function findEslint(from) {
  for (let d = from; ; d = path.dirname(d)) {
    const pkgFile = path.join(d, 'node_modules', 'eslint', 'package.json');
    if (existsSync(pkgFile)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
        const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.eslint;
        if (bin) return { bin: path.join(d, 'node_modules', 'eslint', bin), major: parseInt(pkg.version, 10) };
      } catch {}
      return null;
    }
    if (path.dirname(d) === d) return null;
  }
}

// lint 스크립트를 "편집한 파일만" 검사로 바꿀 수 있으면 추가 인자를, 아니면 null을 돌려준다.
// 단일 eslint 호출(다른 도구를 잇지 않음)이고 경로 외 옵션이 --max-warnings뿐일 때만 바꾼다 —
// 설정 파일 지정(-c) 같은 다른 옵션은 의미를 다 옮길 수 없어 기존처럼 스크립트 전체를 돈다.
function fileLintArgs(script) {
  if (!/^\s*eslint(\s|$)/.test(script) || /[&|;]/.test(script)) return null;
  const tokens = script.trim().split(/\s+/).slice(1);
  const extra = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t.startsWith('-')) continue;                                   // 경로(. src 등) — 편집한 파일로 대신한다
    if (t === '--max-warnings' && tokens[i + 1]) { extra.push(t, tokens[++i]); continue; }
    if (/^--max-warnings=\d+$/.test(t)) { extra.push(t); continue; }
    return null;
  }
  return extra;
}

if (isJavaFile) {
  // Gradle: 포맷(Spotless)과 컴파일까지만 — 테스트는 Stop 훅이 실행한다. 둘 다 Gradle이 바뀐 입력만 다시 처리한다
  // Windows는 절대 경로로 호출한다 — 'gradlew.bat'만 쓰면 cmd가 PATH에서만 찾아 실패한다
  const gw = process.platform === 'win32' ? `"${path.join(root, 'gradlew.bat')}"` : './gradlew';
  // --offline은 쓰지 않는다: 캐시가 비어 있으면 정상 코드도 "플러그인을 찾을 수 없음"으로 실패한다.
  // 첫 실행은 의존성 내려받느라 느리다 — 프로젝트 세팅 직후 `./gradlew build`로 캐시를 채워두면 이후는 빠르다.
  const build = ['build.gradle', 'build.gradle.kts'].map((f) => path.join(root, f)).find(existsSync);
  const hasSpotless = build ? /spotless/.test(readFileSync(build, 'utf8')) : false;
  if (hasSpotless) await run('spotlessCheck', `${gw} spotlessCheck --quiet`);
  await run('compileJava', `${gw} compileJava --quiet`);
} else {
  let pkg = {};
  try { pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')); } catch { process.exit(0); }
  const scripts = pkg.scripts || {};
  if (scripts.lint) {
    // 편집마다 프로젝트 전체를 lint하면 파일 수에 비례해 느려진다 (2026-10-27 — 편집 한 번에 전체 검사 한 번)
    const extra = fileLintArgs(scripts.lint);
    const eslint = extra ? findEslint(root) : null;
    if (eslint) {
      // ESLint 9+는 무시 대상 파일(빌드 산출물 등)을 직접 지정하면 경고를 낸다 — 편집 파일이 그런 경우 조용히 통과시킨다
      const ignoreFlag = eslint.major >= 9 ? ['--no-warn-ignored'] : [];
      await run('lint', process.execPath, [eslint.bin, ...ignoreFlag, ...extra, path.resolve(file)]);
    } else {
      await run('lint', 'npm run -s lint');
    }
  }
  if (scripts.typecheck) await run('typecheck', 'npm run -s typecheck');
  else if (existsSync(path.join(root, 'tsconfig.json'))) {
    // Vite 템플릿처럼 루트 tsconfig가 files: [] + references(참조형)면 `tsc --noEmit`은 아무 파일도 검사하지 않는다
    // — 타입 오류가 있어도 통과한다(2026-10-19 실측). 참조형이면 빌드 모드(-b)로 참조 프로젝트까지 검사한다
    let tsconfig = '';
    try { tsconfig = readFileSync(path.join(root, 'tsconfig.json'), 'utf8'); } catch {}
    await run('typecheck', /"references"\s*:/.test(tsconfig) ? 'npx tsc -b --noEmit' : 'npx tsc --noEmit');
  }
}

if (failures.length) {
  const note = timeouts.length ? `\n\n(시간 초과로 확인하지 못함: ${timeouts.join(', ')})` : '';
  console.error(failures.join('\n\n') + note);
  process.exit(2);
}
// 시간 초과는 코드 문제가 아니다 — 막으면 Claude가 고칠 것 없이 다시 손댄다. 사용자에게만 알린다
if (timeouts.length) {
  notifyUser(`[lint/typecheck] ${timeouts.join(', ')}이(가) ${TIMEOUT_MS / 1000}초 안에 끝나지 않아 중단했다(결과 미확인) — ${root}에서 직접 확인한다`);
}
process.exit(0);
