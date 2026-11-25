import { existsSync } from 'node:fs';
import { z } from 'zod';
import { postgresUrl } from './postgres-url';

/**
 * Environment of the seed tools (`npm run db:seed`, `npm run db:seed:perf`).
 *
 * Kept apart from `appEnvSchema`: the seeds need the owner role (the API never
 * gets it), and the API needs nothing of this.
 */
export const seedEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Owner role: the development seed promotes its first administrator, the perf seed bulk-loads. */
  DATABASE_OWNER_URL: postgresUrl,
  /** Base URL of the running API that `db:seed` sends its requests to (without `/api/v1`). */
  SEED_API_URL: z
    .url({ protocol: /^https?$/, error: 'must be an http(s) URL' })
    .default('http://localhost:3000'),
  /** Number of synthetic villages `db:seed:perf` writes. */
  PERF_SEED_VILLAGES: z.coerce
    .number({ error: 'must be a number' })
    .int('must be an integer')
    .min(1, 'must be between 1 and 20000')
    .max(20000, 'must be between 1 and 20000')
    .default(800),
});

/** Validated seed environment. */
export type SeedEnv = z.infer<typeof seedEnvSchema>;

/**
 * Validates the seed environment, loading `.env` first when it exists
 * (variables already set in the process win), with the API's message format.
 */
export function loadSeedEnv(): SeedEnv {
  if (existsSync('.env')) {
    process.loadEnvFile('.env');
  }
  const result = seedEnvSchema.safeParse(process.env);
  if (!result.success) {
    const lines = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Config validation error: ${lines.join('\n')}`);
  }
  return result.data;
}
