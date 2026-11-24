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
import { CLOCK, type Clock } from '../../src/shared/kernel';

const USERS = {
  contributor: { id: '00000000-0000-7000-8000-000000440001', role: Role.CONTRIBUTOR },
  editor: { id: '00000000-0000-7000-8000-000000440002', role: Role.EDITOR },
  admin: { id: '00000000-0000-7000-8000-000000440003', role: Role.ADMIN },
} as const;
type UserName = keyof typeof USERS;

interface Entry {
  id: string;
  action: string;
  entityId: string;
  villageId: string | null;
  occurredAt: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}
interface PageBody {
  content: Entry[];
  nextCursor: string | null;
}

describe('audit read APIs: /villages/{id}/history-log and /audit (e2e)', () => {
  let app: INestApplication<App>;
  let owner: Pool;
  const tokens: Record<UserName, string> = { contributor: '', editor: '', admin: '' };
  const villageId = randomUUID();
  const entityId = `audit-e2e-${randomUUID()}`;
  const ids: string[] = [];

  const http = () => request(app.getHttpServer());
  const as = (user: UserName) => `Bearer ${tokens[user]}`;
  const get = (path: string, user?: UserName, query: Record<string, string | number> = {}) => {
    const req = http().get(`/api/v1${path}`).query(query);
    return user ? req.set('Authorization', as(user)) : req;
  };

  /** Follows nextCursor from the first page and returns every entry. */
  async function walk(path: string, user: UserName, query: Record<string, string | number>) {
    const seen: Entry[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: PageBody = (
        await get(path, user, cursor ? { ...query, cursor } : query).expect(200)
      ).body as PageBody;
      seen.push(...page.content);
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor !== null && pages < 50);
    return { seen, pages };
  }

  beforeAll(async () => {
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    configureApp(app);
    await app.init();
    owner = new Pool({ connectionString: process.env.TEST_DATABASE_OWNER_URL });

    // Seven entries of one village (five at the same instant), as the owner role.
    for (let i = 0; i < 7; i += 1) {
      const id = randomUUID();
      ids.push(id);
      await owner.query(
        `INSERT INTO audit_entry (id, action, entity_type, entity_id, village_id, actor_id,
           request_id, occurred_at, before, after)
         VALUES ($1, 'village.updated', 'Village', $2, $3, $4, 'req', $5, $6, $7)`,
        [
          id,
          entityId,
          villageId,
          USERS.editor.id,
          i < 5 ? '2026-11-22T10:00:00Z' : `2026-11-22T1${i}:00:00Z`,
          { slug: 'before' },
          { slug: 'after', notAllowListed: 'x' },
        ],
      );
    }

    const config = app.get<ConfigService<AppEnv, true>>(ConfigService);
    const issuer = await createTestTokenIssuer({
      privateKeyFile: config.get('JWT_PRIVATE_KEY_FILE', { infer: true }),
      publicKeyFile: config.get('JWT_PUBLIC_KEY_FILE', { infer: true }),
      issuer: config.get('JWT_ISSUER', { infer: true }),
      clock: app.get<Clock>(CLOCK),
    });
    for (const [name, user] of Object.entries(USERS)) {
      tokens[name as UserName] = await issuer.mint(user);
    }
  });

  afterAll(async () => {
    await owner?.end();
    await app?.close();
  });

  describe('GET /villages/{id}/history-log', () => {
    it('pages through every entry of the village once, newest first (editor)', async () => {
      const { seen, pages } = await walk(`/villages/${villageId}/history-log`, 'editor', {
        limit: 2,
      });
      expect(pages).toBe(4);
      expect(seen.map((e) => e.id).sort()).toEqual([...ids].sort());
      expect(seen[0]?.occurredAt).toBe('2026-11-22T16:00:00.000Z');
      const times = seen.map((e) => e.occurredAt);
      expect(times).toEqual([...times].sort().reverse());
      expect(seen[0]).toMatchObject({
        action: 'village.updated',
        villageId,
        before: { slug: 'before' },
        after: { slug: 'after' },
      });
    });

    it('is readable by an admin too; an unknown village is an empty page', async () => {
      await get(`/villages/${villageId}/history-log`, 'admin').expect(200);
      const res = await get(`/villages/${randomUUID()}/history-log`, 'editor').expect(200);
      expect(res.body).toEqual({ content: [], nextCursor: null });
    });

    it('403 for a contributor, 401 without a token', async () => {
      await get(`/villages/${villageId}/history-log`, 'contributor').expect(403);
      await get(`/villages/${villageId}/history-log`).expect(401);
    });

    it('400 for a forged cursor, a limit above 100 or an id that is not a UUID', async () => {
      await get(`/villages/${villageId}/history-log`, 'editor', { cursor: 'forged' }).expect(400);
      await get(`/villages/${villageId}/history-log`, 'editor', { limit: 101 }).expect(400);
      await get('/villages/not-a-uuid/history-log', 'editor').expect(400);
    });
  });

  describe('GET /audit', () => {
    it('filters by entity and pages with the same keyset (admin)', async () => {
      const { seen } = await walk('/audit', 'admin', {
        entityType: 'Village',
        entityId,
        limit: 3,
      });
      expect(seen.map((e) => e.id).sort()).toEqual([...ids].sort());
    });

    it('combines actor, action and a [from, to) time range', async () => {
      const res = await get('/audit', 'admin', {
        actorId: USERS.editor.id,
        action: 'village.updated',
        entityId,
        from: '2026-11-22T10:00:00Z',
        to: '2026-11-22T15:00:00Z',
      }).expect(200);
      const body = res.body as PageBody;
      expect(body.content).toHaveLength(5);
      expect(body.content.every((e) => e.occurredAt === '2026-11-22T10:00:00.000Z')).toBe(true);
    });

    it('403 for an editor and a contributor, 401 without a token', async () => {
      await get('/audit', 'editor').expect(403);
      await get('/audit', 'contributor').expect(403);
      await get('/audit').expect(401);
    });

    it('400 for an empty time range, a bad date or an unknown parameter', async () => {
      const at = '2026-11-22T10:00:00Z';
      await get('/audit', 'admin', { from: at, to: at }).expect(400);
      await get('/audit', 'admin', { from: 'yesterday' }).expect(400);
      await get('/audit', 'admin', { page: 2 }).expect(400);
    });
  });
});
