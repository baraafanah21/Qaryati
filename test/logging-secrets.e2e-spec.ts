import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { LoggerModule } from 'nestjs-pino';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { appEnvSchema, type AppEnv } from '../src/config/app-env';
import { configureApp } from '../src/platform/http/configure-app';
import { createPinoHttpOptions } from '../src/platform/logging/logger-options';
import { LoggingModule } from '../src/platform/logging/logging.module';

/** Collects every log line the app writes, to check what never appears in them. */
class LogCapture extends Writable {
  readonly lines: string[] = [];
  override _write(chunk: Buffer, _encoding: string, done: () => void): void {
    this.lines.push(chunk.toString());
    done();
  }
  get text(): string {
    return this.lines.join('');
  }
}

// A file of its own: nestjs-pino keeps one root logger per process, so the app
// with the capture must be the first one this test worker creates.
describe('logging of credentials (#42, e2e)', () => {
  const logs = new LogCapture();
  let app: INestApplication<App>;
  let pool: Pool;
  const password = 'correct horse battery';

  beforeAll(async () => {
    const config = new ConfigService<AppEnv, true>(
      appEnvSchema.parse({ ...process.env, LOG_LEVEL: 'trace' }),
    );
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(config)
      // The real pino options at the most verbose level, with a destination the test reads.
      .overrideModule(LoggingModule)
      .useModule(
        LoggerModule.forRoot({
          pinoHttp: [createPinoHttpOptions({ NODE_ENV: 'test', LOG_LEVEL: 'trace' }), logs],
        }),
      )
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });
  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  it('never writes a password, token, hash or full email after register, login and refresh', async () => {
    const server = app.getHttpServer();
    const email = `log-${randomUUID()}@example.test`;
    const { body: account } = (await request(server)
      .post('/api/v1/auth/register')
      .send({ email, password })
      .expect(201)) as { body: { id: string } };
    await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: 'wrong-password' })
      .expect(401);
    const { body: tokens } = (await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200)) as { body: { accessToken: string; refreshToken: string } };
    await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .expect(200);
    await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: tokens.refreshToken })
      .expect(200);

    const { rows } = await pool.query<{ password_hash: string }>(
      'SELECT password_hash FROM user_account WHERE id = $1',
      [account.id],
    );
    // The capture really saw the requests (one access line each)...
    expect(logs.text).toContain('"path":"/api/v1/auth/login"');
    expect(logs.lines.filter((line) => line.includes('request completed')).length).toBe(5);
    // ...and none of the secrets.
    for (const secret of [
      password,
      'wrong-password',
      email,
      tokens.accessToken,
      tokens.refreshToken,
      rows[0]?.password_hash ?? 'missing-hash',
      '$argon2id',
    ]) {
      expect(logs.text).not.toContain(secret);
    }
  });
});
