import { Controller, Get, Module, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { appEnvSchema, type AppEnv } from '../src/config/app-env';
import { createTestTokenIssuer, Public, Role } from '../src/modules/iam';
import { configureApp } from '../src/platform/http/configure-app';
import { ApiModule } from '../src/platform/http/openapi';
import { MetricsModule } from '../src/platform/metrics/metrics.module';
import { AUDIT_RECORDER, CLOCK, FixedClock } from '../src/shared/kernel';
import { InMemoryAuditRecorder } from './support/in-memory-audit-recorder';

@ApiModule('securityprobe')
@Controller('__security-probe')
class SecurityProbe {
  @Public()
  @Get('anonymous')
  anonymous() {
    return { ok: true };
  }

  @Get('user')
  user() {
    return { ok: true };
  }
}
@Module({ controllers: [SecurityProbe] })
class SecurityProbeModule {}

const ANONYMOUS_LIMIT = 20;
const USER_LIMIT = 5;
const LOGIN_LIMIT = 5;
const ALLOWED_ORIGIN = 'https://allowed.example';
const PASSWORD = 'correct horse battery';

interface Built {
  app: INestApplication<App>;
  audit: InMemoryAuditRecorder;
  clock: FixedClock;
}

async function build(env: Record<string, unknown>): Promise<Built> {
  const config = new ConfigService<AppEnv, true>(
    appEnvSchema.parse({
      ...process.env,
      RATE_LIMIT_ENABLED: 'true',
      RATE_LIMIT_ANONYMOUS_PER_MINUTE: ANONYMOUS_LIMIT,
      RATE_LIMIT_USER_PER_MINUTE: USER_LIMIT,
      RATE_LIMIT_LOGIN_PER_MINUTE: LOGIN_LIMIT,
      // One trusted hop: each test picks its own client IP with X-Forwarded-For,
      // so tests do not share counters.
      TRUST_PROXY: '1',
      CORS_ORIGINS: ALLOWED_ORIGIN,
      ...env,
    }),
  );
  const audit = new InMemoryAuditRecorder();
  const clock = new FixedClock('2026-11-24T10:00:00Z');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule, SecurityProbeModule] })
    .overrideProvider(ConfigService)
    .useValue(config)
    .overrideProvider(AUDIT_RECORDER)
    .useValue(audit)
    .overrideProvider(CLOCK)
    .useValue(clock)
    .compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>();
  configureApp(app);
  await app.init();
  return { app, audit, clock };
}

let ipCounter = 0;
/** A client IP no other test uses. */
const freshIp = () => `203.0.113.${++ipCounter}`;
const freshEmail = () => `sec-${randomUUID()}@example.test`;

/** The fields of a problem (or account) body the assertions read. */
interface Problem {
  code?: string;
  detail?: string;
  role?: string;
}

describe('security and operations (e2e)', () => {
  let built: Built;
  let app: INestApplication<App>;
  let pool: Pool;
  const http = () => request(app.getHttpServer());
  const login = (email: string, password: string, ip = freshIp()) =>
    http().post('/api/v1/auth/login').set('X-Forwarded-For', ip).send({ email, password });
  const register = (email: string) =>
    http()
      .post('/api/v1/auth/register')
      .set('X-Forwarded-For', freshIp())
      .send({ email, password: PASSWORD })
      .expect(201);

  beforeAll(async () => {
    built = await build({});
    app = built.app;
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });
  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  describe('rate limiting (#25)', () => {
    it('answers the 6th login per minute for one IP and email with 429 and Retry-After', async () => {
      const ip = freshIp();
      const email = freshEmail();
      for (let i = 0; i < LOGIN_LIMIT; i++) await login(email, 'wrong-password', ip).expect(401);
      const limited = await login(email, 'wrong-password', ip).expect(429);
      expect(limited.headers['content-type']).toMatch(/^application\/problem\+json/);
      expect(limited.body).toMatchObject({ status: 429, code: 'RATE_LIMITED' });
      const retryAfter = Number(limited.headers['retry-after']);
      expect(Number.isInteger(retryAfter)).toBe(true);
      expect(retryAfter).toBeGreaterThanOrEqual(1);
      expect(retryAfter).toBeLessThanOrEqual(60);
      // Another email from the same IP, and the same email from another IP, still get through.
      await login(freshEmail(), 'wrong-password', ip).expect(401);
      await login(email, 'wrong-password').expect(401);
    });

    it('counts login emails case-insensitively', async () => {
      const ip = freshIp();
      const email = freshEmail();
      for (let i = 0; i < LOGIN_LIMIT; i++) {
        const variant = i % 2 === 0 ? email.toUpperCase() : ` ${email} `;
        await login(variant, 'wrong-password', ip).expect(401);
      }
      await login(email, 'wrong-password', ip).expect(429);
    });

    it('limits anonymous callers per IP', async () => {
      const ip = freshIp();
      const probe = (from: string) =>
        http().get('/api/v1/__security-probe/anonymous').set('X-Forwarded-For', from);
      for (let i = 0; i < ANONYMOUS_LIMIT; i++) await probe(ip).expect(200);
      const limited = await probe(ip).expect(429);
      expect(limited.headers['retry-after']).toBeDefined();
      await probe(freshIp()).expect(200);
    });

    it('limits authenticated callers per user, not per IP', async () => {
      const config = app.get<ConfigService<AppEnv, true>>(ConfigService);
      const issuer = await createTestTokenIssuer({
        privateKeyFile: config.get('JWT_PRIVATE_KEY_FILE', { infer: true }),
        publicKeyFile: config.get('JWT_PUBLIC_KEY_FILE', { infer: true }),
        issuer: config.get('JWT_ISSUER', { infer: true }),
        clock: built.clock,
      });
      const first = await issuer.mint({ id: randomUUID(), role: Role.CONTRIBUTOR });
      const second = await issuer.mint({ id: randomUUID(), role: Role.CONTRIBUTOR });
      const probe = (token: string) =>
        http()
          .get('/api/v1/__security-probe/user')
          .set('X-Forwarded-For', freshIp())
          .set('Authorization', `Bearer ${token}`);
      for (let i = 0; i < USER_LIMIT; i++) await probe(first).expect(200);
      await probe(first).expect(429);
      await probe(second).expect(200);
    });

    it('never limits the health probes', async () => {
      const ip = freshIp();
      for (let i = 0; i < ANONYMOUS_LIMIT + 2; i++) {
        await http().get('/api/v1/health/live').set('X-Forwarded-For', ip).expect(200);
      }
    });

    it('documents 429 with Retry-After on limited operations only', async () => {
      const doc = (await http().get('/api/docs-json').expect(200)).body as {
        paths: Record<string, Record<string, { responses: Record<string, unknown> }>>;
      };
      expect(doc.paths['/api/v1/auth/login']?.post?.responses['429']).toMatchObject({
        headers: { 'Retry-After': expect.any(Object) as unknown },
      });
      expect(doc.paths['/api/v1/health/ready']?.get?.responses).not.toHaveProperty('429');
    });
  });

  describe('account lockout (#25)', () => {
    it('locks after 10 failures, refuses the right password with the same 401, then unlocks', async () => {
      const email = freshEmail();
      const { body: account } = (await register(email)) as { body: { id: string } };
      built.audit.clear();
      const wrong = await login(email, 'wrong-password').expect(401);
      for (let i = 1; i < 10; i++) await login(email, 'wrong-password').expect(401);

      const locked = await pool.query<{ locked_until: Date; failed_login_count: number }>(
        'SELECT locked_until, failed_login_count FROM user_account WHERE id = $1',
        [account.id],
      );
      expect(locked.rows[0]?.locked_until).toEqual(new Date('2026-11-24T10:15:00Z'));
      expect(locked.rows[0]?.failed_login_count).toBe(0);
      expect(built.audit.entries).toEqual([
        expect.objectContaining({
          action: 'account.locked',
          entityType: 'UserAccount',
          entityId: account.id,
          after: { lockedUntil: '2026-11-24T10:15:00.000Z' },
          inTransaction: true,
        }),
      ]);

      // Locked: the right password gets exactly the wrong-password answer.
      const refused = await login(email, PASSWORD).expect(401);
      expect((refused.body as Problem).code).toBe('INVALID_CREDENTIALS');
      expect((refused.body as Problem).detail).toBe((wrong.body as Problem).detail);

      built.clock.advance(15 * 60_000 - 1);
      await login(email, PASSWORD).expect(401);
      built.clock.advance(1);
      await login(email, PASSWORD).expect(200);
      const reset = await pool.query<{ locked_until: Date | null; failed_login_count: number }>(
        'SELECT locked_until, failed_login_count FROM user_account WHERE id = $1',
        [account.id],
      );
      expect(reset.rows[0]).toEqual({ locked_until: null, failed_login_count: 0 });
    });

    it('resets the failure count on success, so failures must be consecutive', async () => {
      const email = freshEmail();
      await register(email);
      for (let i = 0; i < 9; i++) await login(email, 'wrong-password').expect(401);
      await login(email, PASSWORD).expect(200);
      for (let i = 0; i < 9; i++) await login(email, 'wrong-password').expect(401);
      await login(email, PASSWORD).expect(200);
    });
  });

  describe('HTTP security configuration (#42)', () => {
    it('sends helmet headers and hides the framework', async () => {
      const res = await http().get('/api/v1/health/live').expect(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(res.headers['strict-transport-security']).toBeDefined();
      expect(res.headers).not.toHaveProperty('x-powered-by');
    });

    it('allows CORS for an allow-listed origin only', async () => {
      const allowed = await http()
        .options('/api/v1/__security-probe/anonymous')
        .set('Origin', ALLOWED_ORIGIN)
        .set('Access-Control-Request-Method', 'GET')
        .expect(204);
      expect(allowed.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);

      const other = await http()
        .get('/api/v1/__security-probe/anonymous')
        .set('X-Forwarded-For', freshIp())
        .set('Origin', 'https://evil.example')
        .expect(200);
      expect(other.headers).not.toHaveProperty('access-control-allow-origin');
    });

    it('rejects a body over 1 MB with 413 and accepts one just under it', async () => {
      const big = await http()
        .post('/api/v1/auth/register')
        .set('X-Forwarded-For', freshIp())
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ email: 'x@example.test', password: 'x'.repeat(1.1 * 1024 * 1024) }))
        .expect(413);
      expect(big.headers['content-type']).toMatch(/^application\/problem\+json/);
      // 0.9 MB passes the parser and reaches validation (password too long → 400).
      await http()
        .post('/api/v1/auth/register')
        .set('X-Forwarded-For', freshIp())
        .send({ email: 'x@example.test', password: 'x'.repeat(0.9 * 1024 * 1024) })
        .expect(400);
    });
  });

  describe('health and metrics (#43)', () => {
    it('reports live, and ready with PostgreSQL and Redis up', async () => {
      await http().get('/api/v1/health/live').expect(200, { status: 'ok' });
      await http()
        .get('/api/v1/health/ready')
        .expect(200, { status: 'ok', checks: { database: 'up', redis: 'up' } });
    });

    it('serves the request histogram on the internal metrics port only', async () => {
      await http().get('/api/v1/health/live').expect(200);
      const port = app.get(MetricsModule).port;
      expect(port).toEqual(expect.any(Number));
      const res = await request(`http://127.0.0.1:${port}`).get('/metrics').expect(200);
      expect(res.headers['content-type']).toMatch(/^text\/plain/);
      expect(res.text).toMatch(
        /http_request_duration_seconds_bucket\{le="0\.005",method="GET",route="\/api\/v1\/health\/live",status_code="200"\}/,
      );
      expect(res.text).toContain('nodejs_eventloop_lag_seconds');
      // Never on the public port.
      await http().get('/metrics').expect(404);
      await http().get('/api/v1/metrics').expect(404);
    });
  });

  describe('with Redis down', () => {
    let down: Built;
    beforeAll(async () => {
      // Nothing listens on port 1: every Redis command fails at once.
      down = await build({ REDIS_URL: 'redis://127.0.0.1:1', RATE_LIMIT_LOGIN_PER_MINUTE: 1 });
    });
    afterAll(async () => {
      await down?.app.close();
    });

    it('reports not ready (503) but stays live', async () => {
      const server = down.app.getHttpServer();
      await request(server).get('/api/v1/health/live').expect(200);
      await request(server)
        .get('/api/v1/health/ready')
        .expect(503, { status: 'unavailable', checks: { database: 'up', redis: 'down' } });
    });

    it('fails open: requests over the limit are let through', async () => {
      const ip = freshIp();
      const email = freshEmail();
      for (let i = 0; i < 3; i++) {
        await request(down.app.getHttpServer())
          .post('/api/v1/auth/login')
          .set('X-Forwarded-For', ip)
          .send({ email, password: 'wrong-password' })
          .expect(401);
      }
    });
  });
});
