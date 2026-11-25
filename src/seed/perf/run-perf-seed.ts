import { Client } from 'pg';
import { loadSeedEnv } from '../../config/seed-env';
import { assertNotProduction } from '../production-guard';
import { seedPerf } from './perf-seed';

/** `npm run db:seed:perf`: synthetic villages for the k6 load tests (src/seed/README.md). */
async function main(): Promise<void> {
  const env = loadSeedEnv();
  assertNotProduction(env.NODE_ENV, 'db:seed:perf');
  const owner = new Client({ connectionString: env.DATABASE_OWNER_URL });
  await owner.connect();
  try {
    const started = performance.now();
    console.log(`Writing ${env.PERF_SEED_VILLAGES} synthetic villages ...`);
    const report = await seedPerf(owner, env.PERF_SEED_VILLAGES);
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    console.log(`Inserted by this run (${seconds}s):`, report.inserted);
    console.log('Rows per table now:', report.tableCounts);
  } finally {
    await owner.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
