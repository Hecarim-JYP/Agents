// 고정 버전 점검 — 템플릿·문서에 박아 둔 버전이 현행 배포본·지원 정책보다 낡았는지 확인한다.
// 고정값은 아무도 고치지 않으면 조용히 낡는다. (실제 사고: 2026-10-21 CI 템플릿의 Actions가 전부
// Node 20 런타임 메이저로 남아 매 실행 경고 — 차수마다 하던 수동 점검이 Actions를 범위에 넣지 않아 놓쳤다)
//
// 대상 파일(FILES)에서 아래 형태를 찾아, 형태별 규칙으로 "지금 있어야 할 값"을 조회해 비교한다.
//   uses: owner/repo@vN                      → GitHub 태그의 최신 메이저
//   이미지:태그 (IMAGES에 등록한 이미지)        → 이미지별 정책 (LTS·안정 계열·최신 메이저)
//   id '플러그인' version 'X'                 → Gradle 플러그인 포털의 최신 정식
//   'group:artifact:X' / toolVersion = 'X'   → Maven Central의 최신 정식 (toolVersion은 Checkstyle)
//   --gradle-version X                       → Gradle 최신
//   npm i -D 패키지@X                         → npm 최신 메이저
//   node-version / java-version / JavaLanguageVersion.of(N) → Node·Java 최신 LTS
// LTS·지원 종료 정보는 endoflife.date의 원본 데이터(GitHub 저장소)를 읽는다 — API 도메인이 막힌 환경에서도 같은 결과.
//
// 일부러 최신이 아닌 값(호환성 고정)은 "고정 사유"를 조회해 비교한다 — 사유가 사라지면 다시 빨간불이 켜진다:
//   Flyway 이미지 = Spring Boot가 관리하는 Flyway 메이저 / TypeScript = typescript-eslint가 허용하는 최대 메이저.
// 사유를 기계로 확인할 수 없는 고정은 HOLDS에 기한과 함께 둔다 — 기한이 지나면 다시 실패한다.
//
// 사용법: 저장소 루트에서  node scripts/check-versions.mjs [--all]   (네트워크 필요, --all이면 통과 항목도 출력)
// 낡은 값·조회 실패·규칙이 없는 새 이미지가 있으면 exit 1 — CI(verify.yml)가 주 1회 실행한다.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TODAY = process.env.CHECK_TODAY ?? new Date().toISOString().slice(0, 10);   // CHECK_TODAY: 날짜를 바꿔 정책 전환을 미리 확인

// 고정값이 사는 곳 — 레시피의 실측 표(“pdf-lib 1.17.1로 실측”)는 기록이지 고정값이 아니므로 넣지 않는다
const FILES = [
  'scaffolds/default.md', 'scaffolds/templates', '.github/workflows',
  'conventions/docker.md', 'conventions/spring.md',
  'conventions/features/seo.md', 'conventions/features/pdf-output.md',
];

// 정책상 최신이 아닌 쪽을 고른 고정 — 사유와 재검토 기한 (키: "종류:이름")
const HOLDS = {
  'image:mariadb': {
    until: '2027-04-21',
    reason: '11.4 LTS 유지 — 12.3 LTS와 지원 종료일이 2주 차이라 출시 2년이 넘은 쪽을 택함 (2026-10-20 결정, database.md 1절)',
  },
};

// ── 조회 (같은 URL은 한 번만, 일시 오류는 3회까지 재시도) ──────────────────────
const cache = new Map();
function get(url, as = 'json') {
  if (!cache.has(url)) {
    cache.set(url, (async () => {
      for (let attempt = 1; ; attempt++) {
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return as === 'json' ? await res.json() : await res.text();
        } catch (e) {
          if (attempt === 3) throw new Error(`${url} — ${e.message}`);
          await new Promise((r) => setTimeout(r, 1000 * attempt));
        }
      }
    })());
  }
  return cache.get(url);
}

const nums = (v) => (String(v).match(/\d+/g) ?? []).map(Number);
const major = (v) => nums(v)[0];
const cmp = (a, b) => {                       // 숫자 마디끼리 비교 — '1.10' > '1.9'
  const x = nums(a), y = nums(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d;
  }
  return 0;
};
const STABLE = /^\d+(\.\d+)*$/;               // 정식 릴리스만 — M1·RC·SNAPSHOT·beta 제외
const newest = (list) => list.filter((v) => STABLE.test(v)).sort(cmp).at(-1);

async function mavenLatest(base, group, artifact) {
  const xml = await get(`${base}/${group.replaceAll('.', '/')}/${artifact}/maven-metadata.xml`, 'text');
  return newest([...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]));
}
const centralLatest = (ga) => mavenLatest('https://repo1.maven.org/maven2', ...ga.split(':'));
const pluginLatest = (id) => mavenLatest('https://plugins.gradle.org/m2', id, `${id}.gradle.plugin`);
const npmLatest = async (pkg) => (await get(`https://registry.npmjs.org/${pkg}/latest`)).version;
const gradleLatest = async () => (await get('https://services.gradle.org/versions/current')).version;

// GitHub 태그는 git으로 읽는다 — API 토큰·호출 한도와 무관
const tagCache = new Map();
function githubLatestMajor(name) {
  if (!tagCache.has(name)) {
    const out = execFileSync('git', ['ls-remote', '--tags', `https://github.com/${name}.git`], { encoding: 'utf8' });
    tagCache.set(name, Math.max(...[...out.matchAll(/refs\/tags\/v(\d+)\.\d+\.\d+$/gm)].map((m) => Number(m[1]))));
  }
  return tagCache.get(name);
}

// endoflife.date 원본: products/<제품>.md 앞머리의 releases 목록 (releaseCycle·lts·eol 등)
async function releases(product) {
  const md = await get(`https://raw.githubusercontent.com/endoflife-date/endoflife.date/master/products/${product}.md`, 'text');
  const block = md.split(/^releases:\s*$/m)[1].split(/^---\s*$/m)[0];
  return block.split(/^\s*-\s+(?=releaseCycle:)/m).slice(1).map((item) => Object.fromEntries(
    [...item.matchAll(/^\s*(\w+):\s*"?([^"#\n]*?)"?\s*(?:#.*)?$/gm)].map((m) => [m[1], m[2]])));
}
// lts가 true이거나 이미 지난 날짜면 LTS (Node는 LTS 승격일을 미리 적어 둔다 — 그 전에는 Current)
const ltsNow = (r) => r.lts === 'true' || (/^\d{4}-\d{2}-\d{2}$/.test(r.lts ?? '') && r.lts <= TODAY);
const latestLts = async (product) => (await releases(product)).filter(ltsNow).map((r) => r.releaseCycle).sort(cmp).at(-1);
// nginx 안정 계열 = 짝수 마이너 중 지원 중인 최신 (홀수는 mainline)
const nginxStable = async () => (await releases('nginx'))
  .filter((r) => nums(r.releaseCycle)[1] % 2 === 0 && (r.eol === 'false' || r.eol > TODAY))
  .map((r) => r.releaseCycle).sort(cmp).at(-1);

async function dockerHubLatestMajor(image, suffix) {
  const [ns, name] = image.includes('/') ? image.split('/') : ['library', image];
  const j = await get(`https://hub.docker.com/v2/namespaces/${ns}/repositories/${name}/tags?page_size=100&name=${suffix}`);
  return Math.max(...j.results.map((t) => t.name).filter((t) => new RegExp(`^\\d+-${suffix}$`).test(t)).map(major));
}
const playwrightLatest = async () => (await get('https://mcr.microsoft.com/v2/playwright/tags/list')).tags
  .filter((t) => /^v\d+\.\d+\.\d+-noble$/.test(t)).sort(cmp).at(-1);

// 템플릿이 고정한 Spring Boot가 관리하는 의존성 버전 (예: flyway.version)
async function bootManaged(property) {
  const boot = readFileSync(path.join(repo, 'scaffolds/templates/build.gradle'), 'utf8')
    .match(/id 'org\.springframework\.boot' version '([^']+)'/)[1];
  const pom = await get(`https://repo1.maven.org/maven2/org/springframework/boot/spring-boot-dependencies/${boot}/spring-boot-dependencies-${boot}.pom`, 'text');
  return pom.match(new RegExp(`<${property.replaceAll('.', '\\.')}>([^<]+)<`))[1];
}
// typescript-eslint가 peerDependencies로 허용하는 TypeScript 최대 메이저 (예: "<6.1.0" → 6, "<7.0.0" → 6)
async function tsAllowedMajor() {
  const peer = (await get('https://registry.npmjs.org/typescript-eslint/latest')).peerDependencies.typescript;
  const [x, y = 0, z = 0] = nums(peer.match(/<\s*([\d.]+)/)[1]);
  return y === 0 && z === 0 ? x - 1 : x;
}

// ── 이미지별 정책: 현재 태그 → 있어야 할 태그 (접미사 -slim·-alpine 등은 유지) ──────
const IMAGES = {
  node: async (t) => t.replace(/^\d+/, await latestLts('nodejs')),
  'eclipse-temurin': async (t) => t.replace(/^\d+/, await latestLts('eclipse-temurin')),
  mariadb: async (t) => t.replace(/^[\d.]+/, await latestLts('mariadb')),
  'nginxinc/nginx-unprivileged': async (t) => t.replace(/^[\d.]+/, await nginxStable()),
  caddy: async (t) => t.replace(/^\d+/, await dockerHubLatestMajor('caddy', 'alpine')),
  'flyway/flyway': async (t) => t.replace(/^\d+/, major(await bootManaged('flyway.version'))),
  'mcr.microsoft.com/playwright': async (t) => t.replace(/^v[\d.]+/, (await playwrightLatest()).replace(/-noble$/, '')),
  gradle: async () => `${major(await gradleLatest())}-jdk${await latestLts('eclipse-temurin')}`,
};

// ── 종류별 규칙: 현재 값 → 있어야 할 값 ─────────────────────────────────────
const RULES = {
  action: async (name) => `v${githubLatestMajor(name)}`,
  image: async (name, cur) => IMAGES[name](cur),
  'gradle-plugin': async (name) => pluginLatest(name),
  maven: async (name) => centralLatest(name),
  gradle: async () => gradleLatest(),
  checkstyle: async () => centralLatest('com.puppycrawl.tools:checkstyle'),
  npm: async (name, cur) => {
    const want = name === 'typescript' ? await tsAllowedMajor() : major(await npmLatest(name));
    return major(cur) === want ? cur : `${want}.x`;
  },
  node: async () => latestLts('nodejs'),
  java: async () => latestLts('eclipse-temurin'),
};

// ── 고정값 찾기 ───────────────────────────────────────────────────────────
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const KNOWN_IMAGE = new RegExp(`(?<![\\w./-])(${Object.keys(IMAGES).map(esc).join('|')}):(v?\\d[\\w.-]*)`, 'g');
const PATTERNS = [                            // [종류, 정규식, 이름 그룹 여부] — 이름이 없으면 종류가 곧 이름
  ['action', /uses:\s*([\w.-]+\/[\w.-]+)@(v\d+)/g, true],
  ['image', KNOWN_IMAGE, true],
  ['gradle-plugin', /id\s+'([\w.-]+)'\s+version\s+'([^']+)'/g, true],
  ['maven', /'([\w.-]+:[\w.-]+):(\d[\w.]*)(?::[\w-]+)?'/g, true],
  ['checkstyle', /toolVersion\s*=\s*'([^']+)'/g, false],
  ['gradle', /--gradle-version\s+(\d+(?:\.\d+)+)(?![\w.])/g, false],   // '9.x' 같은 서술은 제외
  ['node', /node-version:\s*'?(\d+)/g, false],
  ['java', /java-version:\s*'?(\d+)|JavaLanguageVersion\.of\((\d+)\)/g, false],
];

function* walk(rel) {
  const abs = path.join(repo, rel);
  if (statSync(abs).isDirectory()) for (const f of readdirSync(abs)) yield* walk(path.join(rel, f));
  else yield rel;
}

const pins = [];
const unknown = [];
for (const file of FILES.flatMap((f) => [...walk(f)])) {
  readFileSync(path.join(repo, file), 'utf8').split('\n').forEach((line, i) => {
    const at = `${file}:${i + 1}`;
    for (const [kind, re, named] of PATTERNS) {
      for (const m of line.matchAll(re)) {
        const g = m.slice(1);
        const [name, cur] = named ? g : [kind, g.find((v) => v !== undefined)];   // java는 대안 두 개 중 맞은 쪽
        pins.push({ at, kind, name, cur });
      }
    }
    if (/npm (i|install)\b/.test(line)) {
      for (const m of line.matchAll(/(?<=\s)(@?[\w.-]+(?:\/[\w.-]+)?)@([~^]?\d[\w.]*)/g)) pins.push({ at, kind: 'npm', name: m[1], cur: m[2] });
    }
    // 규칙이 없는 이미지 — 새 고정값이 점검 밖에서 낡지 않게 알린다 (<자리표시자>·${변수}는 제외)
    const img = line.match(/(?:^|\s)(?:FROM|image:)\s+([^\s:<$]+):([^\s<$]+)/);
    if (img && !(img[1] in IMAGES) && !/[<$]/.test(line)) unknown.push(`${at} ${img[1]}:${img[2]} — 점검 규칙 없음 (IMAGES에 정책 추가)`);
  });
}

// ── 비교·출력 ─────────────────────────────────────────────────────────────
const all = process.argv.includes('--all');
const lines = [];
let fail = unknown.length;
let held = 0;
await Promise.all(pins.map(async (p) => {
  const label = `${p.at} ${p.name} ${p.cur}`;
  let want;
  try {
    want = String(await RULES[p.kind](p.name, p.cur));
  } catch (e) {
    fail++;
    lines.push(`? ${label} — 조회 실패: ${e.message}`);
    return;
  }
  if (want === p.cur) {
    if (all) lines.push(`✓ ${label}`);
    return;
  }
  const hold = HOLDS[`${p.kind}:${p.name}`];
  if (hold && TODAY <= hold.until) {
    held++;
    lines.push(`⏸ ${label} → ${want} 보류(~${hold.until}): ${hold.reason}`);
    return;
  }
  fail++;
  lines.push(`✗ ${label} → ${want}${hold ? ` (보류 기한 ${hold.until} 지남 — 재검토)` : ''}`);
}));

lines.sort();
console.log([...lines, ...unknown.map((u) => `? ${u}`)].join('\n'));
console.log(`검사: 고정값 ${pins.length}건 / 낡음·조회 실패·규칙 없음 ${fail}건 / 보류 ${held}건`);
process.exit(fail ? 1 : 0);
