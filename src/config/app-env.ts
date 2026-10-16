import { z } from 'zod';
import { postgresUrl } from './postgres-url';

/**
 * Environment variables the API process needs, validated once at startup.
 *
 * Every variable is listed in `.env.example` and documented in
 * docs/configuration.md. Add a variable here, there and in the example file in
 * the same change.
 */
export const appEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce
    .number({ error: 'must be a number' })
    .int('must be an integer')
    .min(1, 'must be between 1 and 65535')
    .max(65535, 'must be between 1 and 65535')
    .default(3000),
  /** Minimum pino level; `silent` turns logging off (the e2e tests use it). */
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Runtime role `qaryati_app` (DML only); never the owner role. */
  DATABASE_URL: postgresUrl,
});

/** Validated API environment, as returned by `ConfigService<AppEnv, true>`. */
export type AppEnv = z.infer<typeof appEnvSchema>;
