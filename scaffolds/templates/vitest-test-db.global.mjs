// server/test/setup/test-db.global.mjs — Vitest globalSetup: 테스트 시작 전 한 번(메인 프로세스) 실행된다 (testing.md 0절)
// 워커(테스트 파일을 돌리는 프로세스)마다 테스트 DB를 하나씩 준비한다: {TEST_DB_NAME}_1 … {TEST_DB_NAME}_{maxWorkers}.
// 테스트 DB 하나를 모든 워커가 같이 쓰면, 파일마다 하는 데이터 초기화가 다른 파일의 데이터를 지워 실패한다
// (2026-10-27 실측: 같은 테이블을 쓰는 파일 6개 — 18개 중 16~17개 실패, 워커별 DB로 바꾸면 전부 통과·소요 시간 같음).
//
// 1) DB 생성(이미 있으면 그대로) + 앱 사용자에게 권한 — root로 한다. compose의 db-test와 CI 서비스는 root 비밀번호가 TEST_DB_PASSWORD다
// 2) 프로젝트의 마이그레이션 러너(npm run migrate)를 DB마다 실행 — 미적용분만 적용하므로 두 번째 실행부터는 거의 0초다
//    러너는 운영과 같은 DB_* 환경변수로 접속한다(compose migrate 서비스와 같은 방식) — 여기서 DB_*를 테스트 DB 값으로 넘긴다
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import mysql from 'mysql2/promise';

// 테스트 DB 설정 — 없으면 바로 실패한다. 개발 DB(DB_*)로 대신 붙지 않는다 (자동화 테스트는 테스트 DB 전용 — testing.md 0절 STRICT)
export function readTestDbEnv() {
  const missing = ['TEST_DB_HOST', 'TEST_DB_PORT', 'TEST_DB_NAME', 'TEST_DB_USER', 'TEST_DB_PASSWORD'].filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`테스트 DB 설정이 없다: ${missing.join(', ')} — 저장소 루트 .env(체크리스트 21) 또는 CI job의 env에 둔다`);
  }
  const name = process.env.TEST_DB_NAME;
  if (!/^[A-Za-z0-9_]+$/.test(name)) throw new Error(`TEST_DB_NAME은 영문·숫자·_만: "${name}"`);   // DB 이름을 SQL에 그대로 넣는다
  return {
    host: process.env.TEST_DB_HOST,   // 로컬은 127.0.0.1(compose db-test의 노출 포트), CI는 서비스 컨테이너
    port: Number(process.env.TEST_DB_PORT),
    name,
    user: process.env.TEST_DB_USER,
    password: process.env.TEST_DB_PASSWORD,
  };
}

// npm run migrate를 한 DB에 대해 실행 — 실패하면 러너 출력과 함께 테스트 전체를 멈춘다
function migrate(root, db, database) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, DB_HOST: db.host, DB_PORT: String(db.port), DB_NAME: database, DB_USER: db.user, DB_PASSWORD: db.password };
    const child = spawn('npm run -s migrate', { cwd: root, env, shell: true });   // shell: Windows의 npm.cmd
    let out = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { out += c; });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${database} 마이그레이션 실패 (exit ${code}):\n${out.trim()}`))));
  });
}

export default async function setup(project) {
  // Vitest 5(Vite 모듈 러너)의 소스맵 스택 변환이 globalSetup 안에서 오류 스택을 만들다 스스로 실패한다 —
  // 접속 실패(mysql2)는 우리 catch에 오기 전에 "code.charCodeAt is not a function"으로 죽고, 던진 오류는 "No test files found"만 남긴다
  // (2026-10-27 실측). 이 설정 동안만 변환을 끄고, 원인은 직접 찍는다
  const prepareStackTrace = Error.prepareStackTrace;
  Error.prepareStackTrace = undefined;
  try {
    await prepare(project);
  } catch (e) {
    console.error('\n[test-db] 테스트 DB 준비 실패:', `${e.message}\n`);
    throw e;
  } finally {
    Error.prepareStackTrace = prepareStackTrace;
  }
}

async function prepare(project) {
  const db = readTestDbEnv();
  const workers = project.config.maxWorkers;
  const names = Array.from({ length: workers }, (_, i) => `${db.name}_${i + 1}`);

  const admin = await mysql.createConnection({ host: db.host, port: db.port, user: 'root', password: db.password });
  try {
    for (const name of names) {
      await admin.query(`CREATE DATABASE IF NOT EXISTS \`${name}\``);
      await admin.query(`GRANT ALL PRIVILEGES ON \`${name}\`.* TO ?@'%'`, [db.user]);
    }
  } finally {
    await admin.end();
  }

  const root = project.config.root;
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (!pkg.scripts?.migrate) throw new Error('package.json에 migrate 스크립트가 없다 — 워커 DB에 스키마를 만들 수 없다 (migration.md 5절)');
  await Promise.all(names.map((name) => migrate(root, db, name)));
}
