// Must stay the first import: AppModule validates the environment on import.
import './config/openapi-env';

import { NestFactory } from '@nestjs/core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { AppModule } from './app.module';
import { configureRoutes } from './platform/http/configure-app';
import { buildOpenApiDocument } from './platform/http/openapi';

/** The committed contract that reviewers, Apidog (#59) and the web client (#61) read. */
export const OPENAPI_FILE = resolve(__dirname, '../docs/api/openapi.json');

/**
 * Writes the OpenAPI document of the app to docs/api/openapi.json without a
 * database or Redis: `npm run openapi:generate`.
 *
 * Nest's preview mode builds the module graph and the routes but instantiates
 * no provider, so the pool is never created and no connection is attempted.
 * CI regenerates the file and fails if it differs from the committed one
 * (docs/ci.md, "quality").
 */
async function generate(): Promise<void> {
  const app = await NestFactory.create(AppModule, { preview: true, logger: false });
  configureRoutes(app);
  const document = buildOpenApiDocument(app);
  mkdirSync(dirname(OPENAPI_FILE), { recursive: true });
  writeFileSync(OPENAPI_FILE, `${JSON.stringify(document, null, 2)}\n`);
  await app.close();
}

generate().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
