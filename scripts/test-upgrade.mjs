// 업그레이드 스크립트 검사 — skills/project-upgrade/upgrade.mjs를 예전 템플릿 형태의 표본 프로젝트에 돌려 판정·적용·멱등성을 확인한다.
// 단계를 고치거나 템플릿이 바뀌면 "예전 프로젝트를 새 템플릿 형태로 옮긴다"는 약속이 조용히 깨질 수 있다 — 사람의 확인 대신 여기서 막는다.
// 표본은 2026-10-27 이전 템플릿에서 업그레이드가 건드리는 부분만 담는다(빌드·테스트 실행은 하지 않는다 — 단계를 바꾸면
// 예전 템플릿으로 만든 실제 프로젝트에서 gradlew check / npm run lint·test까지 직접 확인한다: 저장소 CLAUDE.md 검증 항목).
//
// 사용법: 저장소 루트에서  node scripts/test-upgrade.mjs   (CI verify.yml·verify-windows.yml이 push/PR마다 실행)

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
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
const read = (dir, f) => readFileSync(path.join(dir, f), 'utf8');
const clean = (dir) => git(dir, 'status', '--porcelain').trim() === '';
const commitAll = (dir) => { git(dir, 'add', '-A'); git(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'upgrade'); };

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

  console.log('프로젝트 아님');
  mkdirSync(path.join(work, 'empty'));
  check('package.json·build.gradle 없으면 exit 2', run(path.join(work, 'empty')).code === 2);
} finally {
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}

console.log(failed ? `결과: 실패 ${failed}건` : '결과: 통과');
process.exit(failed ? 1 : 0);
