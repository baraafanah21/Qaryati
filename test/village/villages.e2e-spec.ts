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
const ADMIN_UNITS = '/api/v1/admin-units';
const MISSING = '00000000-0000-7000-8000-0000000000ff';

const USERS = {
  creator: { id: '00000000-0000-7000-8000-000000000a01', role: Role.CONTRIBUTOR },
  other: { id: '00000000-0000-7000-8000-000000000a02', role: Role.CONTRIBUTOR },
  editor: { id: '00000000-0000-7000-8000-000000000a03', role: Role.EDITOR },
  admin: { id: '00000000-0000-7000-8000-000000000a04', role: Role.ADMIN },
} as const;
const SOURCE_ID = '00000000-0000-7000-8000-000000000b01';

interface VillageBody {
  id: string;
  slug: string;
  publicationStatus: string;
  displayNameAr: string;
  displayNameEn: string | null;
  version: number;
}

interface AdminUnitBody {
  id: string;
  code: string;
  unitType: string;
  nameAr: string;
}

describe('village module: /api/v1/villages and /api/v1/admin-units (e2e)', () => {
  let app: INestApplication<App>;
  let owner: Pool;
  const audit = new InMemoryAuditRecorder();
  const tokens: Record<keyof typeof USERS, string> = {
    creator: '',
    other: '',
    editor: '',
    admin: '',
  };
  let slugCounter = 0;

  const http = () => request(app.getHttpServer());
  const as = (user: keyof typeof USERS) => `Bearer ${tokens[user]}`;

  async function createVillage(user: keyof typeof USERS = 'creator'): Promise<VillageBody> {
    slugCounter += 1;
    const res = await http()
      .post(VILLAGES)
      .set('Authorization', as(user))
      .send({
        slug: `e2e-village-${slugCounter}`,
        settlementStatus: 'INHABITED',
        displayNameAr: 'قرية',
        displayNameEn: 'Village',
      })
      .expect(201);
    return res.body as VillageBody;
  }

  async function publish(village: VillageBody): Promise<VillageBody> {
    const res = await http()
      .post(`${VILLAGES}/${village.id}/publish`)
      .set('Authorization', as('editor'))
      .set('If-Match', `"${village.version}"`)
      .expect(200);
    return res.body as VillageBody;
  }

  async function insertClaim(villageId: string, groupKey: string, preferred: boolean) {
    await owner.query(
      `INSERT INTO claim (id, claim_type, village_id, group_key, value_hash, source_id, status,
         is_preferred, created_by, version, created_at, updated_at)
       VALUES (gen_random_uuid(), 'VILLAGE_NAME', $1, $2, md5(random()::text), $3, $4, $5, $6, 1, now(), now())`,
      [
        villageId,
        groupKey,
        SOURCE_ID,
        preferred ? 'VERIFIED' : 'UNVERIFIED',
        preferred,
        USERS.editor.id,
      ],
    );
  }

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
        [user.id, `village-e2e-${name}@test.local`, user.role],
      );
    }
    await owner.query(
      `INSERT INTO source (id, source_type, title, reliability, created_by, version, created_at, updated_at)
       VALUES ($1, 'BOOK', 'Village e2e source', 4, $2, 1, now(), now()) ON CONFLICT (id) DO NOTHING`,
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
      tokens[name as keyof typeof USERS] = await issuer.mint(user);
    }
  });

  beforeEach(() => audit.clear());

  afterAll(async () => {
    await owner?.end();
    await app?.close();
  });

  describe('GET /admin-units', () => {
    it('lists the 16 current governorates publicly, sorted by Arabic name', async () => {
      const res = await http().get(ADMIN_UNITS).query({ type: 'GOVERNORATE' }).expect(200);
      const units = res.body as AdminUnitBody[];
      expect(units).toHaveLength(16);
      expect(units.map((u) => u.code).sort()).toEqual(
        CURRENT_GOVERNORATES.map((g) => g.code).sort(),
      );
      const names = units.map((u) => u.nameAr);
      expect(names).toEqual([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    });

    it('filters by era and parent', async () => {
      const ottoman = await http().get(ADMIN_UNITS).query({ era: 'OTTOMAN' }).expect(200);
      expect(ottoman.body).toEqual([]);
      const children = await http()
        .get(ADMIN_UNITS)
        .query({ parentId: CURRENT_GOVERNORATES[0].id })
        .expect(200);
      expect(children.body).toEqual([]);
    });

    it.each([{ type: 'governorate' }, { era: 'ROMAN' }, { parentId: 'nablus' }, { page: '0' }])(
      '400 for the unknown filter value %j',
      async (query) => {
        const res = await http().get(ADMIN_UNITS).query(query).expect(400);
        expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
      },
    );

    it('gets one unit by code and by id, with an ETag', async () => {
      const nablus = CURRENT_GOVERNORATES.find((g) => g.code === 'nablus')!;
      const byCode = await http().get(`${ADMIN_UNITS}/nablus`).expect(200);
      expect(byCode.body).toMatchObject({
        id: nablus.id,
        nameAr: 'نابلس',
        unitType: 'GOVERNORATE',
      });
      expect(byCode.headers.etag).toBe('"1"');
      const byId = await http().get(`${ADMIN_UNITS}/${nablus.id}`).expect(200);
      expect(byId.body).toEqual(byCode.body);
    });

    it('404 for an unknown code or id', async () => {
      await http().get(`${ADMIN_UNITS}/atlantis`).expect(404);
      const res = await http().get(`${ADMIN_UNITS}/${MISSING}`).expect(404);
      expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('POST /villages', () => {
    it('401 without a token', async () => {
      await http()
        .post(VILLAGES)
        .send({ slug: 'no-token', settlementStatus: 'INHABITED', displayNameAr: 'قرية' })
        .expect(401);
    });

    it('201: a DRAFT owned by the caller, with Location and ETag, audited once', async () => {
      const res = await http()
        .post(VILLAGES)
        .set('Authorization', as('creator'))
        .send({ slug: 'burin', settlementStatus: 'INHABITED', displayNameAr: 'بورين' })
        .expect(201);
      const body = res.body as VillageBody;
      expect(body).toMatchObject({
        slug: 'burin',
        publicationStatus: 'DRAFT',
        displayNameAr: 'بورين',
        displayNameEn: null,
        createdBy: USERS.creator.id,
        location: null,
        version: 1,
      });
      expect(res.headers.location).toBe(`/api/v1/villages/${body.id}`);
      expect(res.headers.etag).toBe('"1"');
      expect(audit.entries).toEqual([
        expect.objectContaining({
          action: 'village.created',
          entityType: 'Village',
          entityId: body.id,
          villageId: body.id,
          inTransaction: true,
        }),
      ]);
    });

    it('409 for a duplicate slug, and nothing is audited', async () => {
      const village = await createVillage();
      audit.clear();
      const res = await http()
        .post(VILLAGES)
        .set('Authorization', as('other'))
        .send({ slug: village.slug, settlementStatus: 'INHABITED', displayNameAr: 'أخرى' })
        .expect(409);
      expect(res.body).toMatchObject({ code: 'DUPLICATE' });
      expect(audit.entries).toEqual([]);
    });

    it('422 for a malformed slug', async () => {
      const res = await http()
        .post(VILLAGES)
        .set('Authorization', as('creator'))
        .send({ slug: 'Bad Slug', settlementStatus: 'INHABITED', displayNameAr: 'قرية' })
        .expect(422);
      expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    });
  });

  describe('GET /villages/{idOrSlug}', () => {
    it('hides a draft from anonymous callers (404) but shows it to logged-in users', async () => {
      const village = await createVillage();
      await http().get(`${VILLAGES}/${village.slug}`).expect(404);
      await http().get(`${VILLAGES}/${village.id}`).expect(404);
      const res = await http()
        .get(`${VILLAGES}/${village.slug}`)
        .set('Authorization', as('other'))
        .expect(200);
      expect(res.body).toMatchObject({ id: village.id, publicationStatus: 'DRAFT' });
    });

    it('shows a published village to anonymous callers, by slug and id, with an ETag', async () => {
      const published = await publish(await createVillage());
      const bySlug = await http().get(`${VILLAGES}/${published.slug}`).expect(200);
      expect(bySlug.body).toMatchObject({ id: published.id, publicationStatus: 'PUBLISHED' });
      expect(bySlug.headers.etag).toBe(`"${published.version}"`);
      await http().get(`${VILLAGES}/${published.id}`).expect(200);
    });

    it('401 for an invalid token, rather than silently answering as anonymous', async () => {
      await http().get(`${VILLAGES}/anything`).set('Authorization', 'Bearer nope').expect(401);
    });

    it('404 for an unknown slug', async () => {
      await http().get(`${VILLAGES}/no-such-village`).set('Authorization', as('admin')).expect(404);
    });
  });

  describe('PATCH /villages/{id}', () => {
    it('428 without If-Match', async () => {
      const village = await createVillage();
      const res = await http()
        .patch(`${VILLAGES}/${village.id}`)
        .set('Authorization', as('creator'))
        .send({ displayNameEn: 'New' })
        .expect(428);
      expect(res.body).toMatchObject({ code: 'PRECONDITION_REQUIRED' });
    });

    it('412 with a stale version', async () => {
      const village = await createVillage();
      await http()
        .patch(`${VILLAGES}/${village.id}`)
        .set('Authorization', as('creator'))
        .set('If-Match', '"1"')
        .send({ displayNameEn: 'First' })
        .expect(200);
      const res = await http()
        .patch(`${VILLAGES}/${village.id}`)
        .set('Authorization', as('creator'))
        .set('If-Match', '"1"')
        .send({ displayNameEn: 'Second' })
        .expect(412);
      expect(res.body).toMatchObject({ code: 'VERSION_CONFLICT' });
    });

    it('200: the creator edits their draft; new ETag; audited with before and after', async () => {
      const village = await createVillage();
      audit.clear();
      const res = await http()
        .patch(`${VILLAGES}/${village.id}`)
        .set('Authorization', as('creator'))
        .set('If-Match', '"1"')
        .send({ settlementStatus: 'DEPOPULATED', displayNameEn: null })
        .expect(200);
      expect(res.body).toMatchObject({ version: 2, displayNameEn: null });
      expect(res.headers.etag).toBe('"2"');
      expect(audit.entries).toEqual([
        expect.objectContaining({
          action: 'village.updated',
          villageId: village.id,
          before: expect.objectContaining({ settlementStatus: 'INHABITED' }) as unknown,
          after: expect.objectContaining({ settlementStatus: 'DEPOPULATED' }) as unknown,
        }),
      ]);
    });

    it('403 for another contributor, and for the creator once it is published', async () => {
      const village = await createVillage();
      await http()
        .patch(`${VILLAGES}/${village.id}`)
        .set('Authorization', as('other'))
        .set('If-Match', '"1"')
        .send({ displayNameEn: 'Nope' })
        .expect(403);
      const published = await publish(village);
      await http()
        .patch(`${VILLAGES}/${village.id}`)
        .set('Authorization', as('creator'))
        .set('If-Match', `"${published.version}"`)
        .send({ displayNameEn: 'Nope' })
        .expect(403);
    });

    it('422 for a name with a published CURRENT claim in its language; the other stays editable', async () => {
      const village = await createVillage();
      await insertClaim(village.id, `name|${village.id}|ar|current`, true);
      // A historical Arabic name does not lock the display name.
      await insertClaim(village.id, `name|${village.id}|ar|historical|قديم`, true);

      const locked = await http()
        .patch(`${VILLAGES}/${village.id}`)
        .set('Authorization', as('editor'))
        .set('If-Match', '"1"')
        .send({ displayNameAr: 'اسم آخر' })
        .expect(422);
      expect(locked.body).toMatchObject({ code: 'CONSTRAINT_VIOLATION' });

      await http()
        .patch(`${VILLAGES}/${village.id}`)
        .set('Authorization', as('editor'))
        .set('If-Match', '"1"')
        .send({ displayNameEn: 'Other name' })
        .expect(200);
    });
  });

  describe('publish and archive', () => {
    it('403 for a contributor, even the creator', async () => {
      const village = await createVillage();
      await http()
        .post(`${VILLAGES}/${village.id}/publish`)
        .set('Authorization', as('creator'))
        .set('If-Match', '"1"')
        .expect(403);
    });

    it('publish, archive (hidden again), republish; one audit entry each', async () => {
      const village = await createVillage();
      audit.clear();
      const published = await publish(village);
      expect(published.publicationStatus).toBe('PUBLISHED');

      const archived = await http()
        .post(`${VILLAGES}/${village.id}/archive`)
        .set('Authorization', as('editor'))
        .set('If-Match', `"${published.version}"`)
        .expect(200);
      expect(archived.body).toMatchObject({ publicationStatus: 'ARCHIVED' });
      await http().get(`${VILLAGES}/${village.slug}`).expect(404);

      const republished = await publish(archived.body as VillageBody);
      expect(republished.publicationStatus).toBe('PUBLISHED');
      await http().get(`${VILLAGES}/${village.slug}`).expect(200);

      expect(audit.entries.map((e) => [e.action, e.villageId])).toEqual([
        ['village.published', village.id],
        ['village.archived', village.id],
        ['village.published', village.id],
      ]);
    });

    it('422 for an illegal move (archiving a draft)', async () => {
      const village = await createVillage();
      const res = await http()
        .post(`${VILLAGES}/${village.id}/archive`)
        .set('Authorization', as('editor'))
        .set('If-Match', '"1"')
        .expect(422);
      expect(res.body).toMatchObject({ code: 'CONSTRAINT_VIOLATION' });
    });

    it('428 without If-Match and 404 for an unknown village', async () => {
      const village = await createVillage();
      await http()
        .post(`${VILLAGES}/${village.id}/publish`)
        .set('Authorization', as('editor'))
        .expect(428);
      await http()
        .post(`${VILLAGES}/${MISSING}/publish`)
        .set('Authorization', as('editor'))
        .set('If-Match', '"1"')
        .expect(404);
    });
  });

  describe('DELETE /villages/{id}', () => {
    it('403 for an editor', async () => {
      const village = await createVillage();
      await http()
        .delete(`${VILLAGES}/${village.id}`)
        .set('Authorization', as('editor'))
        .set('If-Match', '"1"')
        .expect(403);
    });

    it('204 for an admin, audited with the deleted row; then 404', async () => {
      const village = await createVillage();
      audit.clear();
      await http()
        .delete(`${VILLAGES}/${village.id}`)
        .set('Authorization', as('admin'))
        .set('If-Match', '"1"')
        .expect(204);
      expect(audit.entries).toEqual([
        expect.objectContaining({
          action: 'village.deleted',
          villageId: village.id,
          before: expect.objectContaining({ slug: village.slug }) as unknown,
        }),
      ]);
      await http().get(`${VILLAGES}/${village.id}`).set('Authorization', as('admin')).expect(404);
    });

    it('409 REFERENCE_CONFLICT for a village with claims; nothing deleted or audited', async () => {
      const village = await createVillage();
      await insertClaim(village.id, `name|${village.id}|en|current`, false);
      audit.clear();
      const res = await http()
        .delete(`${VILLAGES}/${village.id}`)
        .set('Authorization', as('admin'))
        .set('If-Match', '"1"')
        .expect(409);
      expect(res.body).toMatchObject({ code: 'REFERENCE_CONFLICT' });
      expect(audit.entries).toEqual([]);
      await http().get(`${VILLAGES}/${village.id}`).set('Authorization', as('admin')).expect(200);
    });
  });
});
