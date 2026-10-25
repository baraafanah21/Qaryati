import { Controller, Get, Module, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { CurrentUser, type AuthenticatedUser } from '../src/modules/iam';
import { Argon2PasswordHasher } from '../src/modules/iam/infrastructure/argon2-password-hasher';
import { RequestContext } from '../src/platform/context/request-context';
import { configureApp } from '../src/platform/http/configure-app';
import { ApiModule } from '../src/platform/http/openapi';
import { AUDIT_RECORDER, CLOCK, FixedClock } from '../src/shared/kernel';
import { InMemoryAuditRecorder } from './support/in-memory-audit-recorder';

@ApiModule('authprobe')
@Controller('__auth-probe')
class AuthProbe {
  constructor(private readonly context: RequestContext) {}
  @Get()
  identity(@CurrentUser() user: AuthenticatedUser) {
    return { user, actorId: this.context.actorId };
  }
}
@Module({ controllers: [AuthProbe] })
class ProbeModule {}

interface Account {
  id: string;
  email: string;
  role: string;
  status: string;
  version: number;
}
interface Tokens {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
}
interface OpenApiOperation {
  security: unknown;
  operationId: string;
  responses: Record<string, unknown>;
}

describe('IAM registration and login (e2e)', () => {
  let app: INestApplication<App>;
  let pool: Pool;
  const audit = new InMemoryAuditRecorder();
  const clock = new FixedClock('2026-10-25T10:00:00Z');
  const password = '  secure passphrase😀  ';
  const email = () => `iam14-${randomUUID()}@example.test`;
  const register = (address: string) =>
    request(app.getHttpServer()).post('/api/v1/auth/register').send({ email: address, password });
  const login = (address: string, value = password) =>
    request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: address, password: value });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule, ProbeModule] })
      .overrideProvider(AUDIT_RECORDER)
      .useValue(audit)
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });
  beforeEach(() => audit.clear());
  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  it('registers a normalized contributor with ETag and an allow-listed transactional audit', async () => {
    const address = email();
    const response = await register(` ${address.toUpperCase()} `).expect(201);
    const account = response.body as Account;
    expect(account).toMatchObject({
      email: address,
      role: 'CONTRIBUTOR',
      status: 'ACTIVE',
      version: 1,
    });
    expect(response.headers.etag).toBe('"1"');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.text).not.toMatch(/password|hash|token/i);
    expect(audit.entries).toEqual([
      expect.objectContaining({
        action: 'user_account.created',
        entityId: account.id,
        inTransaction: true,
        after: { email: address, role: 'CONTRIBUTOR', status: 'ACTIVE' },
      }),
    ]);
    const stored = await pool.query<{ password_hash: string }>(
      'SELECT password_hash FROM user_account WHERE id = $1',
      [account.id],
    );
    const hash = stored.rows[0]?.password_hash as string;
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,(?:t=2,p=1|p=1,t=2)\$/);
    expect(hash).not.toBe(password);
    expect(await new Argon2PasswordHasher().verify(hash, password)).toBe(true);
    expect(JSON.stringify(audit.entries)).not.toMatch(/password|hash|token/i);
  });
  it.each([
    { password: 'x'.repeat(9) },
    { password: 'x'.repeat(129) },
    { role: 'ADMIN' },
    { status: 'DISABLED' },
    { displayName: 'extra' },
    { email: 'invalid' },
  ])('rejects invalid or unexpected registration input %j', async (override) => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: email(), password, ...override })
      .expect(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(audit.entries).toHaveLength(0);
  });
  it.each([10, 128])('registers at password boundary %i', async (length) => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: email(), password: 'x'.repeat(length) })
      .expect(201);
  });
  it('rejects duplicate email with different case and concurrent registration safely', async () => {
    const address = email();
    const responses = await Promise.all([register(address), register(address.toUpperCase())]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(responses.find((response) => response.status === 409)?.body).toMatchObject({
      code: 'DUPLICATE',
    });
    expect(audit.entries).toHaveLength(1);
  });
  it('logs in, stores only a digest, audits issuance and passes the existing #10 guards', async () => {
    const address = email();
    const registered = (await register(address).expect(201)).body as Account;
    audit.clear();
    const response = await login(` ${address.toUpperCase()} `).expect(200);
    const tokens = response.body as Tokens;
    expect(tokens).toMatchObject({ tokenType: 'Bearer', expiresIn: 300 });
    expect(tokens.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(response.headers['cache-control']).toBe('no-store');
    const probe = await request(app.getHttpServer())
      .get('/api/v1/__auth-probe')
      .auth(tokens.accessToken, { type: 'bearer' })
      .expect(200);
    expect(probe.body).toEqual({
      user: { id: registered.id, role: 'CONTRIBUTOR' },
      actorId: registered.id,
    });
    const stored = await pool.query<{
      token_hash: string;
      family_id: string;
      created_at: Date;
      expires_at: Date;
    }>('SELECT * FROM refresh_token WHERE user_id = $1', [registered.id]);
    expect(stored.rows).toHaveLength(1);
    const record = stored.rows[0]!;
    expect(record.token_hash).toBe(createHash('sha256').update(tokens.refreshToken).digest('hex'));
    expect(record.family_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(record.created_at).toEqual(clock.now());
    expect(record.expires_at.getTime() - record.created_at.getTime()).toBe(604800000);
    expect(JSON.stringify(stored.rows)).not.toContain(tokens.refreshToken);
    expect(audit.entries).toEqual([
      expect.objectContaining({
        action: 'refresh_token.issued',
        inTransaction: true,
        after: {
          userId: registered.id,
          familyId: record.family_id,
          createdAt: clock.now().toISOString(),
          expiresAt: record.expires_at.toISOString(),
        },
      }),
    ]);
    expect(JSON.stringify(audit.entries)).not.toContain(tokens.refreshToken);
    expect(JSON.stringify(audit.entries)).not.toContain(record.token_hash);
    const again = (await login(address).expect(200)).body as Tokens;
    expect(again.refreshToken).not.toBe(tokens.refreshToken);
  });
  it('returns identical public failures for unknown email, wrong password and disabled/deleted accounts', async () => {
    const address = email();
    const account = (await register(address).expect(201)).body as Account;
    audit.clear();
    const unknown = await login(email()).expect(401);
    const wrong = await login(address, 'x').expect(401);
    await pool.query('UPDATE user_account SET status = $1 WHERE id = $2', ['DISABLED', account.id]);
    const disabled = await login(address).expect(401);
    await pool.query('UPDATE user_account SET status = $1, deleted_at = $2 WHERE id = $3', [
      'ACTIVE',
      clock.now(),
      account.id,
    ]);
    const deleted = await login(address).expect(401);
    const publicFields = (body: Record<string, unknown>) => {
      return Object.fromEntries(
        Object.entries(body).filter(([key]) => key !== 'traceId' && key !== 'timestamp'),
      );
    };
    for (const response of [unknown, wrong, disabled, deleted]) {
      expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
      expect(response.body).toMatchObject({
        code: 'INVALID_CREDENTIALS',
        status: 401,
        detail: 'The email or password is incorrect.',
      });
      expect(publicFields(response.body as Record<string, unknown>)).toEqual(
        publicFields(unknown.body as Record<string, unknown>),
      );
    }
    expect(audit.entries).toHaveLength(0);
    expect(
      (await pool.query('SELECT id FROM refresh_token WHERE user_id = $1', [account.id])).rows,
    ).toHaveLength(0);
  });
  it('rolls back registration and issuance when audit fails', async () => {
    const address = email();
    audit.failNext();
    await register(address).expect(500);
    expect(
      (await pool.query('SELECT id FROM user_account WHERE email = $1', [address])).rows,
    ).toHaveLength(0);
    const account = (await register(address).expect(201)).body as Account;
    audit.clear();
    audit.failNext();
    await login(address).expect(500);
    expect(
      (await pool.query('SELECT id FROM refresh_token WHERE user_id = $1', [account.id])).rows,
    ).toHaveLength(0);
    expect(audit.entries).toHaveLength(0);
  });
  it('documents strict public auth operations and the shared error contract', async () => {
    const response = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    const doc = response.body as {
      paths: Record<string, { post?: OpenApiOperation }>;
      components: { schemas: Record<string, unknown> };
    };
    const registration = doc.paths['/api/v1/auth/register']?.post;
    const authentication = doc.paths['/api/v1/auth/login']?.post;
    expect(registration).toMatchObject({ security: [], operationId: 'iam_register' });
    expect(authentication).toMatchObject({ security: [], operationId: 'iam_login' });
    expect(registration?.responses).toHaveProperty('409');
    expect(authentication?.responses).toHaveProperty('401');
    expect(JSON.stringify(authentication?.responses['401'])).toContain('INVALID_CREDENTIALS');
    expect(doc.components.schemas).toHaveProperty('UserAccountResponse');
    expect(doc.components.schemas).toHaveProperty('LoginResponse');
    expect(JSON.stringify(doc.components.schemas.UserAccountResponse)).not.toContain('password');
  });
});
