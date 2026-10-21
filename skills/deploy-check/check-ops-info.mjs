// 운영 정보·정기 점검 확인 — 프로젝트 CLAUDE.md의 "운영 정보"·"정기 점검" 표를 읽어
// 비어 있는 운영 정보(<미정>)와 기한이 지난 정기 점검을 보고한다 (scaffolds/default.md CLAUDE.md 템플릿).
// /deploy-check(미정 → 배포 불가)와 /work-log(기한 초과 보고)가 실행한다. 기억 대신 날짜 계산으로 판정한다.
//
// 사용법: 프로젝트 루트에서  node ~/.claude/skills/deploy-check/check-ops-info.mjs [CLAUDE.md 경로] [--today YYYY-MM-DD]
// 종료 코드: 0 문제 없음 / 1 미정 또는 기한 초과 있음 / 2 표가 없음(템플릿 이전 프로젝트 — 표를 추가하라는 안내)

import { readFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const todayArg = args.indexOf('--today');
const today = todayArg >= 0 ? args[todayArg + 1] : new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });   // 한국 날짜
const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--today') ?? 'CLAUDE.md';
if (!existsSync(file)) {
  console.log(`${file}이 없다`);
  process.exit(2);
}
const md = readFileSync(file, 'utf8');

// "## 제목" 절의 표를 행 배열로 — 머리글·구분선은 건너뛴다
function table(title) {
  const start = md.search(new RegExp(`^## ${title}\\s*$`, 'm'));
  if (start < 0) return null;
  const body = md.slice(start).split('\n').slice(1);
  const end = body.findIndex((l) => /^## /.test(l));
  return (end < 0 ? body : body.slice(0, end))
    .filter((l) => /^\|/.test(l) && !/^\|\s*-/.test(l))
    .slice(1)                                                  // 머리글
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
}

const info = table('운영 정보');
const duties = table('정기 점검');
if (!info || !duties) {
  console.log('운영 정보·정기 점검 표가 없다 — ~/.claude/jyp/scaffolds/default.md의 CLAUDE.md 템플릿에서 두 절을 복사해 채운다');
  process.exit(2);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD_DAYS = { '월 1회': 31, '분기 1회': 92, '반기 1회': 183, '연 1회': 366 };
const addDays = (d, n) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);

const problems = [];
const notes = [];

// 1) 운영 정보 — <미정>이 남은 항목
for (const [item, value] of info) {
  if (value.includes('<미정>')) problems.push(`[미정] 운영 정보 — ${item}`);
}
const openedRow = info.find(([item]) => item.startsWith('운영 개시일'));
const opened = openedRow && DATE.test(openedRow[1]) ? openedRow[1] : null;

// 2) 정기 점검 — 기한 = 마지막 수행일(없으면 운영 개시일) + 주기. 운영 개시 전이고 수행 기록도 없으면 판정하지 않는다
for (const [duty, period, last] of duties) {
  if (period.includes('해당 없음')) continue;
  if (period.includes('<미정>')) { problems.push(`[미정] 정기 점검 주기 — ${duty}`); continue; }
  const days = PERIOD_DAYS[period.replace(/\s+/g, ' ')];
  if (!days) { problems.push(`[형식] 정기 점검 주기를 읽을 수 없다 — ${duty}: "${period}" (월 1회·분기 1회·반기 1회·연 1회·해당 없음)`); continue; }
  const base = DATE.test(last) ? last : opened;
  if (!base) { notes.push(`운영 개시 전 — ${duty} (${period})`); continue; }
  const due = addDays(base, days);
  const left = daysBetween(today, due);
  if (left < 0) problems.push(`[기한 초과] ${duty} — 기한 ${due} (${-left}일 지남, ${DATE.test(last) ? `마지막 ${last}` : `수행 기록 없음, 운영 개시 ${opened}`})`);
  else if (left <= 14) notes.push(`곧 기한 — ${duty}: ${due} (${left}일 남음)`);
}

console.log(`운영 정보·정기 점검 확인 (${file}, 기준일 ${today})`);
for (const p of problems) console.log(`  ✗ ${p}`);
if (problems.length === 0) console.log('  ✓ 미정·기한 초과 없음');
for (const n of notes) console.log(`  · ${n}`);
process.exit(problems.length ? 1 : 0);
