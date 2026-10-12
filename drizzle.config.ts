import { defineConfig } from 'drizzle-kit';
import { loadMigrationEnv } from './src/config/migration-env';

/**
 * drizzle-kit configuration (npm run db:generate | db:migrate | db:check | db:studio).
 *
 * The glob collects every module's own schema file, so a module adds tables
 * without touching shared files. drizzle-kit connects as the owner role,
 * because only the owner may change the schema. See docs/database.md.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/modules/*/infrastructure/persistence/schema.ts',
  out: './migrations',
  casing: 'snake_case',
  dbCredentials: { url: loadMigrationEnv().DATABASE_OWNER_URL },
  strict: true,
  verbose: true,
});
