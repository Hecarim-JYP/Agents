// 기존 프로젝트 업그레이드 — JYP 템플릿·규칙이 바뀐 뒤, 이미 만든 프로젝트에 같은 변경을 옮긴다 (/project-upgrade가 실행한다).
// install은 ~/.claude만 갱신한다. 프로젝트에 복사해 둔 템플릿(build.gradle·eslint 설정 등)은 그대로 남아 낡는다.
// 단계마다 "해당 여부 → 이미 적용됐는지 → 적용"을 판정하므로 여러 번 실행해도 결과가 같다(멱등).
// 정해진 변경만 한다 — 판단이 필요한 것(같은 컨트롤러 @WebMvcTest 합치기, 기존 vitest 설정과 합치기 등)은 [수동]으로 보고한다.
// 템플릿 코드는 설치 경로(~/.claude/jyp)의 템플릿·spring.md에서 읽는다 — 이 파일에 코드 사본을 두지 않는다(SSOT).
//
// 사용법: 프로젝트 루트에서
//   node "$HOME/.claude/skills/project-upgrade/upgrade.mjs"           미리보기 (파일을 바꾸지 않는다)
//   node "$HOME/.claude/skills/project-upgrade/upgrade.mjs" --apply   적용 — git 작업 트리가 깨끗해야 한다 (--force로 무시)
//   그 밖의 인자: [프로젝트 경로]  --jyp <설치 경로 대신 읽을 저장소 경로(시험용)>
// 종료 코드: 0 수동 항목 없음 / 1 수동 항목 있음 / 2 실행할 수 없음 (작업 트리 더러움·설치 경로 없음·프로젝트 아님)

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const FORCE = args.includes('--force');
const jypArg = args.indexOf('--jyp');
const JYP = path.resolve(jypArg >= 0 ? args[jypArg + 1] : path.join(os.homedir(), '.claude', 'jyp'));
const ROOT = path.resolve(args.find((a, i) => !a.startsWith('--') && (jypArg < 0 || i !== jypArg + 1)) ?? '.');
const TEMPLATES = path.join(JYP, 'scaffolds', 'templates');

// ── 파일 읽기·쓰기: 바꿀 내용을 메모리에 모았다가 --apply일 때만 쓴다 (미리보기와 적용이 같은 계산을 거친다) ──
// 줄바꿈 보존 — Windows 작업 트리는 CRLF일 수 있다. 안에서는 LF로 다루고, 쓸 때 원래 줄바꿈(과 BOM)으로 되돌린다
const files = new Map();   // 절대 경로 → { text, eol, bom, changed, created }
function load(file) {
  if (!files.has(file)) {
    if (!existsSync(file)) return null;
    const raw = readFileSync(file, 'utf8');
    files.set(file, {
      text: raw.replace(/^﻿/, '').replace(/\r\n/g, '\n'),
      eol: raw.includes('\r\n') ? '\r\n' : '\n',
      bom: raw.startsWith('﻿') ? '﻿' : '',
      changed: false,
      created: false,
    });
  }
  return files.get(file).text;
}
function save(file, text) {
  const f = files.get(file) ?? { eol: '\n', bom: '', created: true };
  files.set(file, { ...f, text, changed: true });
}
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/') || '.';
const readJson = (file) => { try { return JSON.parse(load(file)); } catch { return null; } };
const cmp = (a, b) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};
function walk(dir, pred, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {   // 정렬 — 디렉터리 목록 순서는 OS마다 달라 보고 순서가 흔들린다
    if (name === 'node_modules' || name === 'build' || name.startsWith('.')) continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, pred, out);
    else if (pred(name)) out.push(p);
  }
  return out;
}

// ── 결과 기록 ──
const LABEL = { apply: APPLY ? '적용' : '적용 예정', done: '이미 적용', skip: '해당 없음', manual: '수동', note: '참고' };
const results = [];
const report = (step, status, detail) => results.push({ step, status, detail });

// ── 사전 확인 ──
if (!existsSync(TEMPLATES)) {
  console.log(`설치 경로가 없다: ${TEMPLATES} — JYP 저장소에서 install을 먼저 실행한다`);
  process.exit(2);
}
if (APPLY && !FORCE) {
  // 바꾼 내용을 git diff로 보고 되돌릴 수 있어야 한다 — 미커밋 변경과 섞이면 둘 다 구분이 안 된다
  let status;
  try { status = execFileSync('git', ['-C', ROOT, 'status', '--porcelain'], { encoding: 'utf8' }); } catch {
    console.log('git 저장소가 아니다 — 되돌릴 수 있게 git 저장소에서 실행한다 (그래도 진행하려면 --force)');
    process.exit(2);
  }
  if (status.trim()) {
    console.log('작업 트리에 커밋하지 않은 변경이 있다 — 커밋하거나 stash한 뒤 실행한다 (그래도 진행하려면 --force)');
    process.exit(2);
  }
}

// ── 프로젝트 구조: 스캐폴드 구조(client/·server/) 또는 단일 구조(루트) ──
const dirs = [...new Set(['server', 'client', '.'].map((d) => path.join(ROOT, d)))].filter((d) => existsSync(d));
const nodePkgs = dirs.filter((d) => existsSync(path.join(d, 'package.json')));
const deps = (d) => { const p = readJson(path.join(d, 'package.json')) ?? {}; return { ...p.dependencies, ...p.devDependencies }; };
const eslintFile = (d) => ['eslint.config.mjs', 'eslint.config.js'].map((f) => path.join(d, f)).find(existsSync);
const isNodeServer = (d) => 'express' in deps(d) || /globals\.node/.test(eslintFile(d) ? load(eslintFile(d)) : '');
const gradleDirs = dirs.filter((d) => /org\.springframework\.boot/.test(load(path.join(d, 'build.gradle')) ?? ''));
if (!nodePkgs.length && !gradleDirs.length) {
  console.log(`Node(package.json)·Spring(build.gradle) 프로젝트를 찾지 못했다: ${ROOT}`);
  process.exit(2);
}
const template = (name) => readFileSync(path.join(TEMPLATES, name), 'utf8').replace(/\r\n/g, '\n');

// ════════════════════════════════════════════════════════════════════════════════════════════════
// 2026-10-27 묶음 (변경 이력 docs/dev_log/2026-10-27_CHANGELOG.md 1~4부)
// ════════════════════════════════════════════════════════════════════════════════════════════════

// A. lint 스크립트 — 편집 훅은 단일 eslint 호출(경로 외 옵션은 --max-warnings만)일 때만 편집한 파일만 lint한다
for (const d of nodePkgs) {
  const lint = (readJson(path.join(d, 'package.json')) ?? {}).scripts?.lint;
  const step = `A  lint 스크립트 (${rel(d)})`;
  if (!lint) { report(step, 'skip', 'lint 스크립트 없음'); continue; }
  const tokens = lint.trim().split(/\s+/).slice(1);
  const simple = /^\s*eslint(\s|$)/.test(lint) && !/[&|;]/.test(lint)
    && tokens.every((t, i) => !t.startsWith('-') || t === '--max-warnings' || /^--max-warnings=\d+$/.test(t) || tokens[i - 1] === '--max-warnings');
  if (simple) report(step, 'done', `"${lint}" — 편집 훅이 고친 파일만 lint한다`);
  else report(step, 'manual', `"${lint}" — 단일 eslint 호출이 아니라 편집 훅이 매번 프로젝트 전체를 lint한다. 가능하면 "eslint ."로 두고 다른 검사는 별도 스크립트로`);
}

// B1. ESLint 서버 설정 — .mjs에 Node 전역 (없으면 vitest.config.mjs·test/setup/*.mjs가 'process is not defined'로 실패)
for (const d of nodePkgs.filter(isNodeServer)) {
  const file = eslintFile(d);
  const step = `B1 ESLint .mjs Node 전역 (${rel(d)})`;
  if (!file) { report(step, 'skip', 'eslint.config 없음'); continue; }
  const text = load(file);
  if (text.includes("'**/*.{js,mjs}'")) { report(step, 'done', rel(file)); continue; }
  if (text.includes('tseslint.config(')) {
    // TS 템플릿 — 템플릿 끝의 .mjs 블록을 그대로 가져와 마지막 ');' 앞에 넣는다
    const t = template('eslint.config.server.mjs');
    const at = t.indexOf("files: ['**/*.{js,mjs}']");
    const block = t.slice(t.lastIndexOf('  {\n', at), t.indexOf('  },\n', at) + 5);
    const end = text.lastIndexOf('\n);');
    if (at < 0 || end < 0) { report(step, 'manual', `${rel(file)} — 템플릿 형태가 아니다. **/*.{js,mjs}에 globals.node를 주는 블록을 직접 추가`); continue; }
    // 마지막 블록 뒤에 쉼표가 없으면 붙인다 — 없이 이어 붙이면 인자 사이 쉼표가 빠져 문법 오류
    const before = text.slice(0, end + 1).replace(/\}(\s*)$/, (all, ws) => (/,\s*$/.test(all) ? all : `},${ws}`));
    save(file, `${before}${block}${text.slice(end + 1)}`);
    report(step, 'apply', `${rel(file)} — .js/.mjs 파일에 Node 전역 블록 추가`);
    continue;
  }
  const re = /(files:\s*\[\s*)'\*\*\/\*\.js'(\s*\],\s*\n(?:[^\n]*\n){0,3}?[^\n]*globals\.node)/;
  if (!re.test(text)) { report(step, 'manual', `${rel(file)} — 템플릿 형태가 아니다. Node 전역(globals.node) 블록의 files에 .mjs를 넣는다`); continue; }
  save(file, text.replace(re, "$1'**/*.{js,mjs}'$2"));
  report(step, 'apply', `${rel(file)} — 규칙 블록 대상 '**/*.js' → '**/*.{js,mjs}'`);
}

// B2. Node 테스트를 워커마다 테스트 DB로 — 테스트 DB를 쓰는 Express 서버만 (testing.md 0절)
{
  const envExample = path.join(ROOT, '.env.example');
  const composeDev = path.join(ROOT, 'docker-compose.dev.yml');
  const usesTestDb = /^TEST_DB_NAME=/m.test(load(envExample) ?? '') || /^\s+db-test:/m.test(load(composeDev) ?? '');
  for (const d of nodePkgs.filter(isNodeServer)) {
    const step = `B2 워커별 테스트 DB (${rel(d)})`;
    if (!usesTestDb) { report(step, 'skip', '테스트 DB를 쓰지 않는다(.env.example에 TEST_DB_NAME 없음) — 목킹 방식이면 해당 없음'); continue; }
    if (!('vitest' in deps(d))) { report(step, 'skip', 'Vitest가 아니다'); continue; }
    const pkg = readJson(path.join(d, 'package.json')) ?? {};
    const blockers = [];
    if (!pkg.scripts?.migrate) blockers.push('package.json에 migrate 스크립트가 없다 (워커 DB에 스키마를 만들 수 없다 — migration.md 5절)');
    if (!('mysql2' in deps(d))) blockers.push('mysql2 의존성이 없다 (npm i mysql2)');
    if (blockers.length) { report(step, 'manual', `${blockers.join(' / ')} — 해결 후 다시 실행`); continue; }

    const setupDir = path.join(d, 'test', 'setup');
    const copies = [
      ['vitest-test-db.global.mjs', path.join(setupDir, 'test-db.global.mjs')],
      ['vitest-test-db.worker.mjs', path.join(setupDir, 'test-db.worker.mjs')],
    ];
    const copied = [];
    for (const [src, dst] of copies) if (load(dst) === null) { save(dst, template(src)); copied.push(rel(dst)); }

    const existing = ['vitest.config.mjs', 'vitest.config.js', 'vitest.config.ts', 'vitest.config.mts', 'vitest.config.cjs'].map((f) => path.join(d, f)).find(existsSync);
    if (existing && load(existing).includes('test-db.global.mjs')) {
      report(step, copied.length ? 'apply' : 'done', copied.length ? `준비 파일 복사: ${copied.join(', ')}` : rel(existing));
    } else if (existing) {
      report(step, 'manual', `기존 ${rel(existing)}과 합친다 — pool: 'forks', globalSetup·setupFiles(test/setup/), 맨 위 .env 로드 (템플릿 vitest.config.server.mjs)${copied.length ? ` / 준비 파일은 복사함: ${copied.join(', ')}` : ''}`);
    } else {
      // 서버가 저장소 루트에 있는 단일 구조면 .env 경로가 '../.env'가 아니라 './.env'
      const config = template('vitest.config.server.mjs');
      save(path.join(d, 'vitest.config.mjs'), d === ROOT ? config.replace("new URL('../.env'", "new URL('./.env'") : config);
      report(step, 'apply', `${rel(path.join(d, 'vitest.config.mjs'))} + ${copied.join(', ') || '준비 파일(이미 있음)'}`);
    }

    // 접속 정보 — 템플릿은 TEST_DB_HOST에 기본값을 두지 않는다(환경변수 폴백 금지)
    for (const envFile of [envExample, path.join(ROOT, '.env')]) {
      const env = load(envFile);
      if (env === null || !/^TEST_DB_NAME=/m.test(env) || /^TEST_DB_HOST=/m.test(env)) continue;
      save(envFile, env.replace(/^TEST_DB_NAME=/m, 'TEST_DB_HOST=127.0.0.1\nTEST_DB_NAME='));
      report(step, 'apply', `${rel(envFile)}에 TEST_DB_HOST=127.0.0.1${envFile.endsWith('.env') ? ' (.env는 git에 없다 — diff에 안 보인다)' : ''}`);
    }
    // 워커 DB는 root로 만든다 — root 비밀번호가 TEST_DB_PASSWORD와 같아야 한다
    const compose = load(composeDev);
    if (compose && /db-test:/.test(compose) && !/MARIADB_ROOT_PASSWORD:\s*\$\{TEST_DB_PASSWORD/.test(compose)) {
      report(step, 'manual', `${rel(composeDev)} db-test의 MARIADB_ROOT_PASSWORD를 \${TEST_DB_PASSWORD}로 (워커 DB를 root로 만든다)`);
    }
    for (const wf of walk(path.join(ROOT, '.github', 'workflows'), (n) => /\.ya?ml$/.test(n))) {
      const y = load(wf);
      if (!/TEST_DB_NAME:/.test(y)) continue;
      const root = y.match(/MARIADB_ROOT_PASSWORD:\s*(\S+)/)?.[1];
      const pw = y.match(/TEST_DB_PASSWORD:\s*(\S+)/)?.[1];
      if (!/TEST_DB_HOST:/.test(y)) report(step, 'manual', `${rel(wf)} — 테스트 job env에 TEST_DB_HOST 추가 (서비스 컨테이너면 127.0.0.1)`);
      if (root && pw && root !== pw) report(step, 'manual', `${rel(wf)} — 서비스의 MARIADB_ROOT_PASSWORD(${root})를 TEST_DB_PASSWORD(${pw})와 같게`);
    }
    // 앱·테스트 코드가 TEST_DB_*를 직접 읽으면 워커 DB를 우회한다 — 앱은 DB_*만 (express.md 7절)
    const direct = walk(d, (n) => /\.(m?[jt]s|cjs)$/.test(n)).filter((f) => !f.startsWith(setupDir) && !/vitest\.config/.test(f) && /TEST_DB_/.test(load(f)));
    if (direct.length) report(step, 'manual', `TEST_DB_*를 직접 읽는 코드 — DB_*만 읽게 바꾼다(워커 설정이 덮어쓴다): ${direct.map(rel).join(', ')}`);
  }
}

// C1. Spring Boot 4.1.1 → 4.1.2 — Boot가 Tomcat 11.0.27을 관리하게 돼 Tomcat 덮어쓰기를 지운다 (Jackson 3.1.8 덮어쓰기는 유지)
const BOOT_FROM = '4.1.1', BOOT_TO = '4.1.2', TOMCAT_MANAGED = '11.0.27';
for (const d of gradleDirs) {
  const file = path.join(d, 'build.gradle');
  const step = `C1 Spring Boot ${BOOT_TO} (${rel(d)})`;
  let text = load(file);
  const m = text.match(/(id\s+['"]org\.springframework\.boot['"]\s+version\s+['"])([\d.]+)(['"])/);
  if (!m) { report(step, 'manual', `${rel(file)} — Boot 플러그인 버전을 찾지 못했다`); continue; }
  if (cmp(m[2], BOOT_FROM) < 0) { report(step, 'skip', `현재 ${m[2]} — ${BOOT_FROM}에서만 자동으로 올린다(마이너 차이는 변경 사항 확인 후 수동)`); continue; }
  const changes = [];
  if (m[2] === BOOT_FROM) { text = text.replace(m[0], `${m[1]}${BOOT_TO}${m[3]}`); changes.push(`${BOOT_FROM} → ${BOOT_TO}`); }
  const tomcat = text.match(/^ext\['tomcat\.version'\]\s*=\s*'([^']+)'[^\n]*\n/m);
  if (tomcat && cmp(tomcat[1], TOMCAT_MANAGED) <= 0) {
    const jackson = text.match(/^ext\['jackson-bom\.version'\]\s*=\s*'([^']+)'/m)?.[1];
    const note = `// 2026-10-27 Boot ${BOOT_TO}: Tomcat은 Boot가 ${TOMCAT_MANAGED}(수정 포함)을 관리해 덮어쓰기를 지웠다${jackson ? `. Jackson은 Boot 3.1.7 < 이 값 ${jackson}이라 남긴다` : ''}\n`;
    text = text.replace(tomcat[0], '');
    // 템플릿(2026-10-21)의 Tomcat 근거 주석 줄을 정리한다 — Jackson 근거는 남긴다
    const old = text.match(/^\/\/ (.*?)Tomcat 11\.0\.24 — [^\n]*\n(?:\/\/\s+(Jackson [^\n]*)\n)?/m);
    text = old ? text.replace(old[0], `${old[2] ? `// ${old[1]}${old[2]}\n` : ''}${note}`) : text.replace(/^(ext\['jackson-bom\.version'\])/m, `${note}$1`);
    if (!old && !jackson) text = text.replace(/^(dependencies\s*\{)/m, `${note}\n$1`);
    changes.push(`Tomcat 덮어쓰기 ${tomcat[1]} 삭제`);
  }
  if (changes.length) { save(file, text); report(step, 'apply', `${rel(file)} — ${changes.join(', ')}`); }
  else report(step, 'done', `${rel(file)} — Boot ${m[2]}`);
  // 프로젝트 CLAUDE.md의 운영 정보 표에 Boot 버전을 적어 두었으면 같이 올린다
  const claude = path.join(ROOT, 'CLAUDE.md');
  const md = load(claude);
  const section = md?.match(/^## 운영 정보\n[\s\S]*?(?=^## |$(?![\s\S]))/m)?.[0];
  if (section?.includes(`Boot ${BOOT_FROM}`)) {
    save(claude, md.replace(section, section.replaceAll(`Boot ${BOOT_FROM}`, `Boot ${BOOT_TO}`)));
    report(step, 'apply', `CLAUDE.md 운영 정보 — Boot ${BOOT_FROM} → ${BOOT_TO}`);
  } else if (changes.length) report(step, 'note', 'CLAUDE.md 운영 정보의 런타임 버전 행을 확인한다(Boot 버전 기록이 없거나 다른 형식)');
}

// C2. Spring 테스트 클래스 병렬 + 병렬 안전 규칙 (spring.md 7절)
const DB_TEST = /@(SpringBootTest|JdbcTest|MybatisTest|DataJpaTest|DataJdbcTest|JooqTest|AutoConfigureTestDatabase)\b/;
// import 한 줄을 정렬된 위치에 넣는다 (google-java-format: static 묶음 → 빈 줄 → 일반 묶음, 각각 사전순)
function addImport(text, line) {
  if (text.includes(line)) return text;
  const isStatic = line.startsWith('import static ');
  const lines = text.split('\n');
  const idx = lines.map((l, i) => (l.startsWith('import ') && l.startsWith('import static ') === isStatic ? i : -1)).filter((i) => i >= 0);
  if (idx.length) {
    const at = idx.find((i) => lines[i] > line) ?? idx[idx.length - 1] + 1;
    lines.splice(at, 0, line);
    return lines.join('\n');
  }
  const anyImport = lines.findIndex((l) => l.startsWith('import '));
  const pkg = lines.findIndex((l) => l.startsWith('package '));
  if (anyImport >= 0) lines.splice(isStatic ? anyImport : lines.findLastIndex((l) => l.startsWith('import ')) + 1, 0, ...(isStatic ? [line, ''] : ['', line]));
  else lines.splice(pkg + 1, 0, '', line);
  return lines.join('\n');
}
// 짝이 맞는 '}'까지 — 메서드 하나를 통째로 꺼낼 때
function blockEnd(text, from) {
  let depth = 0;
  for (let i = text.indexOf('{', from); i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return i + 1;
  }
  return -1;
}
for (const d of gradleDirs) {
  const gradle = path.join(d, 'build.gradle');
  const step = `C2 Spring 테스트 병렬 (${rel(d)})`;
  let text = load(gradle);

  // 1) build.gradle — 템플릿의 병렬 설정 줄을 그대로 가져와 useJUnitPlatform() 다음에 넣는다
  if (text.includes('junit.jupiter.execution.parallel.enabled')) report(step, 'done', `${rel(gradle)} — 병렬 설정 있음`);
  else {
    const t = template('build.gradle');
    const start = t.indexOf('    // 테스트 클래스끼리 병렬 실행');
    const last = t.lastIndexOf("systemProperty 'junit.jupiter.execution.parallel.");
    const lines = t.slice(start, t.indexOf('\n', last) + 1).split('\n').filter(Boolean).map((l) => l.replace(/^ {4}/, ''));
    const u = text.match(/^([ \t]*)useJUnitPlatform\(\)[ \t]*$/m);   // [ \t] — \s는 앞 빈 줄까지 들여쓰기로 삼킨다
    if (start < 0 || !u) report(step, 'manual', `${rel(gradle)} — test 블록의 useJUnitPlatform()을 찾지 못했다. 템플릿 build.gradle의 systemProperty 3줄을 직접 넣는다`);
    else {
      text = text.replace(u[0], `${u[0]}\n${lines.map((l) => u[1] + l).join('\n')}`);
      save(gradle, text);
      report(step, 'apply', `${rel(gradle)} — JUnit 클래스 병렬 설정`);
    }
  }

  // 2) ArchitectureTest — spring.md 7절 코드에서 병렬 안전 규칙 두 개를 가져온다
  const spring = readFileSync(path.join(JYP, 'conventions', 'spring.md'), 'utf8').replace(/\r\n/g, '\n');
  const docCode = spring.match(/```java\n\/\/ src\/test\/java\/\{base\}\/ArchitectureTest\.java[^\n]*\n([\s\S]*?)\n```/)?.[1];
  const testRoot = path.join(d, 'src', 'test', 'java');
  const tests = walk(testRoot, (n) => n.endsWith('.java'));
  const arch = tests.find((f) => path.basename(f) === 'ArchitectureTest.java');
  if (!docCode) report(step, 'manual', 'spring.md 7절에서 ArchitectureTest 코드를 찾지 못했다 — install을 다시 실행한다');
  else if (!arch) {
    const app = walk(path.join(d, 'src', 'main', 'java'), (n) => n.endsWith('.java')).find((f) => /@SpringBootApplication/.test(load(f)));
    const base = app && load(app).match(/^package\s+([\w.]+);/m)?.[1];
    if (!/archunit/.test(text)) report(step, 'manual', "ArchUnit 의존성이 없다 — 템플릿 build.gradle의 testImplementation 'com.tngtech.archunit:archunit' 줄을 추가한 뒤 다시 실행");
    else if (!base) report(step, 'manual', '@SpringBootApplication 클래스를 찾지 못해 기본 패키지를 정할 수 없다 — ArchitectureTest를 직접 만든다(spring.md 7절)');
    else {
      const dst = path.join(testRoot, ...base.split('.'), 'ArchitectureTest.java');
      save(dst, `${docCode.replaceAll('{base}', base)}\n`);
      report(step, 'apply', `${rel(dst)} 생성 (순환 + 병렬 안전 규칙)`);
    }
  } else {
    const cur = load(arch);
    const base = cur.match(/importPackages\("([\w.]+)"\)/)?.[1] ?? cur.match(/^package\s+([\w.]+);/m)?.[1];
    const code = docCode.replaceAll('{base}', base);
    if (cur.includes('dbTestsHoldTestDbLock') && cur.includes('oneWebMvcTestClassPerController')) report(step, 'done', `${rel(arch)} — 병렬 규칙 있음`);
    else if ((cur.match(/@Test\b/g) ?? []).length === 1 && cur.includes('void noCycles()')) {
      // 템플릿 그대로(순환 검사 하나)면 새 템플릿 코드로 바꾼다 — 잃는 것이 없다
      save(arch, `${code}\n`);
      report(step, 'apply', `${rel(arch)} — 템플릿 코드로 교체 (순환 + 병렬 안전 규칙)`);
    } else {
      // 프로젝트가 규칙을 더 넣었으면 그대로 두고 TESTS 필드·두 메서드와, 그것들이 쓰는 import만 더한다
      let next = cur;
      if (!/\bTESTS\b/.test(next)) {
        const field = code.slice(code.indexOf('  private static final JavaClasses TESTS'), code.indexOf(';', code.indexOf('JavaClasses TESTS')) + 1);
        next = next.replace(/^(\s*(?:public\s+)?(?:final\s+)?class ArchitectureTest\s*\{\n)/m, `$1${field}\n\n`);
      }
      const methods = ['dbTestsHoldTestDbLock', 'oneWebMvcTestClassPerController'].filter((n) => !next.includes(n)).map((n) => {
        const at = code.indexOf(`void ${n}()`);
        const from = code.lastIndexOf('\n\n', at) + 2;   // 메서드 앞 설명 주석부터
        return code.slice(from, blockEnd(code, at));
      });
      const close = next.lastIndexOf('}');
      next = `${next.slice(0, close).replace(/\s*$/, '\n')}\n${methods.join('\n\n')}\n}\n`;
      // 본문에서 실제로 쓰는 이름의 import만 — 안 쓰는 import는 Checkstyle(UnusedImports)이 막는다
      const body = next.split('\n').filter((l) => !l.startsWith('import ')).join('\n');
      for (const imp of code.match(/^import [^\n]+;$/gm)) {
        const name = imp.match(/\.(\w+);$/)[1];
        if (new RegExp(`\\b${name}\\b`).test(body)) next = addImport(next, imp);
      }
      save(arch, next);
      report(step, 'apply', `${rel(arch)} — 기존 규칙을 두고 병렬 안전 규칙 ${methods.length}개 추가 (spotlessApply로 정렬)`);
    }
  }

  // 3) 테스트 DB·전체 컨텍스트 테스트에 @ResourceLock("test-db") — 클래스 선언 바로 위에
  const locked = [];
  const webmvc = new Map();
  const unnamed = [];
  for (const f of tests) {
    const src = load(f);
    const decl = src.match(/^(?:public\s+|final\s+|abstract\s+)*class\s+\w+/m);
    if (!decl) continue;
    const head = src.slice(0, decl.index);
    if (DB_TEST.test(head) && !/@ResourceLock\(\s*"test-db"\s*\)/.test(head)) {
      let next = `${src.slice(0, decl.index)}@ResourceLock("test-db")\n${src.slice(decl.index)}`;
      next = addImport(next, 'import org.junit.jupiter.api.parallel.ResourceLock;');
      save(f, next);
      locked.push(rel(f));
    }
    // 같은 컨트롤러의 @WebMvcTest가 여러 클래스면 병렬일 때 @MockitoBean을 공유해 깨진다 — 합치는 것은 판단이 필요해 보고만 한다
    const w = head.match(/@WebMvcTest\s*(\(([^)]*)\))?/);
    if (w) {
      const targets = [...(w[2] ?? '').matchAll(/(\w+)\.class/g)].map((x) => x[1]);
      if (!targets.length) unnamed.push(rel(f));
      for (const t of targets) webmvc.set(t, [...(webmvc.get(t) ?? []), path.basename(f, '.java')]);
    }
  }
  if (locked.length) report(step, 'apply', `@ResourceLock("test-db") 추가: ${locked.join(', ')}`);
  for (const [controller, classes] of webmvc) {
    if (classes.length > 1) report(step, 'manual', `${controller}의 @WebMvcTest가 ${classes.join(', ')} — 한 클래스로 합치고 시나리오는 @Nested로`);
  }
  if (unnamed.length) report(step, 'manual', `대상 컨트롤러가 없는 @WebMvcTest: ${unnamed.join(', ')} — @WebMvcTest(XxxController.class)로 지정`);
}

// ── 쓰기·보고 ──
const changed = [...files].filter(([, f]) => f.changed);
if (APPLY) {
  for (const [file, f] of changed) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, f.bom + (f.eol === '\n' ? f.text : f.text.replace(/\n/g, f.eol)));
  }
}
console.log(`JYP 프로젝트 업그레이드 (2026-10-27 묶음) — ${ROOT} [${APPLY ? '적용' : '미리보기 — 바꾸려면 --apply'}]`);
for (const r of results) console.log(`  [${LABEL[r.status]}] ${r.step} — ${r.detail}`);
const count = (s) => results.filter((r) => r.status === s).length;
console.log(`요약: ${LABEL.apply} ${count('apply')} · 이미 적용 ${count('done')} · 해당 없음 ${count('skip')} · 수동 ${count('manual')}`);
if (changed.length) console.log(`${APPLY ? '바꾼' : '바꿀'} 파일: ${changed.map(([file, f]) => `${rel(file)}${f.created ? '(새 파일)' : ''}`).join(', ')}`);
process.exit(count('manual') ? 1 : 0);
