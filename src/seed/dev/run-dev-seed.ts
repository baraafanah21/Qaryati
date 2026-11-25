import { Client } from 'pg';
import { loadSeedEnv } from '../../config/seed-env';
import { assertNotProduction } from '../production-guard';
import { seedDevelopment } from './dev-seed';
import { SeedApiClient } from './seed-api-client';

/** `npm run db:seed`: the sample villages, through the running API (src/seed/README.md). */
async function main(): Promise<void> {
  const env = loadSeedEnv();
  assertNotProduction(env.NODE_ENV, 'db:seed');
  const owner = new Client({ connectionString: env.DATABASE_OWNER_URL });
  await owner.connect();
  try {
    console.log(`Seeding sample villages through ${env.SEED_API_URL} ...`);
    const report = await seedDevelopment(new SeedApiClient(env.SEED_API_URL), owner);
    console.log(
      `Done: ${report.villagesCreated.length} villages created, ` +
        `${report.villagesSkipped.length} already there, ${report.claimsVerified} claims verified.`,
    );
  } finally {
    await owner.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
