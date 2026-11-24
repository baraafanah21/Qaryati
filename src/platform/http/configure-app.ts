import { VersioningType, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import type { AppEnv } from '../../config/app-env';
import { HttpMetrics } from '../metrics/http-metrics';
import { setupSwagger } from './openapi';

/** Largest JSON or form body the API accepts; larger bodies get 413. */
export const BODY_LIMIT = '1mb';

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
 *   with the request ID, like the access log;
 * - the security settings of {@link configureSecurity};
 * - request timing for `/metrics` (#43);
 * - Swagger UI at `/api/docs` and the document at `/api/docs-json`, unless
 *   disabled (off by default in production).
 *
 * The exception filter and validation pipe are not set here: HttpPlatformModule
 * registers them as `APP_FILTER`/`APP_PIPE`, so they get dependency injection.
 */
export function configureApp(app: INestApplication): void {
  app.use(app.get(HttpMetrics).middleware());
  configureSecurity(app);
  configureRoutes(app);
  app.enableShutdownHooks();
  app.useLogger(app.get(Logger));
  setupSwagger(app);
}

/**
 * Security settings of the public HTTP server (#42):
 * - `helmet`: safe response headers (no `X-Powered-By`, `nosniff`, HSTS, a strict
 *   CSP, frame denial). The API serves JSON, so the strict defaults cost nothing.
 * - CORS: only the origins in `CORS_ORIGINS` get CORS headers; with an empty list
 *   no browser page on another origin can read a response. Tokens travel in the
 *   `Authorization` header, never in cookies, so credentials mode stays off.
 * - Body limit {@link BODY_LIMIT} for JSON and URL-encoded bodies (Express's
 *   default is 100 kB, too small for a long history text).
 * - `trust proxy` from `TRUST_PROXY`, which decides `req.ip` and so the rate-limit
 *   key of anonymous callers.
 */
export function configureSecurity(app: INestApplication): void {
  const config = app.get<ConfigService<AppEnv, true>>(ConfigService);
  const express = app as NestExpressApplication;
  express.set('trust proxy', config.get('TRUST_PROXY', { infer: true }));
  express.use(helmet());
  const origins = config.get('CORS_ORIGINS', { infer: true });
  express.enableCors({
    origin: origins.length > 0 ? origins : false,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'If-Match', 'X-Request-Id'],
    exposedHeaders: ['ETag', 'Location', 'Retry-After', 'X-Request-Id'],
    maxAge: 600,
  });
  express.useBodyParser('json', { limit: BODY_LIMIT });
  express.useBodyParser('urlencoded', { limit: BODY_LIMIT, extended: true });
}

/**
 * The route shape alone: `/api` prefix and URI versioning. Also used by the
 * OpenAPI generator, which must produce the same paths without starting
 * anything else.
 */
export function configureRoutes(app: INestApplication): void {
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
}
