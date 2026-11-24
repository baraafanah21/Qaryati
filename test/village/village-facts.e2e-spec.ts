import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import type { AppEnv } from '../../src/config/app-env';
import { createTestTokenIssuer, Role } from '../../src/modules/iam';
import { CURRENT_GOVERNORATES } from '../../src/modules/village/infrastructure/seed/governorates';
import { configureApp } from '../../src/platform/http/configure-app';
import { AUDIT_RECORDER, CLOCK, type Clock } from '../../src/shared/kernel';
import { InMemoryAuditRecorder } from '../support/in-memory-audit-recorder';

const VILLAGES = '/api/v1/villages';
const CLAIMS = '/api/v1/claims';
const MISSING = '00000000-0000-7000-8000-0000000e00ff';

const USERS = {
  author: { id: '00000000-0000-7000-8000-0000000e0001', role: Role.CONTRIBUTOR },
  other: { id: '00000000-0000-7000-8000-0000000e0002', role: Role.CONTRIBUTOR },
  editor: { id: '00000000-0000-7000-8000-0000000e0003', role: Role.EDITOR },
} as const;
type UserName = keyof typeof USERS;

const SOURCE_ID = '00000000-0000-7000-8000-0000000e0020';
const SOURCE_2_ID = '00000000-0000-7000-8000-0000000e0021';
const GOVERNORATE = CURRENT_GOVERNORATES[0].id;

interface FactBody {
  claimId: string;
  status: string;
  isPreferred: boolean;
  version: number;
  [field: string]: unknown;
}

interface PageBody {
  content: FactBody[];
  page: { totalElements: number };
}

describe('village facts: /api/v1/villages/{id}/... (e2e)', () => {
  let app: INestApplication<App>;
  let owner: Pool;
  const audit = new InMemoryAuditRecorder();
  const tokens: Record<UserName, string> = { author: '', other: '', editor: '' };
  let counter = 0;

  const http = () => request(app.getHttpServer());
  const as = (user: UserName) => `Bearer ${tokens[user]}`;

  /** A village inserted directly, published by default, optionally with a location. */
  async function village(
    options: { status?: string; at?: [number, number] } = {},
  ): Promise<string> {
    counter += 1;
    const result = await owner.query<{ id: string }>(
      `INSERT INTO village (id, slug, settlement_status, publication_status, display_name_ar,
         location, created_by, version, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, 'INHABITED', $2, 'قرية',
         CASE WHEN $3::float8 IS NULL THEN NULL
              ELSE ST_SetSRID(ST_MakePoint($4::float8, $3::float8), 4326)::geography END,
         $5, 1, now(), now())
       RETURNING id`,
      [
        `facts-e2e-${counter}`,
        options.status ?? 'PUBLISHED',
        options.at?.[0] ?? null,
        options.at?.[1] ?? null,
        USERS.editor.id,
      ],
    );
    return result.rows[0]!.id;
  }

  const submit = (
    villageId: string,
    path: string,
    body: object,
    user: UserName = 'author',
    method: 'post' | 'put' = 'post',
  ) => http()[method](`${VILLAGES}/${villageId}/${path}`).set('Authorization', as(user)).send(body);

  const verify = (claimId: string) =>
    http()
      .post(`${CLAIMS}/${claimId}/verify`)
      .set('Authorization', as('editor'))
      .set('If-Match', '"1"')
      .expect(200);

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
        [user.id, `facts-e2e-${name}@test.local`, user.role],
      );
    }
    for (const id of [SOURCE_ID, SOURCE_2_ID]) {
      await owner.query(
        `INSERT INTO source (id, source_type, title, reliability, created_by, version, created_at, updated_at)
         VALUES ($1, 'BOOK', $2, 4, $3, 1, now(), now()) ON CONFLICT (id) DO NOTHING`,
        [id, `Facts e2e source ${id}`, USERS.editor.id],
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

  describe('submit', () => {
    it.each([
      [
        'names',
        { name: 'بيت فوريك', lang: 'ar', nameType: 'CURRENT' },
        { nameNormalized: 'بيت فوريك', status: 'UNVERIFIED', isPreferred: false },
      ],
      [
        'name-origins',
        { meaning: 'house of Furik', originLanguage: 'Aramaic', sourceId: SOURCE_ID },
        { meaning: 'house of Furik', explanation: null, sourceId: SOURCE_ID },
      ],
      [
        'affiliations',
        { adminUnitId: GOVERNORATE, validFrom: '1995-01-01' },
        { adminUnitId: GOVERNORATE, validFrom: '1995-01-01', validTo: null },
      ],
      ['measures', { kind: 'ELEVATION_M', value: 520.5 }, { kind: 'ELEVATION_M', value: 520.5 }],
    ] as const)('POST %s answers 201 and records one audit entry', async (path, body, expected) => {
      const villageId = await village();

      const res = await submit(villageId, path, body).expect(201);

      expect(res.body).toMatchObject({ ...expected, createdBy: USERS.author.id, version: 1 });
      expect(res.headers.etag).toBe('"1"');
      expect(audit.entries).toEqual([
        expect.objectContaining({ action: 'claim.submitted', villageId, entityType: 'Claim' }),
      ]);
    });

    it('PUT location answers 201 with the point rounded to 5 decimals', async () => {
      const villageId = await village();
      const res = await submit(
        villageId,
        'location',
        { latitude: 32.1234567, longitude: 35.2, precision: 'EXACT' },
        'author',
        'put',
      ).expect(201);
      expect(res.body).toMatchObject({ latitude: 32.12346, longitude: 35.2, precision: 'EXACT' });
      expect(audit.entries).toHaveLength(1);
    });

    it('POST relations answers 201, 404 for an unknown village and 422 for itself', async () => {
      const [villageId, other] = [await village(), await village()];
      await submit(villageId, 'relations', {
        relatedVillageId: other,
        relationType: 'ADJACENT',
      }).expect(201);
      await submit(villageId, 'relations', {
        relatedVillageId: MISSING,
        relationType: 'ADJACENT',
      }).expect(404);
      const res = await submit(villageId, 'relations', {
        relatedVillageId: villageId,
        relationType: 'ADJACENT',
      }).expect(422);
      expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('answers 409 for the same value from the same source, even spelled differently', async () => {
      const villageId = await village();
      const body = { kind: 'AREA_DUNUM', value: 1200, sourceId: SOURCE_ID };
      await submit(villageId, 'measures', body).expect(201);
      await submit(villageId, 'measures', body, 'other').expect(409);
      // The same name with tashkeel is the same value.
      await submit(villageId, 'names', {
        name: 'عَوَرْتا',
        lang: 'ar',
        nameType: 'CURRENT',
      }).expect(201);
      await submit(villageId, 'names', { name: 'عورتا', lang: 'ar', nameType: 'CURRENT' }).expect(
        409,
      );
      // Another source may confirm it.
      await submit(villageId, 'measures', { ...body, sourceId: SOURCE_2_ID }).expect(201);
    });

    it('answers 404 for an unknown village, unit or source', async () => {
      await submit(MISSING, 'measures', { kind: 'AREA_DUNUM', value: 3 }).expect(404);
      const villageId = await village();
      await submit(villageId, 'affiliations', { adminUnitId: MISSING }).expect(404);
      await submit(villageId, 'measures', {
        kind: 'AREA_DUNUM',
        value: 3,
        sourceId: MISSING,
      }).expect(404);
      expect(audit.entries).toEqual([]);
    });

    it('answers 422 for a name origin without a source', async () => {
      const villageId = await village();
      const res = await submit(villageId, 'name-origins', { meaning: 'the spring' }).expect(422);
      expect(res.body).toMatchObject({ code: 'CONSTRAINT_VIOLATION' });
      expect(audit.entries).toEqual([]);
    });

    it('answers 422 for broken domain rules and 400 for a bad shape', async () => {
      const villageId = await village();
      await submit(villageId, 'measures', { kind: 'ELEVATION_M', value: 1600 }).expect(422);
      await submit(villageId, 'names', {
        name: 'Furik',
        lang: 'en',
        nameType: 'HISTORICAL',
        periodFromYear: 1900,
        periodToYear: 1800,
      }).expect(422);
      await submit(
        villageId,
        'location',
        { latitude: 91, longitude: 0, precision: 'EXACT' },
        'author',
        'put',
      ).expect(422);
      await submit(villageId, 'measures', { kind: 'HEIGHT', value: 3 }).expect(400);
      await submit(villageId, 'measures', { kind: 'AREA_DUNUM', value: 3, extra: true }).expect(
        400,
      );
    });

    it('answers 401 without a token', async () => {
      const villageId = await village();
      await http()
        .post(`${VILLAGES}/${villageId}/measures`)
        .send({ kind: 'AREA_DUNUM', value: 3 })
        .expect(401);
    });
  });

  describe('read', () => {
    it('shows only preferred claims publicly, and every claim with its status to editors', async () => {
      const villageId = await village();
      const published = (
        await submit(villageId, 'measures', {
          kind: 'ELEVATION_M',
          value: 600,
          sourceId: SOURCE_ID,
        }).expect(201)
      ).body as FactBody;
      await submit(villageId, 'measures', { kind: 'ELEVATION_M', value: 610 }).expect(201);
      await verify(published.claimId);

      const pub = (await http().get(`${VILLAGES}/${villageId}/measures`).expect(200))
        .body as PageBody;
      expect(pub.content).toEqual([
        expect.objectContaining({
          claimId: published.claimId,
          value: 600,
          status: 'VERIFIED',
          isPreferred: true,
        }),
      ]);
      expect(pub.page.totalElements).toBe(1);

      const all = (
        await http()
          .get(`${VILLAGES}/${villageId}/measures?includeUnverified=true`)
          .set('Authorization', as('editor'))
          .expect(200)
      ).body as PageBody;
      expect(all.content.map((f) => [f.value, f.status])).toEqual([
        [600, 'VERIFIED'],
        [610, 'UNVERIFIED'],
      ]);
    });

    it('answers 403 to includeUnverified without the editor role', async () => {
      const villageId = await village();
      await http().get(`${VILLAGES}/${villageId}/names?includeUnverified=true`).expect(403);
      await http()
        .get(`${VILLAGES}/${villageId}/names?includeUnverified=true`)
        .set('Authorization', as('author'))
        .expect(403);
    });

    it('answers 404 for an unknown village and for a draft read anonymously', async () => {
      await http().get(`${VILLAGES}/${MISSING}/names`).expect(404);
      const draft = await village({ status: 'DRAFT' });
      await http().get(`${VILLAGES}/${draft}/relations`).expect(404);
      await http()
        .get(`${VILLAGES}/${draft}/relations`)
        .set('Authorization', as('author'))
        .expect(200);
    });

    it('updates the village projections once the name and location are verified', async () => {
      const villageId = await village();
      const name = (
        await submit(villageId, 'names', {
          name: 'سبسطية',
          lang: 'ar',
          nameType: 'CURRENT',
          sourceId: SOURCE_ID,
        })
      ).body as FactBody;
      const location = (
        await submit(
          villageId,
          'location',
          { latitude: 32.27618, longitude: 35.19469, precision: 'EXACT', sourceId: SOURCE_ID },
          'author',
          'put',
        )
      ).body as FactBody;
      await verify(name.claimId);
      await verify(location.claimId);

      const res = await http().get(`${VILLAGES}/${villageId}`).expect(200);
      expect(res.body).toMatchObject({
        displayNameAr: 'سبسطية',
        location: { latitude: 32.27618, longitude: 35.19469 },
      });
      const loc = (await http().get(`${VILLAGES}/${villageId}/location`).expect(200))
        .body as PageBody;
      expect(loc.content).toEqual([
        expect.objectContaining({ claimId: location.claimId, isPreferred: true }),
      ]);
    });
  });

  describe('PATCH and DELETE /names/{claimId}', () => {
    async function ownName(villageId: string): Promise<FactBody> {
      return (
        await submit(villageId, 'names', {
          name: 'Fourik',
          lang: 'en',
          nameType: 'ALTERNATIVE_SPELLING',
        }).expect(201)
      ).body as FactBody;
    }
    const patch = (villageId: string, claimId: string, user: UserName, version = 1) =>
      http()
        .patch(`${VILLAGES}/${villageId}/names/${claimId}`)
        .set('Authorization', as(user))
        .set('If-Match', `"${version}"`);
    const remove = (villageId: string, claimId: string, user: UserName, version = 1) =>
      http()
        .delete(`${VILLAGES}/${villageId}/names/${claimId}`)
        .set('Authorization', as(user))
        .set('If-Match', `"${version}"`);

    it('lets the author edit their unverified name, with one audit entry', async () => {
      const villageId = await village();
      const name = await ownName(villageId);
      audit.clear();

      const res = await patch(villageId, name.claimId, 'author')
        .send({ name: 'Furik' })
        .expect(200);

      expect(res.body).toMatchObject({ name: 'Furik', nameNormalized: 'furik', version: 2 });
      expect(res.headers.etag).toBe('"2"');
      expect(audit.entries).toEqual([
        expect.objectContaining({ action: 'claim.edited', villageId }),
      ]);
      // The claim keeps only the value's hash, so the entry keeps the old and the new name.
      expect(audit.entries[0]).toMatchObject({
        before: {
          fact: {
            name: 'Fourik',
            lang: 'en',
            nameType: 'ALTERNATIVE_SPELLING',
            periodFromYear: null,
            periodToYear: null,
          },
        },
        after: { fact: { name: 'Furik', lang: 'en', nameType: 'ALTERNATIVE_SPELLING' } },
      });
    });

    it("answers 403 to someone else's name, 412 when stale, 428 without If-Match", async () => {
      const villageId = await village();
      const name = await ownName(villageId);
      await patch(villageId, name.claimId, 'other').send({ name: 'Furik' }).expect(403);
      await remove(villageId, name.claimId, 'other').expect(403);
      await patch(villageId, name.claimId, 'author', 7).send({ name: 'Furik' }).expect(412);
      await http()
        .delete(`${VILLAGES}/${villageId}/names/${name.claimId}`)
        .set('Authorization', as('author'))
        .expect(428);
    });

    it('answers 404 for a claim of another village or of another type', async () => {
      const [villageId, other] = [await village(), await village()];
      const name = await ownName(villageId);
      await patch(other, name.claimId, 'author').send({ name: 'x' }).expect(404);
      const measure = (await submit(villageId, 'measures', { kind: 'AREA_DUNUM', value: 4 }))
        .body as FactBody;
      await remove(villageId, measure.claimId, 'author').expect(404);
    });

    it('lets the author withdraw their unverified name, which then cannot be edited', async () => {
      const villageId = await village();
      const name = await ownName(villageId);
      audit.clear();

      await remove(villageId, name.claimId, 'author').expect(204);

      expect(audit.entries).toEqual([
        expect.objectContaining({ action: 'claim.withdrawn', villageId }),
      ]);
      await patch(villageId, name.claimId, 'author', 2).send({ name: 'x' }).expect(422);
    });
  });

  describe('GET /nearby', () => {
    it('lists published villages nearest first, without drafts or itself', async () => {
      const origin = await village({ at: [31.9, 35.2] });
      const near = await village({ at: [31.91, 35.2] });
      const farther = await village({ at: [31.95, 35.2] });
      await village({ at: [31.901, 35.2], status: 'DRAFT' });

      const res = await http().get(`${VILLAGES}/${origin}/nearby?radiusKm=10`).expect(200);

      const ids = (res.body as { content: { id: string; distanceMeters: number }[] }).content.map(
        (v) => v.id,
      );
      expect(ids).toEqual([near, farther]);
    });

    it.each(['radiusKm=0', 'radiusKm=500', 'limit=51', 'limit=0'])(
      'answers 400 for %s',
      async (query) => {
        const origin = await village({ at: [31.9, 35.2] });
        await http().get(`${VILLAGES}/${origin}/nearby?${query}`).expect(400);
      },
    );

    it('answers 422 for a village without a location and 404 for an unknown one', async () => {
      await http()
        .get(`${VILLAGES}/${await village()}/nearby`)
        .expect(422);
      await http().get(`${VILLAGES}/${MISSING}/nearby`).expect(404);
    });
  });
});
