// server/vitest.config.mjs — Express 서버 + 테스트 DB 사용(체크리스트 21 (a))일 때만 복사한다 (testing.md 0절)
// 함께 복사: vitest-test-db.global.mjs → server/test/setup/test-db.global.mjs, vitest-test-db.worker.mjs → server/test/setup/test-db.worker.mjs
// 테스트 파일은 워커마다 병렬로 돈다(Vitest 기본). 워커마다 테스트 DB를 따로 줘서 파일끼리 같은 테이블을 동시에 건드리지 않게 한다
// — 병렬을 끄면(fileParallelism: false) 안전하지만 2.3배 느리고, DB 테스트만 따로 직렬로 돌리려면 파일 이름 규칙이 필요해 빠뜨리면 다시 깨진다 (2026-10-27 실측)
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// 저장소 루트 .env의 TEST_DB_*를 읽는다(compose와 같은 파일). 이미 있는 환경변수(CI job의 env)가 우선한다.
// 서버가 저장소 루트에 있는 단일 구조면 '../.env' 대신 './.env'
const rootEnv = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  test: {
    pool: 'forks',                                    // 워커 = 프로세스 — 워커 번호(VITEST_POOL_ID)로 DB를 고른다
    globalSetup: ['./test/setup/test-db.global.mjs'], // 워커 수만큼 DB 생성 + 마이그레이션 (한 번)
    setupFiles: ['./test/setup/test-db.worker.mjs'],  // 테스트 파일마다 DB_*를 이 워커의 DB로
  },
});
