import { startTestDatabase, type TestDatabase } from './test-database';

declare global {
  var qaryatiE2eDatabase: TestDatabase | undefined;
}

/**
 * Starts one migrated PostGIS container for the whole e2e run, before any test
 * file is loaded. AppModule validates the environment when it is imported, so
 * DATABASE_URL must be set this early; test workers inherit it.
 */
export default async function globalSetup(): Promise<void> {
  const database = await startTestDatabase();
  process.env.DATABASE_URL = database.appUrl;
  // For tests that create test-only tables as the owner, like a migration would.
  process.env.TEST_DATABASE_OWNER_URL = database.ownerUrl;
  // Keep test output readable; a test that checks log lines builds its own logger.
  process.env.LOG_LEVEL ??= 'silent';
  globalThis.qaryatiE2eDatabase = database;
}
