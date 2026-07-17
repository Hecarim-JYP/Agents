// 문서 간 상호 참조 검사 — Node만 있으면 어디서든 실행된다.
// 문서끼리 "auth.md 0절", "docker.md 4-1절", "spring.md 5·6절"처럼 서로를 가리키는데,
// 절을 개편·삭제하면 그 참조가 조용히 깨진다. 읽는 사람은 없는 절을 찾아 헤매게 된다.
// (실제 사고: migration.md 5절이 금지된 방식을 가리키고 있던 것 — 2026-07-17)
//
// 절 정의는 "## N. 제목" / "### N-M. 제목" 형태를 인식한다.
// 과거 기록(dev_log·incidents)은 제외 — 그 시점 기준으로 쓰인 것이라 개편 시 깨지는 게 정상이다.
//
// 사용법: 저장소 루트에서  node scripts/check-refs.mjs
// 문제가 있으면 exit 1 (CI·훅에 물릴 수 있다)

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['conventions', 'scaffolds', 'profiles', 'rules', 'docs'];
const SKIP = /[\\/](dev_log|incidents)[\\/]/;

// 1) 각 문서가 정의한 절 번호 수집
const sections = new Map();   // 'auth.md' -> Set('0', '1', '4-1', ...)
const files = [];
for (const dir of DIRS) {
  const base = path.join(repo, dir);
  if (!existsSync(base)) continue;
  for (const entry of readdirSync(base, { recursive: true })) {
    const rel = path.join(base, String(entry));
    if (!rel.endsWith('.md') || SKIP.test(rel)) continue;
    files.push(rel);
    const name = path.basename(rel);
    const set = sections.get(name) ?? new Set();
    for (const m of readFileSync(rel, 'utf8').matchAll(/^#{2,3}\s+(\d+(?:-\d+)?)\./gm)) set.add(m[1]);
    sections.set(name, set);
  }
}

// 2) 참조를 추출해 대조
const problems = [];
let refCount = 0;
for (const file of files) {
  const from = path.relative(repo, file);
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/([a-z0-9_.-]+\.md)\s+((?:\d+(?:-\d+)?)(?:[·,]\s*\d+(?:-\d+)?)*)\s*절/g)) {
    const [full, target, numPart] = m;
    const nums = numPart.split(/[·,]\s*/);
    refCount += nums.length;
    if (!sections.has(target)) {
      problems.push(`${from}: '${target}' 파일을 찾을 수 없다 — "${full}"`);
      continue;
    }
    for (const n of nums) {
      if (!sections.get(target).has(n)) problems.push(`${from}: ${target}에 ${n}절이 없다 — "${full}"`);
    }
  }
}

console.log(`검사: 문서 ${files.length}개 / 참조 ${refCount}건`);
if (problems.length === 0) {
  console.log('결과: 통과 — 모든 참조가 실재하는 절을 가리킨다');
  process.exit(0);
}
console.log(`결과: 실패 — 깨진 참조 ${problems.length}건`);
for (const p of [...new Set(problems)]) console.log('  ' + p);
process.exit(1);
