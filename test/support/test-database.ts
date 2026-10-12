import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { resolve } from 'node:path';
import { runMigrations } from '../../src/platform/database/migrate';

/** Same image as the `db` service in docker-compose.yml; keep the two in sync. */
export const POSTGIS_IMAGE = 'postgis/postgis:16-3.5';

const INIT_SCRIPT = resolve(__dirname, '../../docker/postgres/init/20-create-app-role.sh');
const APP_PASSWORD = 'app-test-password';

/** Starting PostGIS and running its init scripts takes a while on a cold Docker cache. */
export const CONTAINER_STARTUP_TIMEOUT_MS = 120_000;

/** A migrated PostGIS database set up like the Compose `db` service. */
export interface TestDatabase {
  /** Connection URL of the owner role, which ran the migrations. */
  ownerUrl: string;
  /** Connection URL of the restricted runtime role `qaryati_app`. */
  appUrl: string;
  stop(): Promise<void>;
}

/**
 * Starts a throwaway PostGIS container with the real role init script and all
 * migrations applied, so tests exercise exactly what `docker compose up` builds.
 */
export async function startTestDatabase(): Promise<TestDatabase> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(POSTGIS_IMAGE)
    .withDatabase('qaryati')
    .withUsername('qaryati_owner')
    .withPassword('owner-test-password')
    .withEnvironment({ APP_DB_PASSWORD: APP_PASSWORD })
    .withCopyFilesToContainer([
      {
        source: INIT_SCRIPT,
        target: '/docker-entrypoint-initdb.d/20-create-app-role.sh',
        mode: 0o755,
      },
    ])
    .start();

  const ownerUrl = container.getConnectionUri();
  const app = new URL(ownerUrl);
  app.username = 'qaryati_app';
  app.password = APP_PASSWORD;

  await runMigrations(ownerUrl);

  return {
    ownerUrl,
    appUrl: app.toString(),
    stop: async () => {
      await container.stop();
    },
  };
}
