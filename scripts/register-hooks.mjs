// ~/.claude/settings.json에 이 저장소의 훅 2종을 등록한다 (install.ps1 / install.sh가 호출).
// 사용자의 다른 설정(model·theme·다른 훅)은 보존하고, 우리 훅 항목만 추가·갱신한다.
// 파일이 없으면 새로 만든다. UTF-8(BOM 없음)로 쓴다 — BOM이 있으면 설정이 조용히 무시될 수 있다.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const settingsPath = path.join(homedir(), '.claude', 'settings.json');

// 등록할 훅 — command의 스크립트 파일명이 "우리 훅"의 식별자다
const ENTRIES = [
  {
    event: 'PostToolUse',
    script: 'post-edit-check.mjs',
    entry: {
      matcher: 'Write|Edit',
      hooks: [
        {
          type: 'command',
          command: 'node "$HOME/.claude/hooks/post-edit-check.mjs"',
          timeout: 180,
          statusMessage: 'lint/typecheck 검사 중...',
        },
      ],
    },
  },
  {
    event: 'Stop',
    script: 'stop-test.mjs',
    entry: {
      hooks: [
        {
          type: 'command',
          command: 'node "$HOME/.claude/hooks/stop-test.mjs"',
          timeout: 300,
          statusMessage: '턴 종료 전 테스트 실행 중...',
        },
      ],
    },
  },
];

let settings = {};
if (existsSync(settingsPath)) {
  const raw = readFileSync(settingsPath, 'utf8').replace(/^﻿/, '');
  try {
    settings = JSON.parse(raw);
  } catch {
    // 깨진 JSON을 덮어쓰면 사용자의 다른 설정이 사라진다 — 손대지 않고 중단한다
    console.error(`[훅 등록 실패] settings.json이 유효한 JSON이 아닙니다: ${settingsPath}`);
    console.error('  파일을 고친 뒤 install을 다시 실행하세요 (다른 설정 보호를 위해 덮어쓰지 않았습니다).');
    process.exit(1);
  }
} else {
  mkdirSync(path.dirname(settingsPath), { recursive: true });
}

settings.hooks ??= {};
const changed = [];

for (const { event, script, entry } of ENTRIES) {
  const list = Array.isArray(settings.hooks[event]) ? settings.hooks[event] : [];
  // 우리 훅(스크립트 파일명으로 식별)만 걷어내고 최신 정의로 다시 넣는다 — 사용자의 다른 훅은 그대로 둔다
  const others = list.filter(
    (g) => !(g?.hooks ?? []).some((h) => typeof h?.command === 'string' && h.command.includes(script)),
  );
  if (others.length !== list.length) changed.push(`${event}: ${script} 갱신`);
  else changed.push(`${event}: ${script} 추가`);
  settings.hooks[event] = [...others, entry];
}

writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
console.log(`  훅 등록 완료 -> ${settingsPath}`);
for (const c of changed) console.log(`    ${c}`);
