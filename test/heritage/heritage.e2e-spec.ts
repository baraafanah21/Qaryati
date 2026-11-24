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

const VILLAGES = '/api/v1/villages';
const CLAIMS = '/api/v1/claims';
const MISSING = '00000000-0000-7000-8000-0000002f00ff';

const USERS = {
  author: { id: '00000000-0000-7000-8000-0000002f0001', role: Role.CONTRIBUTOR },
  stranger: { id: '00000000-0000-7000-8000-0000002f0002', role: Role.CONTRIBUTOR },
  editor: { id: '00000000-0000-7000-8000-0000002f0003', role: Role.EDITOR },
} as const;
type UserName = keyof typeof USERS;

const SOURCE_ID = '00000000-0000-7000-8000-0000002f0020';

interface FactBody extends Record<string, unknown> {
  claimId: string;
  status: string;
  isPreferred: boolean;
  version: number;
}

interface PageBody {
  content: FactBody[];
  page: { totalElements: number };
}

type Collection = 'history' | 'events' | 'landmarks' | 'cultural-items';

const BODIES: Record<Collection, Record<string, unknown>> = {
  history: { summary: 'The village was founded in the Ottoman period.' },
  events: {
    title: 'The great flood',
    description: 'The wadi flooded the lower quarter.',
    startDate: '1948-01-01',
    datePrecision: 'YEAR',
    sourceId: SOURCE_ID,
  },
  landmarks: {
    name: 'Old Mosque',
    landmarkType: 'MOSQUE',
    location: { latitude: 32.123456, longitude: 35.234567 },
    era: 'OTTOMAN',
  },
  'cultural-items': { category: 'DISH', name: 'Musakhan', description: 'Bread with onions.' },
};

describe('heritage: /api/v1/villages/{id}/history|events|landmarks|cultural-items (e2e)', () => {
  let app: INestApplication<App>;
  let owner: Pool;
  const audit = new InMemoryAuditRecorder();
  const tokens: Record<UserName, string> = { author: '', stranger: '', editor: '' };
  let counter = 0;

  const http = () => request(app.getHttpServer());
  const as = (user: UserName) => `Bearer ${tokens[user]}`;

  async function village(status = 'PUBLISHED'): Promise<string> {
    counter += 1;
    const result = await owner.query<{ id: string }>(
      `INSERT INTO village (id, slug, settlement_status, publication_status, display_name_ar,
         created_by, version, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, 'INHABITED', $2, 'قرية', $3, 1, now(), now())
       RETURNING id`,
      [`heritage-e2e-${counter}`, status, USERS.editor.id],
    );
    return result.rows[0]!.id;
  }

  const submit = (
    villageId: string,
    collection: Collection,
    payload: object = BODIES[collection],
    user: UserName = 'author',
  ) => {
    const url = `${VILLAGES}/${villageId}/${collection}`;
    const req = collection === 'history' ? http().put(url) : http().post(url);
    return req.set('Authorization', as(user)).send(payload);
  };

  /** Submitted by the author with a source (verify needs one), verified by the editor: published. */
  async function published(villageId: string, collection: Collection, payload?: object) {
    const sourced = { ...(payload ?? BODIES[collection]), sourceId: SOURCE_ID };
    const res = await submit(villageId, collection, sourced).expect(201);
    const body = res.body as FactBody;
    await http()
      .post(`${CLAIMS}/${body.claimId}/verify`)
      .set('Authorization', as('editor'))
      .set('If-Match', '"1"')
      .expect(200);
    return body;
  }

  const list = (villageId: string, path: string, user?: UserName) => {
    const req = http().get(`${VILLAGES}/${villageId}/${path}`);
    return user ? req.set('Authorization', as(user)) : req;
  };
  const ids = async (villageId: string, path: string, user?: UserName) =>
    ((await list(villageId, path, user).expect(200)).body as PageBody).content.map(
      (f) => f.claimId,
    );

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
        [user.id, `heritage-e2e-${name}@test.local`, user.role],
      );
    }
    await owner.query(
      `INSERT INTO source (id, source_type, title, reliability, created_by, version, created_at, updated_at)
       VALUES ($1, 'BOOK', 'Heritage e2e source', 4, $2, 1, now(), now()) ON CONFLICT (id) DO NOTHING`,
      [SOURCE_ID, USERS.editor.id],
    );

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

  describe('create', () => {
    it.each<[Collection, Record<string, unknown>]>([
      ['history', { summary: 'The village was founded in the Ottoman period.' }],
      ['events', { title: 'The great flood', startDate: '1948-01-01', endDate: null }],
      [
        'landmarks',
        {
          landmarkType: 'MOSQUE',
          description: null,
          location: { latitude: 32.12346, longitude: 35.23457 },
        },
      ],
      ['cultural-items', { category: 'DISH', name: 'Musakhan' }],
    ])('%s: 201 with the claim, an ETag and one audit entry', async (collection, expected) => {
      const villageId = await village();
      const res = await submit(villageId, collection).expect(201);

      expect(res.body).toMatchObject({
        status: 'UNVERIFIED',
        isPreferred: false,
        createdBy: USERS.author.id,
        version: 1,
        ...expected,
      });
      expect(res.headers.etag).toBe('"1"');
      expect(audit.entries).toEqual([
        expect.objectContaining({
          action: 'claim.submitted',
          entityId: (res.body as FactBody).claimId,
          villageId,
          inTransaction: true,
        }),
      ]);
    });

    it('events: 422 without a source, the others accept none', async () => {
      const villageId = await village();
      await submit(villageId, 'events', { ...BODIES.events, sourceId: undefined }).expect(422);
      await submit(villageId, 'events', { ...BODIES.events, sourceId: null }).expect(422);
      await submit(villageId, 'landmarks', { ...BODIES.landmarks, sourceId: null }).expect(201);
    });

    it('events: 400 for an unknown precision, 422 for a date that does not match it', async () => {
      const villageId = await village();
      await submit(villageId, 'events', { ...BODIES.events, datePrecision: 'WEEK' }).expect(400);
      const res = await submit(villageId, 'events', {
        ...BODIES.events,
        startDate: '1948-05-15',
      }).expect(422);
      expect(res.body).toMatchObject({
        code: 'VALIDATION_FAILED',
        errors: [expect.objectContaining({ field: 'startDate', code: 'INVALID_VALUE' })],
      });
      const future = await submit(villageId, 'events', {
        ...BODIES.events,
        startDate: '2999-01-01',
      }).expect(422);
      expect(future.body).toMatchObject({
        errors: [expect.objectContaining({ field: 'startDate', code: 'MUST_NOT_BE_FUTURE' })],
      });
      await submit(villageId, 'events', {
        ...BODIES.events,
        startDate: '1948-01-01',
        endDate: '1947-01-01',
      }).expect(422);
    });

    it('landmarks: 422 for coordinates out of range, 400 for an unknown type', async () => {
      const villageId = await village();
      await submit(villageId, 'landmarks', {
        ...BODIES.landmarks,
        location: { latitude: 91, longitude: 35 },
      }).expect(422);
      await submit(villageId, 'landmarks', { ...BODIES.landmarks, landmarkType: 'CASTLE' }).expect(
        400,
      );
    });

    it('answers 409 for the same value again, 404 for an unknown village, 401 anonymously', async () => {
      const villageId = await village();
      await submit(villageId, 'cultural-items').expect(201);
      await submit(villageId, 'cultural-items', undefined, 'stranger').expect(409);
      await submit(MISSING, 'cultural-items').expect(404);
      await http()
        .post(`${VILLAGES}/${villageId}/cultural-items`)
        .send(BODIES['cultural-items'])
        .expect(401);
    });
  });

  describe('read', () => {
    it('shows the public the preferred claims only; events by start date', async () => {
      const villageId = await village();
      const late = await published(villageId, 'events', {
        ...BODIES.events,
        title: 'Late',
        startDate: '1967-06-01',
        datePrecision: 'MONTH',
      });
      const early = await published(villageId, 'events', {
        ...BODIES.events,
        title: 'Early',
        startDate: '1917-01-01',
      });
      const draft = (
        await submit(villageId, 'events', { ...BODIES.events, title: 'Draft' }).expect(201)
      ).body as FactBody;

      const res = await list(villageId, 'events').expect(200);
      const page = res.body as PageBody;
      expect(page.content.map((e) => e.claimId)).toEqual([early.claimId, late.claimId]);
      expect(page.content.every((e) => e.isPreferred && e.status === 'VERIFIED')).toBe(true);

      const unverified = 'events?includeUnverified=true';
      expect(await ids(villageId, unverified, 'editor')).toEqual([
        early.claimId,
        draft.claimId,
        late.claimId,
      ]);
      expect(await ids(villageId, unverified, 'author')).toHaveLength(3);
      expect(await ids(villageId, unverified, 'stranger')).toEqual([early.claimId, late.claimId]);
      expect(await ids(villageId, unverified)).toEqual([early.claimId, late.claimId]);
    });

    it('history: the published overview only', async () => {
      const villageId = await village();
      const overview = await published(villageId, 'history');
      await submit(villageId, 'history', { summary: 'Another view.' }).expect(201);
      expect(await ids(villageId, 'history')).toEqual([overview.claimId]);
    });

    it('filters landmarks by type and cultural items by category', async () => {
      const villageId = await village();
      const mosque = await published(villageId, 'landmarks');
      const spring = await published(villageId, 'landmarks', {
        name: 'Ain al-Balad',
        landmarkType: 'SPRING',
      });
      expect(await ids(villageId, 'landmarks?type=SPRING')).toEqual([spring.claimId]);
      expect(await ids(villageId, 'landmarks?type=MOSQUE')).toEqual([mosque.claimId]);
      expect(await ids(villageId, 'landmarks')).toHaveLength(2);
      await list(villageId, 'landmarks?type=CASTLE').expect(400);

      const dish = await published(villageId, 'cultural-items');
      await published(villageId, 'cultural-items', {
        category: 'FOLK_SONG',
        name: 'Dalouna',
        description: 'A wedding song.',
      });
      expect(await ids(villageId, 'cultural-items?category=DISH')).toEqual([dish.claimId]);
    });

    it('answers 404 for an unknown village and for a draft read anonymously', async () => {
      await list(MISSING, 'landmarks').expect(404);
      const draft = await village('DRAFT');
      await list(draft, 'history').expect(404);
      await list(draft, 'history', 'stranger').expect(200);
    });
  });

  describe('PATCH and DELETE /{claimId}', () => {
    const patch = (
      villageId: string,
      path: string,
      claimId: string,
      user: UserName,
      version?: number,
    ) => {
      const req = http()
        .patch(`${VILLAGES}/${villageId}/${path}/${claimId}`)
        .set('Authorization', as(user));
      return version === undefined ? req : req.set('If-Match', `"${version}"`);
    };
    const remove = (villageId: string, path: string, claimId: string, user: UserName) =>
      http()
        .delete(`${VILLAGES}/${villageId}/${path}/${claimId}`)
        .set('Authorization', as(user))
        .set('If-Match', '"1"');

    it('the author edits: 428 without If-Match, 412 when stale, 200 with the new value', async () => {
      const villageId = await village();
      const landmark = (await submit(villageId, 'landmarks').expect(201)).body as FactBody;
      const id = landmark.claimId;

      await patch(villageId, 'landmarks', id, 'author').send({ era: 'MAMLUK' }).expect(428);
      await patch(villageId, 'landmarks', id, 'author', 7).send({ era: 'MAMLUK' }).expect(412);
      audit.clear();
      const res = await patch(villageId, 'landmarks', id, 'author', 1)
        .send({ era: 'MAMLUK', location: null })
        .expect(200);

      expect(res.body).toMatchObject({
        name: 'Old Mosque',
        era: 'MAMLUK',
        location: null,
        version: 2,
      });
      expect(res.headers.etag).toBe('"2"');
      expect(audit.entries).toEqual([
        expect.objectContaining({ action: 'claim.edited', entityId: id, villageId }),
      ]);
      expect(audit.entries[0]).toMatchObject({
        before: { fact: { era: 'OTTOMAN', location: { latitude: 32.12346 } } },
        after: { fact: { era: 'MAMLUK', location: null } },
      });
    });

    it("answers 403 to a stranger, 404 for another village's claim or another collection", async () => {
      const [villageId, other] = [await village(), await village()];
      const event = (await submit(villageId, 'events').expect(201)).body as FactBody;
      const id = event.claimId;
      await patch(villageId, 'events', id, 'stranger', 1).send({ title: 'x' }).expect(403);
      await remove(villageId, 'events', id, 'stranger').expect(403);
      await patch(other, 'events', id, 'author', 1).send({ title: 'x' }).expect(404);
      await patch(villageId, 'landmarks', id, 'author', 1).send({ name: 'x' }).expect(404);
      await patch(villageId, 'events', id, 'author', 1)
        .send({ datePrecision: 'DECADE' })
        .expect(422);
    });

    it('the author withdraws with one audit entry; the claim cannot be edited afterwards', async () => {
      const villageId = await village();
      const item = (await submit(villageId, 'cultural-items').expect(201)).body as FactBody;
      audit.clear();

      await remove(villageId, 'cultural-items', item.claimId, 'author').expect(204);

      expect(audit.entries).toEqual([
        expect.objectContaining({ action: 'claim.withdrawn', entityId: item.claimId, villageId }),
      ]);
      await patch(villageId, 'cultural-items', item.claimId, 'author', 2)
        .send({ name: 'x' })
        .expect(422);
    });

    it('history: the author edits the summary', async () => {
      const villageId = await village();
      const overview = (await submit(villageId, 'history').expect(201)).body as FactBody;
      const res = await patch(villageId, 'history', overview.claimId, 'author', 1)
        .send({ summary: '  A   revised   overview. ' })
        .expect(200);
      expect(res.body).toMatchObject({ summary: 'A revised overview.', version: 2 });
    });
  });
});
