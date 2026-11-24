import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import type { AppEnv } from '../src/config/app-env';
import { createTestTokenIssuer, Role, type TestTokenIssuer } from '../src/modules/iam';
import { configureApp } from '../src/platform/http/configure-app';
import { AUDIT_RECORDER, CLOCK, FixedClock } from '../src/shared/kernel';
import { InMemoryAuditRecorder } from './support/in-memory-audit-recorder';

interface Account {
  id: string;
  email: string;
  role: string;
  status: string;
  version: number;
}

/** The fields of a problem (or account) body the assertions read. */
interface Problem {
  code?: string;
  detail?: string;
  role?: string;
}

describe('user administration (#32, e2e)', () => {
  let app: INestApplication<App>;
  let issuer: TestTokenIssuer;
  let admin: string;
  const adminId = randomUUID();
  const audit = new InMemoryAuditRecorder();
  const clock = new FixedClock('2026-11-24T10:00:00Z');
  const password = 'correct horse battery';
  const http = () => request(app.getHttpServer());
  const asAdmin = (req: request.Test) => req.set('Authorization', `Bearer ${admin}`);

  async function registerAndLogin(): Promise<{ account: Account; refreshToken: string }> {
    const email = `admin32-${randomUUID()}@example.test`;
    const account = (
      await http().post('/api/v1/auth/register').send({ email, password }).expect(201)
    ).body as Account;
    const tokens = (await http().post('/api/v1/auth/login').send({ email, password }).expect(200))
      .body as { refreshToken: string };
    return { account, refreshToken: tokens.refreshToken };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AUDIT_RECORDER)
      .useValue(audit)
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    const config = app.get<ConfigService<AppEnv, true>>(ConfigService);
    issuer = await createTestTokenIssuer({
      privateKeyFile: config.get('JWT_PRIVATE_KEY_FILE', { infer: true }),
      publicKeyFile: config.get('JWT_PUBLIC_KEY_FILE', { infer: true }),
      issuer: config.get('JWT_ISSUER', { infer: true }),
      clock,
    });
    admin = await issuer.mint({ id: adminId, role: Role.ADMIN });
  });
  beforeEach(() => audit.clear());
  afterAll(async () => {
    await app?.close();
  });

  it('is for administrators only: 401 without a token, 403 for an editor', async () => {
    await http().get('/api/v1/users').expect(401);
    const editor = await issuer.mint({ id: randomUUID(), role: Role.EDITOR });
    const res = await http()
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${editor}`)
      .expect(403);
    expect((res.body as Problem).code).toBe('FORBIDDEN');
    const { account } = await registerAndLogin();
    await http()
      .patch(`/api/v1/users/${account.id}/role`)
      .set('Authorization', `Bearer ${editor}`)
      .set('If-Match', '"1"')
      .send({ role: 'ADMIN' })
      .expect(403);
  });

  it('lists accounts with role and status filters and pagination, without credentials', async () => {
    const { account } = await registerAndLogin();
    await asAdmin(http().patch(`/api/v1/users/${account.id}/status`).set('If-Match', '"1"'))
      .send({ status: 'DISABLED' })
      .expect(200);
    const res = await asAdmin(http().get('/api/v1/users?status=DISABLED&size=100')).expect(200);
    const page = res.body as { content: Account[]; page: { totalElements: number } };
    expect(page.content.map((a) => a.id)).toContain(account.id);
    expect(page.content.every((a) => a.status === 'DISABLED')).toBe(true);
    expect(res.text).not.toMatch(/password|hash|token/i);
    const editors = await asAdmin(http().get('/api/v1/users?role=EDITOR')).expect(200);
    expect((editors.body as { content: Account[] }).content.every((a) => a.role === 'EDITOR')).toBe(
      true,
    );
    await asAdmin(http().get('/api/v1/users?role=ROOT')).expect(400);
    await asAdmin(http().get('/api/v1/users?size=500')).expect(400);
  });

  it('changes a role, revokes every refresh token and audits it', async () => {
    const first = await registerAndLogin();
    // A second session (family) of the same user.
    const second = (
      await http()
        .post('/api/v1/auth/login')
        .send({ email: first.account.email, password })
        .expect(200)
    ).body as { refreshToken: string };
    audit.clear();

    const res = await asAdmin(
      http().patch(`/api/v1/users/${first.account.id}/role`).set('If-Match', '"1"'),
    )
      .send({ role: 'EDITOR' })
      .expect(200);
    expect(res.headers.etag).toBe('"2"');
    expect(res.body).toMatchObject({ id: first.account.id, role: 'EDITOR', version: 2 });

    // Both sessions are over: the old refresh tokens are rejected.
    await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: first.refreshToken })
      .expect(401);
    await http()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: second.refreshToken })
      .expect(401);

    // The later 401s add session.reuse_detected entries: the tokens were revoked.
    expect(audit.entries.filter((e) => e.action === 'user_account.role_changed')).toEqual([
      expect.objectContaining({
        action: 'user_account.role_changed',
        entityType: 'UserAccount',
        entityId: first.account.id,
        before: { role: 'CONTRIBUTOR', status: 'ACTIVE' },
        after: { role: 'EDITOR', status: 'ACTIVE', revokedCount: 2 },
        inTransaction: true,
      }),
    ]);

    // A new login carries the new role.
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ email: first.account.email, password })
      .expect(200);
    const me = await http()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${(login.body as { accessToken: string }).accessToken}`)
      .expect(200);
    expect((me.body as Problem).role).toBe('EDITOR');
  });

  it('disables an account: refresh tokens revoked and login refused', async () => {
    const { account, refreshToken } = await registerAndLogin();
    await asAdmin(http().patch(`/api/v1/users/${account.id}/status`).set('If-Match', '"1"'))
      .send({ status: 'DISABLED' })
      .expect(200);
    await http().post('/api/v1/auth/refresh').send({ refreshToken }).expect(401);
    await http().post('/api/v1/auth/login').send({ email: account.email, password }).expect(401);
    expect(audit.entries.find((e) => e.action === 'user_account.status_changed')).toMatchObject({
      action: 'user_account.status_changed',
      after: { status: 'DISABLED', revokedCount: 1 },
    });
  });

  it('refuses to let an administrator change their own account (422)', async () => {
    const res = await asAdmin(http().patch(`/api/v1/users/${adminId}/role`).set('If-Match', '"1"'))
      .send({ role: 'CONTRIBUTOR' })
      .expect(422);
    expect((res.body as Problem).code).toBe('SELF_ADMINISTRATION_FORBIDDEN');
    await asAdmin(http().patch(`/api/v1/users/${adminId}/status`).set('If-Match', '"1"'))
      .send({ status: 'DISABLED' })
      .expect(422);
    expect(audit.entries).toEqual([]);
  });

  it('answers 428, 412, 404 and 400 like every versioned write', async () => {
    const { account, refreshToken } = await registerAndLogin();
    const patch = () => asAdmin(http().patch(`/api/v1/users/${account.id}/role`));
    await patch().send({ role: 'EDITOR' }).expect(428);
    const stale = await patch().set('If-Match', '"7"').send({ role: 'EDITOR' }).expect(412);
    expect((stale.body as Problem).code).toBe('VERSION_CONFLICT');
    await asAdmin(http().patch(`/api/v1/users/${randomUUID()}/role`).set('If-Match', '"1"'))
      .send({ role: 'EDITOR' })
      .expect(404);
    await patch().set('If-Match', '"1"').send({ role: 'ROOT' }).expect(400);
    await patch().set('If-Match', '"1"').send({ role: 'EDITOR', status: 'ACTIVE' }).expect(400);
    // Nothing changed, so the session survives the failed attempts.
    await http().post('/api/v1/auth/refresh').send({ refreshToken }).expect(200);
    expect(audit.entries.filter((e) => e.action.endsWith('_changed'))).toEqual([]);
  });
});
