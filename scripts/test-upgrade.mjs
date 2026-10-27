// 업그레이드 스크립트 검사 — skills/project-upgrade/upgrade.mjs를 예전 템플릿 형태의 표본 프로젝트에 돌려 판정·적용·멱등성을 확인한다.
// 단계를 고치거나 템플릿이 바뀌면 "예전 프로젝트를 새 템플릿 형태로 옮긴다"는 약속이 조용히 깨질 수 있다 — 사람의 확인 대신 여기서 막는다.
// 표본은 2026-10-27 이전 템플릿에서 업그레이드가 건드리는 부분만 담는다(빌드·테스트 실행은 하지 않는다 — 단계를 바꾸면
// 예전 템플릿으로 만든 실제 프로젝트에서 gradlew check / npm run lint·test까지 직접 확인한다: 저장소 CLAUDE.md 검증 항목).
//
// 사용법: 저장소 루트에서  node scripts/test-upgrade.mjs   (CI verify.yml·verify-windows.yml이 push/PR마다 실행)

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(repo, 'skills', 'project-upgrade', 'upgrade.mjs');
const work = mkdtempSync(path.join(tmpdir(), 'jyp-upgrade-test-'));

// ── 표본: 예전 템플릿 형태 ──
const SPRING = {
  'build.gradle': `plugins {
    id 'java'
    id 'org.springframework.boot' version '4.1.1'
}

// 보안 패치 덮어쓰기 — Boot가 관리하는 버전에 알려진 취약점이 있을 때만, 같은 계열의 최신 패치로 (ops.md 5-1절)
// 2026-10-21 Boot 4.1.1 기준 (OSV): Tomcat 11.0.24 — GHSA-9xv2-5v5q-p794 (11.0.25 수정)
//                                  Jackson 3.1.5 — jackson-core GHSA-7hhh-6rmp-j9qf (3.1.7 수정)
ext['tomcat.version'] = '11.0.27'
ext['jackson-bom.version'] = '3.1.8'

dependencies {
    testImplementation 'com.tngtech.archunit:archunit:1.5.1'
}

tasks.named('test') {
    useJUnitPlatform()
    testLogging {
        events 'failed'
    }
}
`,
  'CLAUDE.md': '# demo\n\n## 운영 정보\n\n| 항목 | 값 |\n|---|---|\n| 런타임·DB 버전과 지원 종료일 | Java 25 · Spring Boot 4.1.1 |\n\n## 정기 점검\n',
  'src/main/java/com/example/demo/DemoApplication.java': 'package com.example.demo;\n\nimport org.springframework.boot.autoconfigure.SpringBootApplication;\n\n@SpringBootApplication\npublic class DemoApplication {}\n',
  'src/test/java/com/example/demo/ArchitectureTest.java': `package com.example.demo;

import static com.tngtech.archunit.library.dependencies.SlicesRuleDefinition.slices;

import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import org.junit.jupiter.api.Test;

class ArchitectureTest {
  @Test
  void noCycles() {
    slices().matching("com.example.demo.(**)").should().beFreeOfCycles()
        .check(new ClassFileImporter().withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS).importPackages("com.example.demo"));
  }
}
`,
  'src/test/java/com/example/demo/OrderDbTest.java': 'package com.example.demo;\n\nimport org.junit.jupiter.api.Test;\nimport org.springframework.boot.test.context.SpringBootTest;\n\n@SpringBootTest\nclass OrderDbTest {\n  @Test\n  void saves() {}\n}\n',
  'src/test/java/com/example/demo/ItemControllerTest.java': 'package com.example.demo;\n\nimport org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;\n\n@WebMvcTest(ItemController.class)\nclass ItemControllerTest {}\n',
  'src/test/java/com/example/demo/ItemControllerMoreTest.java': 'package com.example.demo;\n\nimport org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;\n\n@WebMvcTest(ItemController.class)\nclass ItemControllerMoreTest {}\n',
};
const NODE_JS = {
  '.env.example': 'DB_HOST=db\nDB_NAME=demo\n# 테스트 DB (체크리스트 21 — 사용 시)\nTEST_DB_NAME=demo_test\nTEST_DB_USER=\nTEST_DB_PASSWORD=\nTEST_DB_PORT=3307\n',
  'docker-compose.dev.yml': 'services:\n  db-test:\n    image: mariadb:11.4\n    environment:\n      MARIADB_ROOT_PASSWORD: ${TEST_DB_PASSWORD:?TEST_DB_PASSWORD 미설정}\n',
  'server/package.json': JSON.stringify({ name: 'demo-server', type: 'module', scripts: { lint: 'eslint .', test: 'vitest run', migrate: 'node scripts/migrate.mjs' }, dependencies: { express: '^5.0.0', mysql2: '^3.0.0' }, devDependencies: { vitest: '^5.0.0' } }, null, 2),
  'server/eslint.config.mjs': "import js from '@eslint/js';\nimport globals from 'globals';\n\nexport default [\n  js.configs.recommended,\n  {\n    files: ['**/*.js'],\n    languageOptions: { globals: globals.node },\n    rules: {},\n  },\n];\n",
  'server/src/db.js': 'export const name = process.env.DB_NAME;\n',
};
const NODE_TS_ESLINT = "import tseslint from 'typescript-eslint';\nimport globals from 'globals';\n\nexport default tseslint.config(\n  {\n    files: ['**/*.ts'],\n    languageOptions: { globals: globals.node },\n  }\n);\n";
// 하위 폴더 이름이 server/·client/가 아닌 구조 — Express 서버(eslint 없음) + Vite React(설정 파일에만 Node 전역) (2026-10-27 결함 1·2의 재현 구조)
const VITE_CLIENT_ESLINT = "import js from '@eslint/js';\nimport globals from 'globals';\n\nexport default [\n  { files: ['**/*.{js,jsx}'], ...js.configs.recommended, languageOptions: { globals: globals.browser } },\n  {\n    files: ['*.config.js'],\n    languageOptions: { globals: globals.node },\n  },\n];\n";
const LTMS = {
  'CLAUDE.md': '# app\n\n## 운영 정보\n\n| 항목 | 값 |\n|---|---|\n| 런타임 | Node 24 |\n',
  'docker-compose.yml': 'services: {}\n',
  'app-server/package.json': JSON.stringify({ name: 'app-server', type: 'module', scripts: { test: 'vitest run' }, dependencies: { express: '^5.0.0' }, devDependencies: { vitest: '^5.0.0' } }),
  'app-server/.env.example': 'DB_HOST=127.0.0.1\nDB_NAME=app\n',
  'app-web/package.json': JSON.stringify({ name: 'app-web', type: 'module', scripts: { lint: 'eslint .', test: 'vitest run' }, dependencies: { react: '^19.0.0' }, devDependencies: { eslint: '^10.0.0', vitest: '^5.0.0' } }),
  'app-web/eslint.config.js': VITE_CLIENT_ESLINT,
  'app-web/scripts/run-vitest.mjs': 'console.log(process.argv);\n',
};
// 가짜 ESLint — 받은 파일(또는 --stdin 내용)에 process.가 있고 프로젝트 설정에 MJS_NODE_GLOBALS 표시가 없으면 no-undef를 낸다.
// 업그레이드가 ESLint를 실제로 불러 결과(JSON)로 판정하는지 본다 — 진짜 ESLint의 판정은 실표본에서 따로 확인한다
const FAKE_ESLINT = {
  'node_modules/eslint/package.json': JSON.stringify({ name: 'eslint', version: '10.0.0', bin: { eslint: 'bin/eslint.js' } }),
  'node_modules/eslint/bin/eslint.js': `const fs = require('node:fs');
const path = require('node:path');
const a = process.argv.slice(2);
const covered = !fs.readFileSync('eslint.config.js', 'utf8').includes('MJS_NODE_GLOBALS');
const at = a.indexOf('--stdin-filename');
const targets = at >= 0 ? [[a[at + 1], fs.readFileSync(0, 'utf8')]] : a.filter((x) => !x.startsWith('--') && x !== 'json').map((f) => [f, fs.readFileSync(f, 'utf8')]);
const out = targets.map(([f, s]) => ({ filePath: path.resolve(f), messages: covered && s.includes('process.') ? [{ ruleId: 'no-undef', message: "'process' is not defined." }] : [] }));
process.stdout.write(JSON.stringify(out));
process.exit(out.some((r) => r.messages.length) ? 1 : 0);
`,
};
const SERVER_NONTEMPLATE = (marker) => ({
  'package.json': JSON.stringify({ name: 'api', type: 'module', scripts: { lint: 'eslint .', test: 'vitest run', migrate: 'node scripts/migrate.mjs' }, dependencies: { express: '^5.0.0', mysql2: '^3.0.0' }, devDependencies: { vitest: '^5.0.0' } }),
  'eslint.config.js': `// 템플릿이 아닌 서버 설정${marker ? ' — MJS_NODE_GLOBALS (.mjs에 Node 전역이 이미 있다)' : ''}\nexport default [{ files: ['src/**/*.js'], rules: {} }];\n`,
  'scripts/migrate.mjs': 'console.log(process.env.DB_NAME);\n',
  '.env.example': 'TEST_DB_NAME=api_test\nTEST_DB_USER=\nTEST_DB_PASSWORD=\nTEST_DB_PORT=3307\n',
});

// ── 실행 도구 ──
const git = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
function project(name, files, crlf = false) {
  const dir = path.join(work, name);
  for (const [f, s] of Object.entries(files)) {
    const p = path.join(dir, f);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, crlf ? s.replace(/\n/g, '\r\n') : s);
  }
  git(dir, 'init', '-q');
  git(dir, 'config', 'core.autocrlf', 'false');   // Windows 러너의 전역 autocrlf가 표본의 줄바꿈을 바꾸지 않게
  git(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A');
  git(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  return dir;
}
const run = (dir, ...a) => {
  const r = spawnSync(process.execPath, [script, dir, '--jyp', repo, ...a], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
};
// 없는 파일은 빈 값 — 대조군(수정 전 스크립트)이 파일을 안 만들어도 시험이 죽지 않고 ✗로 남게 한다
const read = (dir, f) => (existsSync(path.join(dir, f)) ? readFileSync(path.join(dir, f), 'utf8') : '');
const clean = (dir) => git(dir, 'status', '--porcelain').trim() === '';
// 바뀐 것이 없어도 실패하지 않는다 — 대조군(수정 전 스크립트)이 아무것도 안 바꿔도 시험이 죽지 않고 ✗로 남게 한다
const commitAll = (dir) => { git(dir, 'add', '-A'); git(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'upgrade', '--allow-empty'); };

// ESLint 규칙 교체(B3·B4)의 이전 템플릿 — 현재 템플릿에서 바뀐 부분만 되돌린다. 적용 뒤 현재 템플릿과 글자까지 같아야 한다
const tplText = (n) => readFileSync(path.join(repo, 'scaffolds', 'templates', n), 'utf8').replace(/\r\n/g, '\n');
const OLD_SQL_BLOCK = [
  '          // sql.md 7절 — 문자열 연결로 쿼리를 조립하지 않는다 (인젝션)',
  String.raw`          selector: "TemplateLiteral[expressions.length>0][quasis.0.value.raw=/\\b(select|insert|update|delete)\\b/i]",`,
  "          message: 'SQL에 템플릿 리터럴 보간 금지 — 값은 항상 바인딩 파라미터로 전달한다 (sql.md 7절).',",
  '',
].join('\n');
const oldSql = (n) => tplText(n).replace(/^ *\/\/ sql\.md 7절[^\n]*\n[\s\S]*?^ *message: 'SQL에 요청 값 직접 보간 금지[^\n]*\n/m, () => OLD_SQL_BLOCK);
const oldJsx = () => tplText('eslint.config.client-js.mjs').replace(/^ *\/\/ import-x는 이 목록[^\n]*\n *'import-x\/extensions'[^\n]*\n/m, '');
const CLIENT_PKG = JSON.stringify({ name: 'client', scripts: { lint: 'eslint .' }, dependencies: { react: '^19.0.0' } });

let failed = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};

try {
  console.log('Spring (예전 템플릿)');
  const sp = project('spring', SPRING);
  let r = run(sp);
  check('미리보기 → 파일을 바꾸지 않음', clean(sp), r.out);
  check('미리보기 → 같은 컨트롤러 @WebMvcTest 중복은 [수동] + exit 1', r.code === 1 && /\[수동\][^\n]*ItemController의 @WebMvcTest가 ItemControllerMoreTest, ItemControllerTest/.test(r.out), r.out);
  r = run(sp, '--apply');
  const gradle = read(sp, 'build.gradle');
  check('Boot 4.1.1 → 4.1.2', /version '4\.1\.2'/.test(gradle), gradle);
  check('Tomcat 덮어쓰기 삭제 · Jackson 덮어쓰기와 근거 주석 유지', !/tomcat\.version/.test(gradle) && /ext\['jackson-bom\.version'\] = '3\.1\.8'/.test(gradle) && /Jackson 3\.1\.5 — /.test(gradle) && !/Tomcat 11\.0\.24/.test(gradle), gradle);
  check('test 블록에 병렬 설정 3줄 (useJUnitPlatform 다음, 같은 들여쓰기)', /useJUnitPlatform\(\)\n(?: {4}\/\/[^\n]*\n)* {4}systemProperty 'junit\.jupiter\.execution\.parallel\.enabled', 'true'\n {4}systemProperty 'junit\.jupiter\.execution\.parallel\.mode\.default'/.test(gradle), gradle);
  const arch = read(sp, 'src/test/java/com/example/demo/ArchitectureTest.java');
  check('ArchitectureTest — 순환 + 병렬 안전 규칙, 기본 패키지 치환', /void noCycles\(\)/.test(arch) && /void dbTestsHoldTestDbLock\(\)/.test(arch) && /void oneWebMvcTestClassPerController\(\)/.test(arch) && !arch.includes('{base}') && arch.includes('importPackages("com.example.demo")'), arch.slice(0, 300));
  const db = read(sp, 'src/test/java/com/example/demo/OrderDbTest.java');
  check('@SpringBootTest 클래스에 @ResourceLock("test-db") + import', /@SpringBootTest\n@ResourceLock\("test-db"\)\nclass OrderDbTest/.test(db) && db.includes('import org.junit.jupiter.api.parallel.ResourceLock;'), db);
  check('CLAUDE.md 운영 정보 Boot 4.1.2', read(sp, 'CLAUDE.md').includes('Spring Boot 4.1.2'));
  commitAll(sp);
  r = run(sp, '--apply');
  check('재실행 → 바꾸는 것 없음(멱등)', clean(sp) && /적용 0 · 이미 적용 3/.test(r.out), r.out);

  console.log('Spring CRLF (Windows 작업 트리)');
  const crlf = project('spring-crlf', SPRING, true);
  run(crlf, '--apply');
  const g2 = read(crlf, 'build.gradle');
  check('CRLF 유지 — LF만 있는 줄이 없다', g2.includes('\r\n') && !/[^\r]\n/.test(g2), JSON.stringify(g2.slice(0, 120)));
  check('CRLF에서도 같은 변경', /version '4\.1\.2'/.test(g2) && /junit\.jupiter\.execution\.parallel\.enabled/.test(g2) && !/tomcat\.version/.test(g2));

  console.log('Node 서버 JS (예전 템플릿)');
  const nj = project('node-js', NODE_JS);
  writeFileSync(path.join(nj, 'untracked.txt'), 'x');
  r = run(nj, '--apply');
  check('작업 트리가 더러우면 적용 거부(exit 2) + 아무것도 안 바꿈', r.code === 2 && !existsSync(path.join(nj, 'server', 'vitest.config.mjs')), r.out);
  rmSync(path.join(nj, 'untracked.txt'));
  r = run(nj, '--apply');
  check('ESLint 규칙 블록 대상 → **/*.{js,mjs}', read(nj, 'server/eslint.config.mjs').includes("files: ['**/*.{js,mjs}']"));
  check('vitest 설정 + 준비 파일 2개 생성, .env 경로는 ../.env', read(nj, 'server/vitest.config.mjs').includes("new URL('../.env'") && existsSync(path.join(nj, 'server/test/setup/test-db.global.mjs')) && existsSync(path.join(nj, 'server/test/setup/test-db.worker.mjs')));
  check('.env.example에 TEST_DB_HOST=127.0.0.1 (TEST_DB_NAME 앞)', /TEST_DB_HOST=127\.0\.0\.1\nTEST_DB_NAME=/.test(read(nj, '.env.example')));
  check('lint 스크립트 "eslint ." → 이미 적용', /\[이미 적용\] A {2}lint 스크립트/.test(r.out), r.out);
  commitAll(nj);
  r = run(nj, '--apply');
  check('재실행 → 바꾸는 것 없음(멱등)', clean(nj) && /적용 0 · /.test(r.out), r.out);

  console.log('Node 서버 TS · 테스트 DB 없음');
  const nt = project('node-ts', { ...NODE_JS, 'server/eslint.config.mjs': NODE_TS_ESLINT, '.env.example': 'DB_HOST=db\n', 'docker-compose.dev.yml': 'services: {}\n' });
  r = run(nt, '--apply');
  const ts = read(nt, 'server/eslint.config.mjs');
  check("TS 설정 끝에 .js/.mjs Node 전역 블록 (앞 블록에 쉼표 보충)", /files: \['\*\*\/\*\.ts'\],\n {4}languageOptions: \{ globals: globals\.node \},\n {2}\},\n {2}\{\n(?: {4}\/\/[^\n]*\n)* {4}files: \['\*\*\/\*\.\{js,mjs\}'\]/.test(ts), ts);
  check('TS 설정 문법 유효 (node --check)', spawnSync(process.execPath, ['--check', path.join(nt, 'server/eslint.config.mjs')]).status === 0);
  check('테스트 DB를 안 쓰면 워커별 DB는 해당 없음', /\[해당 없음\] B2 [^\n]*테스트 DB를 쓰지 않는다/.test(r.out) && !existsSync(path.join(nt, 'server/vitest.config.mjs')), r.out);

  console.log('하위 폴더 이름이 server/·client/가 아닌 구조 (결함 1·2)');
  const lt = project('ltms', LTMS);
  r = run(lt);
  const r2 = run(lt);
  check('루트에서 인자 없이 → exit 0, 두 하위 프로젝트 모두 표에', r.code === 0 && /\(app-server\)/.test(r.out) && /\(app-web\)/.test(r.out), r.out);
  check('Vite 클라이언트(설정 파일에만 globals.node)를 서버로 보지 않음 → B1·B2 해당 없음', /\[해당 없음\] B1 [^\n]*\(app-web\) — Node 서버가 아니다/.test(r.out) && /\[해당 없음\] B2 [^\n]*\(app-web\) — Node 서버가 아니다/.test(r.out), r.out);
  check('eslint 없는 서버 → B1 해당 없음, 테스트 DB 없음 → B2 해당 없음', /\[해당 없음\] B1 [^\n]*\(app-server\) — eslint 설정 없음/.test(r.out) && /\[해당 없음\] B2 [^\n]*\(app-server\) — 테스트 DB를 쓰지 않는다/.test(r.out), r.out);
  check('[수동] 0건 · 두 번 돌려도 같은 결과 · 파일 변경 없음', !/\[수동\]/.test(r.out) && r.out === r2.out && clean(lt), r.out);
  // 시작 경로와 git이 돌려주는 경로의 형태가 다를 때 — Windows 8.3 짧은 이름(RUNNER~1)·macOS /var → /private/var.
  // 링크(Windows는 관리자 권한이 필요 없는 junction)로 같은 상황을 만든다
  const link = path.join(work, 'ltms-link');
  symlinkSync(lt, link, 'junction');
  r = run(link);
  check('링크·짧은 이름 경로로 실행해도 저장소 기준 경로가 어긋나지 않음(../ 없음)', r.code === 0 && /\(app-server\)/.test(r.out) && !/\.\.\//.test(r.out) && !/대상:/.test(r.out), r.out);

  const sub = project('spring-sub', { ...Object.fromEntries(Object.entries(SPRING).map(([f, s]) => [f === 'CLAUDE.md' ? f : `api/${f}`, s])), '.github/workflows/test.yml': 'name: test\n' });
  run(sub, '--apply');
  check('하위 폴더의 Spring → 저장소 루트 CLAUDE.md 운영 정보 갱신', read(sub, 'CLAUDE.md').includes('Spring Boot 4.1.2') && /version '4\.1\.2'/.test(read(sub, 'api/build.gradle')));
  const sub2 = project('spring-sub-arg', Object.fromEntries(Object.entries(SPRING).map(([f, s]) => [f === 'CLAUDE.md' ? f : `api/${f}`, s])));
  r = run(path.join(sub2, 'api'), '--apply');
  check('하위 폴더를 인자로 줘도 저장소 단위 파일(루트 CLAUDE.md)은 루트에서', read(sub2, 'CLAUDE.md').includes('Spring Boot 4.1.2') && /\(대상: api\)/.test(r.out), r.out);

  const envp = project('env-in-project', { 'srv/package.json': NODE_JS['server/package.json'], 'srv/.env.example': 'TEST_DB_NAME=srv_test\nTEST_DB_USER=\nTEST_DB_PASSWORD=\nTEST_DB_PORT=3307\n', 'web/package.json': JSON.stringify({ name: 'web', dependencies: { react: '^19.0.0' } }) });
  r = run(envp, '--apply');
  check('.env.example이 프로젝트 폴더에 있으면 거기서 찾고 vitest 설정은 ./.env', read(envp, 'srv/vitest.config.mjs').includes("new URL('./.env'") && /TEST_DB_HOST=127\.0\.0\.1\nTEST_DB_NAME=/.test(read(envp, 'srv/.env.example')), r.out);
  const envr = project('env-at-root', { ...NODE_JS, 'client/package.json': JSON.stringify({ name: 'client', scripts: { lint: 'eslint .' }, dependencies: { react: '^19.0.0' } }) });
  r = run(envr);
  check('루트 .env.example에 테스트 DB가 있어도 클라이언트는 B2 해당 없음(엉뚱한 [수동] 없음)', /\[해당 없음\] B2 [^\n]*\(client\) — Node 서버가 아니다/.test(r.out) && !/\[수동\][^\n]*\(client\)/.test(r.out), r.out);

  console.log('B1 증상 판정 — ESLint를 실제로 불러 no-undef가 나는지로 본다');
  const s1 = project('b1-covered', { ...SERVER_NONTEMPLATE(true), ...FAKE_ESLINT });
  r = run(s1);
  check('템플릿이 아닌 설정이라도 no-undef가 안 나면 B1 해당 없음 ([수동] 아님)', /\[해당 없음\] B1 [^\n]*no-undef가 나지 않는다/.test(r.out) && !/\[수동\] B1/.test(r.out), r.out);
  const s2 = project('b1-broken', { ...SERVER_NONTEMPLATE(false), ...FAKE_ESLINT });
  r = run(s2);
  check('no-undef가 나는데 템플릿 형태가 아니면 [수동] + 파일 목록(B2가 만들 파일 포함)', /\[수동\] B1 [^\n]*no-undef: scripts\/migrate\.mjs, [^\n]*test-db\.global\.mjs\(B2가 만들 파일\)/.test(r.out), r.out);
  const s3 = project('b1-template', { ...NODE_JS, 'server/scripts/migrate.mjs': 'console.log(process.env.DB_NAME);\n', ...Object.fromEntries(Object.entries(FAKE_ESLINT).map(([f, s]) => [`server/${f}`, s])) });
  writeFileSync(path.join(s3, 'server', 'eslint.config.js'), NODE_JS['server/eslint.config.mjs']);   // 가짜 ESLint가 읽는 이름
  commitAll(s3);
  r = run(s3);
  check('no-undef가 나고 템플릿 형태면 적용 예정 + 원인 파일 표시', /\[적용 예정\] B1 [^\n]*'\*\*\/\*\.js' → '\*\*\/\*\.\{js,mjs\}' \(no-undef: server\/scripts\/migrate\.mjs/.test(r.out), r.out);

  console.log('ESLint 규칙 교체 — B3 SQL 보간 · B4 .jsx 순환');
  check('표본 전제: 이전 템플릿 형태가 현재 템플릿과 다르다', oldSql('eslint.config.server-js.mjs') !== tplText('eslint.config.server-js.mjs') && oldJsx() !== tplText('eslint.config.client-js.mjs'));
  const b3 = project('b3-js', {
    'server/package.json': NODE_JS['server/package.json'],
    'server/eslint.config.mjs': oldSql('eslint.config.server-js.mjs'),
    'server/src/item.js': "// eslint-disable-next-line no-restricted-syntax\nexport const q = (ids) => `SELECT * FROM t WHERE id IN (${ids.map((_, i) => `:id_${i}`).join(',')})`;\n",
  });
  r = run(b3, '--apply');
  check('이전 SQL 선택자(JS) → 현재 템플릿 블록으로 교체 (파일 전체가 현재 템플릿과 같다)', read(b3, 'server/eslint.config.mjs') === tplText('eslint.config.server-js.mjs') && /\[적용\] B3 /.test(r.out), r.out);
  check('no-restricted-syntax 끄기 주석이 있으면 [참고]', /\[참고\] B3 [^\n]*끄기 주석이 있는 파일 1개/.test(r.out), r.out);
  commitAll(b3);
  r = run(b3);
  check('재실행 → B3 이미 적용', /\[이미 적용\] B3 /.test(r.out) && clean(b3), r.out);
  const b3t = project('b3-ts', { 'server/package.json': NODE_JS['server/package.json'], 'server/eslint.config.mjs': oldSql('eslint.config.server.mjs') });
  r = run(b3t, '--apply');
  check('이전 SQL 선택자(TS) → 현재 템플릿과 같다', read(b3t, 'server/eslint.config.mjs') === tplText('eslint.config.server.mjs'), r.out);
  const custom = project('b3-custom', {
    'server/package.json': NODE_JS['server/package.json'],
    'server/eslint.config.mjs': oldSql('eslint.config.server-js.mjs').replace(OLD_SQL_BLOCK, () => "          // 프로젝트가 고친 규칙\n          selector: 'TemplateLiteral > MemberExpression[object.name=\"queryParams\"]',\n          message: 'SQL에 요청 값 직접 보간 금지 — 프로젝트 문구',\n"),
  });
  r = run(custom, '--apply');
  check('프로젝트가 직접 고친 규칙(새 메시지)은 되돌리지 않음 → 이미 적용', /\[이미 적용\] B3 /.test(r.out) && clean(custom), r.out);
  const odd = project('b3-odd', { 'server/package.json': NODE_JS['server/package.json'], 'server/eslint.config.mjs': oldSql('eslint.config.server-js.mjs').replace('// sql.md 7절 — 문자열 연결로 쿼리를 조립하지 않는다 (인젝션)', '// 인젝션 방지') });
  r = run(odd);
  check('이전 선택자는 있는데 주변 형태가 다르면 [수동]', /\[수동\] B3 [^\n]*이전 SQL 선택자가 있지만/.test(r.out), r.out);
  const b4 = project('b4', { 'client/package.json': CLIENT_PKG, 'client/eslint.config.mjs': oldJsx(), 'client/src/App.jsx': 'export const App = () => null;\n' });
  r = run(b4, '--apply');
  check('.jsx가 있는 JS 클라이언트 → import-x/extensions 추가 (현재 템플릿과 같다)', read(b4, 'client/eslint.config.mjs') === tplText('eslint.config.client-js.mjs') && /\[적용\] B4 /.test(r.out), r.out);
  commitAll(b4);
  r = run(b4);
  check('재실행 → B4 이미 적용 · 클라이언트에 B3 해당 없음', /\[이미 적용\] B4 /.test(r.out) && /\[해당 없음\] B3 [^\n]*Node 서버가 아니다/.test(r.out) && clean(b4), r.out);
  const b4n = project('b4-nojsx', { 'client/package.json': CLIENT_PKG, 'client/eslint.config.mjs': oldJsx(), 'client/src/main.js': 'export const main = () => null;\n' });
  r = run(b4n);
  check('.jsx가 없으면 B4 해당 없음', /\[해당 없음\] B4 [^\n]*\.jsx 파일이 없다/.test(r.out), r.out);

  console.log('프로젝트 아님');
  mkdirSync(path.join(work, 'empty'));
  check('package.json·build.gradle 없으면 exit 2', run(path.join(work, 'empty')).code === 2);
} finally {
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}

console.log(failed ? `결과: 실패 ${failed}건` : '결과: 통과');
process.exit(failed ? 1 : 0);
