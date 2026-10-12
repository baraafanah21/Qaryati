import { existsSync } from 'node:fs';
import { z } from 'zod';
import { postgresUrl } from './postgres-url';

/**
 * Environment of the migration tools (`migrate.ts`, `drizzle.config.ts`).
 *
 * Kept apart from `appEnvSchema` on purpose: the API never receives the owner
 * credentials, so a compromised API process cannot change the schema.
 */
export const migrationEnvSchema = z.object({
  DATABASE_OWNER_URL: postgresUrl,
});

/** Validated migration environment. */
export type MigrationEnv = z.infer<typeof migrationEnvSchema>;

/**
 * Validates the migration environment for entry points that run outside Nest.
 *
 * Loads `.env` from the working directory when it exists (variables already
 * set in the process win, as in the API) and throws the same message format as
 * the API's startup validation.
 */
export function loadMigrationEnv(): MigrationEnv {
  if (existsSync('.env')) {
    process.loadEnvFile('.env');
  }
  const result = migrationEnvSchema.safeParse(process.env);
  if (!result.success) {
    const lines = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Config validation error: ${lines.join('\n')}`);
  }
  return result.data;
}
