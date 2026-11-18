import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { appEnvSchema, type AppEnv } from '../src/config/app-env';
import { configureApp } from '../src/platform/http/configure-app';
import { AUDIT_RECORDER, CLOCK, FixedClock } from '../src/shared/kernel';
import { InMemoryAuditRecorder } from './support/in-memory-audit-recorder';

interface Tokens {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
}
interface TokenRow {
  id: string;
  family_id: string;
  token_hash: string;
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  replaced_by_id: string | null;
}
interface OpenApiOperation {
  security?: unknown;
  operationId: string;
  responses: Record<string, unknown>;
}

const sha256 = (raw: string) => createHash('sha256').update(raw).digest('hex');
/** The parts of a problem body that must not differ between two rejections. */
const publicFields = (body: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(body).filter(([key]) => key !== 'traceId' && key !== 'timestamp'),
  );

describe('IAM sessions: refresh rotation, logout and /auth/me (e2e)', () => {
  let app: INestApplication<App>;
  let pool: Pool;
  const audit = new InMemoryAuditRecorder();
  const start = new Date('2026-10-26T10:00:00Z');
  const clock = new FixedClock(start);
  const password = 'secure passphrase';
  const REFRESH_TTL_SECONDS = 3600;

  const http = () => request(app.getHttpServer());
  const refresh = (refreshToken: string) =>
    http().post('/api/v1/auth/refresh').send({ refreshToken });
  const logout = (refreshToken: string) =>
    http().post('/api/v1/auth/logout').send({ refreshToken });
  async function signUp(): Promise<{ id: string; email: string; tokens: Tokens }> {
    const email = `iam18-${randomUUID()}@example.test`;
    const { id } = (
      await http().post('/api/v1/auth/register').send({ email, password }).expect(201)
    ).body as { id: string };
    const tokens = (await http().post('/api/v1/auth/login').send({ email, password }).expect(200))
      .body as Tokens;
    audit.clear();
    return { id, email, tokens };
  }
  async function row(raw: string): Promise<TokenRow> {
    const { rows } = await pool.query<TokenRow>(
      'SELECT * FROM refresh_token WHERE token_hash = $1',
      [sha256(raw)],
    );
    return rows[0]!;
  }

  beforeAll(async () => {
    // A short refresh lifetime proves the value comes from JWT_REFRESH_TTL, not from code.
    const config = new ConfigService<AppEnv, true>(
      appEnvSchema.parse({ ...process.env, JWT_ACCESS_TTL: undefined, JWT_REFRESH_TTL: '1h' }),
    );
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(config)
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
  beforeEach(() => {
    clock.set(start);
    audit.clear();
  });
  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  it('rotates: a new pair, the old row revoked and linked, the family kept, the lifetime from config', async () => {
    const { tokens } = await signUp();
    const response = await refresh(tokens.refreshToken).expect(200);
    const next = response.body as Tokens;
    expect(next).toMatchObject({ tokenType: 'Bearer', expiresIn: 900 });
    expect(next.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(next.refreshToken).not.toBe(tokens.refreshToken);
    expect(next.accessToken).toEqual(expect.any(String));
    expect(response.headers['cache-control']).toBe('no-store');

    const old = await row(tokens.refreshToken);
    const fresh = await row(next.refreshToken);
    expect(old.revoked_at).toEqual(start);
    expect(old.replaced_by_id).toBe(fresh.id);
    expect(fresh).toMatchObject({
      family_id: old.family_id,
      revoked_at: null,
      replaced_by_id: null,
    });
    expect(fresh.expires_at.getTime() - fresh.created_at.getTime()).toBe(
      REFRESH_TTL_SECONDS * 1000,
    );
    const { rows } = await pool.query('SELECT token_hash FROM refresh_token WHERE family_id = $1', [
      old.family_id,
    ]);
    expect(JSON.stringify(rows)).not.toContain(next.refreshToken);
    // A normal rotation is not audited (see the iam README).
    expect(audit.entries).toHaveLength(0);

    await http().get('/api/v1/auth/me').auth(next.accessToken, { type: 'bearer' }).expect(200);
  });

  it('reusing the old token is 401 and revokes the whole family, the new token included', async () => {
    const { id, tokens } = await signUp();
    const next = (await refresh(tokens.refreshToken).expect(200)).body as Tokens;

    const reused = await refresh(tokens.refreshToken).expect(401);
    expect(reused.body).toMatchObject({ code: 'INVALID_CREDENTIALS', status: 401 });
    expect((await row(next.refreshToken)).revoked_at).toEqual(start);
    await refresh(next.refreshToken).expect(401);

    const family = (await row(tokens.refreshToken)).family_id;
    expect(audit.entries.filter((e) => e.action === 'session.reuse_detected')).toHaveLength(2);
    expect(audit.entries[0]).toEqual(
      expect.objectContaining({
        action: 'session.reuse_detected',
        entityType: 'RefreshTokenFamily',
        entityId: family,
        inTransaction: true,
        after: { userId: id, revokedCount: 1 },
      }),
    );
    expect(audit.entries[1]).toMatchObject({ after: { userId: id, revokedCount: 0 } });
    expect(JSON.stringify(audit.entries)).not.toMatch(/token_hash|tokenHash/);
    expect(JSON.stringify(audit.entries)).not.toContain(next.refreshToken);
    expect(JSON.stringify(audit.entries)).not.toContain(sha256(next.refreshToken));
  });

  it('records exactly one audit entry for one reuse', async () => {
    const { tokens } = await signUp();
    await refresh(tokens.refreshToken).expect(200);
    await refresh(tokens.refreshToken).expect(401);
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]).toMatchObject({ action: 'session.reuse_detected' });
  });

  it('of two parallel refreshes with the same token, exactly one gets new tokens', async () => {
    const { tokens } = await signUp();
    const responses = await Promise.all([
      refresh(tokens.refreshToken),
      refresh(tokens.refreshToken),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 401]);
    // The loser saw the winner's revocation (reuse), so the winner's new token is revoked too.
    const winner = responses.find((r) => r.status === 200)?.body as Tokens;
    expect((await row(winner.refreshToken)).revoked_at).not.toBeNull();
    expect(audit.entries.map((e) => e.action)).toEqual(['session.reuse_detected']);
  });

  it('rejects an expired and an unknown token with the same 401 body, without revoking', async () => {
    const { tokens } = await signUp();
    const unknown = await refresh('not-a-token-we-issued').expect(401);
    clock.advance(REFRESH_TTL_SECONDS * 1000);
    const expired = await refresh(tokens.refreshToken).expect(401);
    for (const response of [unknown, expired]) {
      expect(response.headers['content-type']).toMatch(/^application\/problem\+json/);
      expect(publicFields(response.body as Record<string, unknown>)).toEqual(
        publicFields(unknown.body as Record<string, unknown>),
      );
    }
    expect(unknown.body).toMatchObject({
      code: 'INVALID_CREDENTIALS',
      status: 401,
      detail: 'The refresh token is invalid or has expired.',
    });
    expect((await row(tokens.refreshToken)).revoked_at).toBeNull();
    expect(audit.entries).toHaveLength(0);
  });

  it('a refresh one millisecond before expiry still rotates', async () => {
    const { tokens } = await signUp();
    clock.advance(REFRESH_TTL_SECONDS * 1000 - 1);
    await refresh(tokens.refreshToken).expect(200);
  });

  it('a disabled user cannot refresh; the family is revoked and the 401 is the same', async () => {
    const { id, tokens } = await signUp();
    const unknown = await refresh('not-a-token-we-issued').expect(401);
    await pool.query("UPDATE user_account SET status = 'DISABLED' WHERE id = $1", [id]);
    const disabled = await refresh(tokens.refreshToken).expect(401);
    expect(publicFields(disabled.body as Record<string, unknown>)).toEqual(
      publicFields(unknown.body as Record<string, unknown>),
    );
    expect((await row(tokens.refreshToken)).revoked_at).toEqual(start);
    expect(audit.entries).toEqual([
      expect.objectContaining({
        action: 'session.revoked',
        entityType: 'RefreshTokenFamily',
        after: { userId: id, reason: 'USER_INACTIVE', revokedCount: 1 },
      }),
    ]);
  });

  it('logout is 204, ends the family, is idempotent and records exactly one audit entry', async () => {
    const { id, tokens } = await signUp();
    const next = (await refresh(tokens.refreshToken).expect(200)).body as Tokens;

    await logout(next.refreshToken).expect(204);
    expect(audit.entries).toEqual([
      expect.objectContaining({
        action: 'session.revoked',
        entityType: 'RefreshTokenFamily',
        entityId: (await row(next.refreshToken)).family_id,
        inTransaction: true,
        after: { userId: id, reason: 'LOGOUT', revokedCount: 1 },
      }),
    ]);
    audit.clear();

    await refresh(next.refreshToken).expect(401);
    await refresh(tokens.refreshToken).expect(401);
    audit.clear();

    await logout(next.refreshToken).expect(204);
    await logout('not-a-token-we-issued').expect(204);
    expect(audit.entries).toHaveLength(0);
  });

  it('logout leaves other sessions of the same user alone', async () => {
    const { email, tokens } = await signUp();
    const other = (await http().post('/api/v1/auth/login').send({ email, password }).expect(200))
      .body as Tokens;
    await logout(tokens.refreshToken).expect(204);
    await refresh(other.refreshToken).expect(200);
  });

  it.each([
    ['/api/v1/auth/refresh', {}],
    ['/api/v1/auth/refresh', { refreshToken: '' }],
    ['/api/v1/auth/logout', { refreshToken: 'x', extra: true }],
  ])('%s rejects a malformed body %j with 400', async (path, body) => {
    const response = await http().post(path).send(body).expect(400);
    expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('/auth/me needs a token and reads the account from the database', async () => {
    const { id, email, tokens } = await signUp();
    await http().get('/api/v1/auth/me').expect(401);

    const me = await http()
      .get('/api/v1/auth/me')
      .auth(tokens.accessToken, { type: 'bearer' })
      .expect(200);
    expect(me.body).toEqual({ id, email, role: 'CONTRIBUTOR', status: 'ACTIVE' });
    expect(me.text).not.toMatch(/password|hash/i);

    // An admin-style change in the database shows at once, although the token says CONTRIBUTOR.
    await pool.query("UPDATE user_account SET role = 'ADMIN' WHERE id = $1", [id]);
    const changed = await http()
      .get('/api/v1/auth/me')
      .auth(tokens.accessToken, { type: 'bearer' })
      .expect(200);
    expect(changed.body).toMatchObject({ role: 'ADMIN' });
  });

  it('documents the three operations', async () => {
    const doc = (await http().get('/api/docs-json').expect(200)).body as {
      paths: Record<string, { post?: OpenApiOperation; get?: OpenApiOperation }>;
    };
    expect(doc.paths['/api/v1/auth/refresh']?.post).toMatchObject({
      security: [],
      operationId: 'iam_refresh',
    });
    expect(doc.paths['/api/v1/auth/refresh']?.post?.responses).toHaveProperty('401');
    expect(doc.paths['/api/v1/auth/logout']?.post).toMatchObject({
      security: [],
      operationId: 'iam_logout',
    });
    expect(doc.paths['/api/v1/auth/logout']?.post?.responses).toHaveProperty('204');
    expect(doc.paths['/api/v1/auth/me']?.get).toMatchObject({ operationId: 'iam_me' });
    expect(doc.paths['/api/v1/auth/me']?.get?.responses).toHaveProperty('401');
  });
});
