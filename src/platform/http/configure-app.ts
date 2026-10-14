import { VersioningType, type INestApplication } from '@nestjs/common';
import { Logger } from 'nestjs-pino';

/**
 * Applies the HTTP conventions of the API to a Nest application.
 *
 * Shared by `main.ts` and the e2e tests so both serve exactly the same routes:
 * - every route lives under `/api`, so a reverse proxy can route by prefix;
 * - URI versioning with `1` as the default, so a breaking change can ship as
 *   `/api/v2/...` without moving existing clients;
 * - shutdown hooks, so providers can close connections (database pool, Redis)
 *   when the process receives SIGTERM;
 * - pino as the Nest logger, so framework and `new Logger(...)` lines are JSON
 *   with the request ID, like the access log.
 *
 * The exception filter and validation pipe are not set here: HttpPlatformModule
 * registers them as `APP_FILTER`/`APP_PIPE`, so they get dependency injection.
 */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableShutdownHooks();
  app.useLogger(app.get(Logger));
}
