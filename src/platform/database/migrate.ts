import { Logger } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { loadMigrationEnv } from '../../config/migration-env';

/**
 * Folder of the generated SQL migrations. Three levels up from both
 * `src/platform/database` (tests) and `dist/platform/database` (Docker image).
 */
export const MIGRATIONS_FOLDER = resolve(__dirname, '../../../migrations');

/**
 * Applies every migration in `MIGRATIONS_FOLDER` that the database has not
 * seen yet, in one transaction, and records them in `drizzle.__drizzle_migrations`.
 * Running it again is a no-op.
 *
 * @param ownerUrl connection URL of the owner role; the runtime role may not
 *   change the schema.
 */
export async function runMigrations(ownerUrl: string): Promise<void> {
  const pool = new Pool({
    connectionString: ownerUrl,
    application_name: 'qaryati-migrate',
    max: 1,
  });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}

// Entry point of the one-shot `migrate` service in docker-compose.yml.
if (require.main === module) {
  const logger = new Logger('Migrate');
  Promise.resolve()
    .then(() => runMigrations(loadMigrationEnv().DATABASE_OWNER_URL))
    .then(
      () => logger.log('Migrations applied'),
      (error: unknown) => {
        logger.error('Migrations failed', error instanceof Error ? error.stack : error);
        process.exitCode = 1;
      },
    );
}
