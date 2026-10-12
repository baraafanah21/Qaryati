import type { DynamicModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { appEnvSchema } from './app-env';

/**
 * Loads `.env` (when present) and the process environment, validates them
 * against `appEnvSchema` and makes `ConfigService` available everywhere.
 *
 * `@nestjs/config` accepts any Standard Schema, so the zod schema is passed
 * directly. Invalid configuration stops the app at startup with one line per
 * problem, e.g. `PORT: must be between 1 and 65535`. Variables already set in
 * the process environment win over `.env`.
 *
 * The environment is read when this function is called, so tests call it after
 * they have pointed `DATABASE_URL` at their own database.
 */
export function createAppConfigModule(): Promise<DynamicModule> {
  return ConfigModule.forRoot({
    isGlobal: true,
    cache: true,
    validationSchema: appEnvSchema,
  });
}
