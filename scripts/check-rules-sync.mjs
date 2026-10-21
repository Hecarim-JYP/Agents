// dev-rules 요약 동기화 검사 — 컨벤션에 새로 확정된 STRICT·MANDATORY가 dev-rules.md 요약 확인 뒤에 생겼는지 본다.
// dev-rules.md는 모든 프로젝트에 항상 로드되고 컨벤션 본문은 필요할 때만 읽힌다 — 요약에 없는 강제 규칙은 사실상 안 보인다.
// 저장소 CLAUDE.md의 "STRICT 항목을 신설·폐기하면 dev-rules 요약을 함께 확인한다"를 사람의 기억 대신 여기서 강제한다.
// (실제 사고: 2026-10-21 8~10차가 STRICT·MANDATORY 7건을 확정하는 동안 dev-rules는 한 번도 갱신되지 않았다)
//
// 대상: conventions/*.md(레시피 features/는 제외 — dev-rules는 레시피를 catalog.md 확인 규칙 하나로 대신한다)의
//       "(STRICT …YYYY-MM-DD…)" / "(MANDATORY …YYYY-MM-DD…)" 표기. 날짜 없는 표기는 판단할 수 없어 세지 않는다.
// 기준: dev-rules.md 머리 주석의 "요약 확인일: YYYY-MM-DD". 그보다 늦은 확정이 있으면 나열하고 exit 1.
// 고치는 법: 나열된 항목을 dev-rules 요약에 반영할지 판단해(구체 값 없이 금지·결정 항목명만) 반영하고, 확인일을 그 날짜로 올린다.
// 한계: 날짜 단위라 확인일과 같은 날 새로 확정한 항목은 구분하지 못한다 — 그날 확정했다면 커밋 전에 직접 확인한다.
//
// 사용법: 저장소 루트에서  node scripts/check-rules-sync.mjs   (CI verify.yml이 push/PR마다 실행)

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rules = readFileSync(path.join(repo, 'rules/dev-rules.md'), 'utf8');
const reviewed = rules.match(/요약 확인일:\s*(\d{4}-\d{2}-\d{2})/)?.[1];
if (!reviewed) {
  console.error('dev-rules.md 머리 주석에 "요약 확인일: YYYY-MM-DD"가 없다');
  process.exit(1);
}

const dir = path.join(repo, 'conventions');
const late = [];
let total = 0;
for (const name of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
  readFileSync(path.join(dir, name), 'utf8').split('\n').forEach((line, i) => {
    for (const m of line.matchAll(/\((?:STRICT|MANDATORY)[^)]*?(\d{4}-\d{2}-\d{2})[^)]*\)/g)) {
      total++;
      if (m[1] > reviewed) late.push(`conventions/${name}:${i + 1} ${m[1]} — ${line.trim().slice(0, 90)}`);
    }
  });
}

console.log(`검사: 날짜 있는 STRICT·MANDATORY ${total}건 / dev-rules 요약 확인일 ${reviewed}`);
if (late.length === 0) {
  console.log('결과: 통과 — 확인일 뒤에 확정된 강제 규칙이 없다');
  process.exit(0);
}
console.log(`결과: 실패 — 확인일 뒤에 확정된 ${late.length}건. dev-rules 요약 반영을 판단하고 확인일을 올린다:`);
for (const l of late) console.log(`  ${l}`);
process.exit(1);
