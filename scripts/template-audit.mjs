// 템플릿 자체의 의존성 취약점 검사 — Spring build.gradle 템플릿으로 프로젝트를 조립하고,
// scaffolds/default.md의 audit.yml 템플릿에서 audit-server 단계(run 블록)를 그대로 꺼내 실행한다.
// 생성된 프로젝트는 각자 audit.yml이 검사하지만, 템플릿의 고정값(Boot 버전·보안 패치 덮어쓰기)은 아무도 검사하지 않았다.
// (실제 사고: 2026-10-21까지 템플릿 그대로 만든 프로젝트에 알려진 취약점 10건 — 수동 확인 전까지 경고 없음)
// check-versions.mjs는 새 릴리스가 나와야 알린다. 지금 고정한 버전에 새 취약점이 공개되는 경우는 여기서 잡는다.
//
// 사용법: 저장소 루트에서
//   node scripts/template-audit.mjs            템플릿 그대로 — 통과해야 한다 (high 이상 0건)
//   node scripts/template-audit.mjs --control  대조군 — 알려진 취약 의존성(log4j-core 2.14.1)을 넣으면 반드시 실패해야 한다.
//                                              통과하면 검사 단계가 고장 난 것이므로 실패로 보고한다 (판정을 뒤집는다)
// 필요: JDK(템플릿 toolchain 버전), PATH의 gradle(래퍼 생성용 — GitHub ubuntu 러너에 기본 설치), curl, jq, 네트워크
// 이 저장소 검증 환경처럼 api.osv.dev가 막힌 곳에서는 TEMPLATE_AUDIT_OSV_FLAGS="--offline-vulnerabilities --download-offline-databases"

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, mkdtempSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const control = process.argv.includes('--control');
const read = (rel) => readFileSync(path.join(repo, rel), 'utf8');

// 1) audit.yml 템플릿에서 audit-server job의 run 블록을 순서대로 꺼낸다 — 검사 로직을 여기에 다시 쓰지 않는다(SSOT)
function auditServerSteps() {
  const md = read('scaffolds/default.md');
  const section = md.slice(md.indexOf('### .github/workflows/audit.yml'));
  const yaml = section.match(/```yaml\n([\s\S]*?)```/)[1].split('\n');
  const start = yaml.findIndex((l) => /^ {2}audit-server:/.test(l));
  if (start < 0) throw new Error('audit.yml 템플릿에 audit-server job이 없다');
  const steps = [];
  for (let i = start + 1; i < yaml.length && !/^ {2}\S/.test(yaml[i]); i++) {
    if (!/^ {6}- run: \|\s*$/.test(yaml[i])) continue;
    const body = [];
    for (i++; i < yaml.length && (/^ {10}/.test(yaml[i]) || yaml[i].trim() === ''); i++) body.push(yaml[i].slice(10));
    i--;
    steps.push(body.join('\n').trim());
  }
  if (steps.length === 0) throw new Error('audit-server job에서 run 블록을 찾지 못했다');
  return steps;
}

// 2) 템플릿 그대로 조립 — 소스 코드는 필요 없다(의존성 해석만 한다)
function assemble() {
  const work = mkdtempSync(path.join(tmpdir(), 'template-audit-'));
  const server = path.join(work, 'server');
  mkdirSync(path.join(server, 'gradle'), { recursive: true });
  let gradle = read('scaffolds/templates/build.gradle').replaceAll('{base.package}', 'com.example');
  if (control) {
    // 알려진 취약 버전 — 이것이 걸리지 않으면 검사 단계(잠금 파일·osv-scanner·CVSS 필터)가 고장 난 것이다
    gradle = gradle.replace(/dependencies \{\n/, "dependencies {\n    implementation 'org.apache.logging.log4j:log4j-core:2.14.1'\n");
  }
  writeFileSync(path.join(server, 'build.gradle'), gradle);
  writeFileSync(path.join(server, 'settings.gradle'), "rootProject.name = 'template-audit'\n");
  copyFileSync(path.join(repo, 'scaffolds/templates/osv-lock.gradle'), path.join(server, 'gradle/osv-lock.gradle'));
  // 래퍼 버전은 spring.md 0절의 생성 명령이 정한 값 (check-versions.mjs가 추적하는 고정값)
  const version = read('conventions/spring.md').match(/--gradle-version\s+(\d+(?:\.\d+)+)/)[1];
  execFileSync('gradle', ['wrapper', '--gradle-version', version, '-q'], { cwd: server, stdio: 'inherit' });
  return { work, server, version };
}

const steps = auditServerSteps();
const { work, server, version } = assemble();
const osvFlags = process.env.TEMPLATE_AUDIT_OSV_FLAGS;
console.log(`조립: ${server} (Gradle ${version}${control ? ', 대조군 — log4j-core 2.14.1 추가' : ''}) / 검사 단계 ${steps.length}개`);

// 3) audit.yml과 같은 셸 옵션(bash -e -o pipefail)으로 단계마다 실행
let failed = null;
for (const [n, script] of steps.entries()) {
  const run = osvFlags ? script.replaceAll('scan source ', `scan source ${osvFlags} `) : script;
  const r = spawnSync('bash', ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', run], {
    cwd: server, stdio: 'inherit', env: { ...process.env, RUNNER_TEMP: process.env.RUNNER_TEMP ?? work },
  });
  if (r.status !== 0) { failed = { step: n + 1, last: n === steps.length - 1, code: r.status }; break; }
}

if (!control) {
  console.log(failed ? `결과: 실패 — ${failed.step}단계 exit ${failed.code}` : '결과: 통과 — 운영 의존성에 high 이상 취약점 없음');
  process.exit(failed ? 1 : 0);
}
// 대조군: 마지막 단계(CVSS 필터)가 exit 1(취약점 있음)로 끝나야 정상. 통과했거나 도구 오류(exit 2 이상)면 고장
const ok = failed?.last && failed.code === 1;
console.log(ok ? '대조군: 정상 — 알려진 취약 의존성을 검출했다'
  : failed ? `대조군: 고장 — ${failed.step}단계 exit ${failed.code}(검출이 아니라 도구 오류)` : '대조군: 고장 — 알려진 취약 의존성이 통과했다');
process.exit(ok ? 0 : 1);
