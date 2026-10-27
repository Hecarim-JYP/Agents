// server/test/setup/test-db.worker.mjs — Vitest setupFiles: 테스트 파일마다, 앱 모듈을 불러오기 전에 실행된다 (testing.md 0절)
// 앱의 DB 접속 정보(DB_*)를 이 워커의 테스트 DB({TEST_DB_NAME}_{워커 번호})로 덮어쓴다 — 앱 코드는 테스트를 몰라도 된다.
// 같은 워커의 테스트 파일은 차례대로 돌므로, 파일마다 하는 데이터 초기화가 다른 파일과 겹치지 않는다.
// 워커 번호(VITEST_POOL_ID)는 1부터 maxWorkers까지다 — DB는 globalSetup(test-db.global.mjs)이 그 수만큼 만들어 둔다.
import { readTestDbEnv } from './test-db.global.mjs';

const db = readTestDbEnv();   // TEST_DB_*가 없으면 여기서 실패 — .env의 개발 DB로 붙는 사고를 막는다
process.env.DB_HOST = db.host;
process.env.DB_PORT = String(db.port);
process.env.DB_NAME = `${db.name}_${process.env.VITEST_POOL_ID}`;
process.env.DB_USER = db.user;
process.env.DB_PASSWORD = db.password;
