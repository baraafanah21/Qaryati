import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../../src/app.module';
import type { AppEnv } from '../../src/config/app-env';
import { createTestTokenIssuer, Role } from '../../src/modules/iam';
import { configureApp } from '../../src/platform/http/configure-app';
import { AUDIT_RECORDER, CLOCK, type Clock } from '../../src/shared/kernel';
import { InMemoryAuditRecorder } from '../support/in-memory-audit-recorder';

const CLAIMS = '/api/v1/claims';
const CURATION = '/api/v1/curation';
const MISSING = '00000000-0000-7000-8000-0000000d00ff';

const USERS = {
  contributor: { id: '00000000-0000-7000-8000-0000000d0001', role: Role.CONTRIBUTOR },
  editor: { id: '00000000-0000-7000-8000-0000000d0002', role: Role.EDITOR },
  admin: { id: '00000000-0000-7000-8000-0000000d0003', role: Role.ADMIN },
} as const;
type UserName = keyof typeof USERS;

const VILLAGE_ID = '00000000-0000-7000-8000-0000000d0010';
const SOURCE_ID = '00000000-0000-7000-8000-0000000d0020';
const SOURCE_2_ID = '00000000-0000-7000-8000-0000000d0021';

const ACTIONS = ['verify', 'dispute', 'reject', 'prefer'] as const;

interface ClaimBody {
  id: string;
  status: string;
  isPreferred: boolean;
  reviewedBy: string | null;
  reviewNote: string | null;
  version: number;
}

describe('curation review: /api/v1/claims and /api/v1/curation (e2e)', () => {
  let app: INestApplication<App>;
  let owner: Pool;
  const audit = new InMemoryAuditRecorder();
  const tokens: Record<UserName, string> = { contributor: '', editor: '', admin: '' };
  let counter = 0;

  const http = () => request(app.getHttpServer());
  const as = (user: UserName) => `Bearer ${tokens[user]}`;

  async function insertClaim(
    options: {
      author?: UserName;
      status?: string;
      preferred?: boolean;
      sourceId?: string | null;
      groupKey?: string;
      valueHash?: string;
    } = {},
  ): Promise<string> {
    counter += 1;
    const result = await owner.query<{ id: string }>(
      `INSERT INTO claim (id, claim_type, village_id, group_key, value_hash, source_id, status,
         is_preferred, created_by, version, created_at, updated_at)
       VALUES (gen_random_uuid(), 'MEASURE', $1, $2, $3, $4, $5, $6, $7, 1, now(), now())
       RETURNING id`,
      [
        VILLAGE_ID,
        options.groupKey ?? `measure|${VILLAGE_ID}|e2e-${counter}`,
        options.valueHash ?? `e2e-value-${counter}`,
        options.sourceId === undefined ? SOURCE_ID : options.sourceId,
        options.status ?? 'UNVERIFIED',
        options.preferred ?? false,
        USERS[options.author ?? 'contributor'].id,
      ],
    );
    return result.rows[0]!.id;
  }

  const act = (action: (typeof ACTIONS)[number], id: string, user: UserName = 'editor') =>
    http().post(`${CLAIMS}/${id}/${action}`).set('Authorization', as(user)).set('If-Match', '"1"');

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AUDIT_RECORDER)
      .useValue(audit)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    owner = new Pool({ connectionString: process.env.TEST_DATABASE_OWNER_URL });
    for (const [name, user] of Object.entries(USERS)) {
      await owner.query(
        `INSERT INTO user_account (id, email, password_hash, role, status, version, created_at, updated_at)
         VALUES ($1, $2, 'hash', $3, 'ACTIVE', 1, now(), now()) ON CONFLICT (id) DO NOTHING`,
        [user.id, `claims-e2e-${name}@test.local`, user.role],
      );
    }
    await owner.query(
      `INSERT INTO village (id, slug, settlement_status, publication_status, display_name_ar,
         created_by, version, created_at, updated_at)
       VALUES ($1, 'claims-e2e-village', 'INHABITED', 'DRAFT', 'قرية', $2, 1, now(), now())
       ON CONFLICT (id) DO NOTHING`,
      [VILLAGE_ID, USERS.editor.id],
    );
    for (const id of [SOURCE_ID, SOURCE_2_ID]) {
      await owner.query(
        `INSERT INTO source (id, source_type, title, reliability, created_by, version, created_at, updated_at)
         VALUES ($1, 'BOOK', $2, 4, $3, 1, now(), now()) ON CONFLICT (id) DO NOTHING`,
        [id, `Claims e2e source ${id}`, USERS.editor.id],
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

  beforeEach(() => audit.clear());

  afterAll(async () => {
    await owner?.end();
    await app?.close();
  });

  describe('authorisation', () => {
    it.each(ACTIONS)('answers 403 to a contributor on POST /claims/{id}/%s', async (action) => {
      const id = await insertClaim({ author: 'editor' });
      await act(action, id, 'contributor').send({ note: 'n' }).expect(403);
    });

    it('answers 401 without a token and 403 to a contributor on the read endpoints', async () => {
      const id = await insertClaim();
      await http().get(`${CLAIMS}/${id}`).expect(401);
      for (const path of [`${CLAIMS}/${id}`, `${CURATION}/queue`, `${CURATION}/conflicts`]) {
        await http().get(path).set('Authorization', as('contributor')).expect(403);
      }
    });

    it('answers 403 SELF_VERIFICATION_FORBIDDEN when the author verifies their own claim', async () => {
      const id = await insertClaim({ author: 'editor' });
      const res = await act('verify', id).expect(403);
      expect(res.body).toMatchObject({ code: 'SELF_VERIFICATION_FORBIDDEN' });
    });
  });

  describe('POST /claims/{id}/verify', () => {
    it('verifies without a body, publishes the first claim and audits once', async () => {
      const id = await insertClaim();

      const res = await act('verify', id).expect(200);

      expect(res.headers.etag).toBe('"2"');
      expect(res.body).toMatchObject({
        id,
        status: 'VERIFIED',
        isPreferred: true,
        reviewedBy: USERS.editor.id,
      } satisfies Partial<ClaimBody>);
      expect(audit.entries).toEqual([
        expect.objectContaining({ action: 'claim.verified', entityId: id, villageId: VILLAGE_ID }),
      ]);
    });

    it('answers 422 for a claim without a source', async () => {
      const id = await insertClaim({ sourceId: null });
      const res = await act('verify', id).expect(422);
      expect(res.body).toMatchObject({ code: 'CONSTRAINT_VIOLATION' });
    });

    it('answers 428 without If-Match and 412 with a stale one', async () => {
      const id = await insertClaim();
      await http().post(`${CLAIMS}/${id}/verify`).set('Authorization', as('editor')).expect(428);
      const res = await http()
        .post(`${CLAIMS}/${id}/verify`)
        .set('Authorization', as('editor'))
        .set('If-Match', '"7"')
        .expect(412);
      expect(res.body).toMatchObject({ code: 'VERSION_CONFLICT' });
    });

    it('answers 404 for an unknown claim and 400 for an unknown body field', async () => {
      await act('verify', MISSING).expect(404);
      const id = await insertClaim();
      await act('verify', id).send({ note: 'ok', status: 'VERIFIED' }).expect(400);
    });
  });

  describe.each(['dispute', 'reject'] as const)('POST /claims/{id}/%s', (action) => {
    it('answers 422 without a note', async () => {
      const id = await insertClaim();
      const res = await act(action, id).send({}).expect(422);
      expect(res.body).toMatchObject({ code: 'CONSTRAINT_VIOLATION' });
      expect(audit.entries).toHaveLength(0);
    });

    it('records the note and audits once', async () => {
      const id = await insertClaim();
      const res = await act(action, id).send({ note: 'Another census disagrees' }).expect(200);
      expect(res.body).toMatchObject({ reviewNote: 'Another census disagrees' });
      expect(audit.entries).toEqual([
        expect.objectContaining({
          action: action === 'dispute' ? 'claim.disputed' : 'claim.rejected',
          entityId: id,
          villageId: VILLAGE_ID,
        }),
      ]);
    });
  });

  describe('POST /claims/{id}/prefer', () => {
    it('moves the published answer to another verified claim and audits once', async () => {
      const groupKey = `measure|${VILLAGE_ID}|prefer`;
      const old = await insertClaim({ groupKey, status: 'VERIFIED', preferred: true });
      const chosen = await insertClaim({ groupKey, status: 'VERIFIED', sourceId: SOURCE_2_ID });

      const res = await act('prefer', chosen, 'admin').send({ note: 'Better source' }).expect(200);

      expect(res.body).toMatchObject({ id: chosen, isPreferred: true, version: 2 });
      const oldRes = await http()
        .get(`${CLAIMS}/${old}`)
        .set('Authorization', as('editor'))
        .expect(200);
      expect(oldRes.body).toMatchObject({ isPreferred: false, status: 'VERIFIED', version: 2 });
      expect(audit.entries).toEqual([
        expect.objectContaining({ action: 'claim.preferred', entityId: chosen }),
      ]);
    });

    it('answers 422 for a claim that is not verified', async () => {
      const id = await insertClaim();
      await act('prefer', id).expect(422);
    });
  });

  describe('GET /curation/queue and /curation/conflicts', () => {
    it('lists the review queue and the conflicts for an editor', async () => {
      const groupKey = `measure|${VILLAGE_ID}|conflict`;
      const first = await insertClaim({ groupKey, valueHash: 'conflict-a' });
      const second = await insertClaim({
        groupKey,
        valueHash: 'conflict-b',
        sourceId: SOURCE_2_ID,
      });

      const queue = await http()
        .get(`${CURATION}/queue`)
        .query({ villageId: VILLAGE_ID, claimType: 'MEASURE', size: 100 })
        .set('Authorization', as('editor'))
        .expect(200);
      const queued = (queue.body as { content: ClaimBody[] }).content.map((claim) => claim.id);
      expect(queued).toEqual(expect.arrayContaining([first, second]));
      expect(
        (queue.body as { content: ClaimBody[] }).content.every((c) => c.status === 'UNVERIFIED'),
      ).toBe(true);

      const conflicts = await http()
        .get(`${CURATION}/conflicts`)
        .query({ villageId: VILLAGE_ID })
        .set('Authorization', as('editor'))
        .expect(200);
      expect(conflicts.body).toMatchObject({
        content: expect.arrayContaining([
          {
            groupKey,
            villageId: VILLAGE_ID,
            claimType: 'MEASURE',
            distinctValues: 2,
            claimCount: 2,
            claimIds: [first, second],
          },
        ]) as unknown,
      });
    });

    it('answers 400 for an unknown queue status', async () => {
      await http()
        .get(`${CURATION}/queue`)
        .query({ status: 'VERIFIED' })
        .set('Authorization', as('editor'))
        .expect(400);
    });
  });
});
