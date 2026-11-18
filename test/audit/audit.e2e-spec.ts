import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import type { AppEnv } from '../../src/config/app-env';
import { createTestTokenIssuer, Role } from '../../src/modules/iam';
import { configureApp } from '../../src/platform/http/configure-app';
import { CLOCK, FixedClock } from '../../src/shared/kernel';

interface AuditRow {
  action: string;
  entity_type: string;
  entity_id: string;
  actor_id: string | null;
  request_id: string | null;
  occurred_at: Date;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

// The real app, with the real DrizzleAuditRecorder (no AUDIT_RECORDER override):
// every write leaves exactly one row in audit_entry.
describe('Audit trail through the real app (e2e)', () => {
  let app: INestApplication<App>;
  let owner: Pool;
  const clock = new FixedClock('2026-11-16T10:00:00Z');

  const entriesFor = async (entityId: string): Promise<AuditRow[]> =>
    (await owner.query<AuditRow>('SELECT * FROM audit_entry WHERE entity_id = $1', [entityId]))
      .rows;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CLOCK)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    owner = new Pool({ connectionString: process.env.TEST_DATABASE_OWNER_URL });
  });

  afterAll(async () => {
    await owner?.end();
    await app?.close();
  });

  it('records a registration and a new source with action, actor and allow-listed snapshots', async () => {
    const email = `audit20-${randomUUID()}@example.test`;
    const registered = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: 'audit trail passphrase' })
      .expect(201);
    const userId = (registered.body as { id: string }).id;

    expect(await entriesFor(userId)).toEqual([
      {
        id: expect.any(String) as string,
        action: 'user_account.created',
        entity_type: 'UserAccount',
        entity_id: userId,
        village_id: null,
        // Registration is anonymous.
        actor_id: null,
        request_id: registered.headers['x-request-id'],
        occurred_at: new Date('2026-11-16T10:00:00Z'),
        before: null,
        // No email (personal data), no passwordHash, no version or timestamps.
        after: { role: 'CONTRIBUTOR', status: 'ACTIVE' },
      },
    ]);
    const { rows } = await owner.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM audit_entry WHERE before::text ILIKE $1 OR after::text ILIKE $1',
      [`%${email}%`],
    );
    expect(rows[0]?.n).toBe(0);

    const config = app.get<ConfigService<AppEnv, true>>(ConfigService);
    const issuer = await createTestTokenIssuer({
      privateKeyFile: config.get('JWT_PRIVATE_KEY_FILE', { infer: true }),
      publicKeyFile: config.get('JWT_PUBLIC_KEY_FILE', { infer: true }),
      issuer: config.get('JWT_ISSUER', { infer: true }),
      clock,
    });
    const token = await issuer.mint({ id: userId, role: Role.CONTRIBUTOR });
    const title = `Audit trail source ${randomUUID()}`;
    const created = await request(app.getHttpServer())
      .post('/api/v1/sources')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sourceType: 'BOOK',
        title,
        author: 'Audit Author',
        publisher: null,
        publishedYear: 2001,
        url: null,
        isbn: null,
        reliability: 3,
        notes: null,
      })
      .expect(201);
    const sourceId = (created.body as { id: string }).id;

    expect(await entriesFor(sourceId)).toEqual([
      {
        id: expect.any(String) as string,
        action: 'source.created',
        entity_type: 'Source',
        entity_id: sourceId,
        village_id: null,
        actor_id: userId,
        request_id: created.headers['x-request-id'],
        occurred_at: new Date('2026-11-16T10:00:00Z'),
        before: null,
        after: {
          sourceType: 'BOOK',
          title,
          author: 'Audit Author',
          publisher: null,
          publishedYear: 2001,
          url: null,
          isbn: null,
          reliability: 3,
          notes: null,
        },
      },
    ]);
  });
});
