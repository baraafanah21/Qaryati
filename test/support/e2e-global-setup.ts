import { startTestDatabase, type TestDatabase } from './test-database';
import { createTestJwtKeys, type TestJwtKeys } from './jwt-test-keys';
import { startTestRedis, type TestRedis } from './test-redis';

declare global {
  var qaryatiE2eDatabase: TestDatabase | undefined;
  var qaryatiE2eKeys: TestJwtKeys | undefined;
  var qaryatiE2eRedis: TestRedis | undefined;
}

/**
 * Starts one migrated PostGIS container and one Redis container for the whole e2e run, before any test
 * file is loaded. AppModule validates the environment when it is imported, so
 * DATABASE_URL must be set this early; test workers inherit it.
 */
export default async function globalSetup(): Promise<void> {
  const keys = await createTestJwtKeys();
  globalThis.qaryatiE2eKeys = keys;
  process.env.JWT_PRIVATE_KEY_FILE = keys.privateKeyFile;
  process.env.JWT_PUBLIC_KEY_FILE = keys.publicKeyFile;
  process.env.JWT_ISSUER = 'qaryati-test';
  let database: TestDatabase;
  let redis: TestRedis;
  try {
    [database, redis] = await Promise.all([startTestDatabase(), startTestRedis()]);
  } catch (error) {
    // Jest does not run global teardown when global setup fails.
    await keys.cleanup();
    globalThis.qaryatiE2eKeys = undefined;
    throw error;
  }
  process.env.REDIS_URL = redis.url;
  globalThis.qaryatiE2eRedis = redis;
  process.env.DATABASE_URL = database.appUrl;
  // For tests that create test-only tables as the owner, like a migration would.
  process.env.TEST_DATABASE_OWNER_URL = database.ownerUrl;
  // Keep test output readable; a test that checks log lines builds its own logger.
  process.env.LOG_LEVEL ??= 'silent';
  globalThis.qaryatiE2eDatabase = database;
}
