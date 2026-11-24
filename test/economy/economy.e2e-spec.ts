import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import type { AppEnv } from '../../src/config/app-env';
import { createTestTokenIssuer, Role } from '../../src/modules/iam';
import { SEED_PRODUCTS } from '../../src/modules/economy/infrastructure/seed/products';
import { configureApp } from '../../src/platform/http/configure-app';
import { AUDIT_RECORDER, CLOCK, type Clock } from '../../src/shared/kernel';
import { InMemoryAuditRecorder } from '../support/in-memory-audit-recorder';

const VILLAGES = '/api/v1/villages';
const PRODUCTS = '/api/v1/products';
const CLAIMS = '/api/v1/claims';
const MISSING = '00000000-0000-7000-8000-0000002200ff';

const USERS = {
  author: { id: '00000000-0000-7000-8000-000000220001', role: Role.CONTRIBUTOR },
  stranger: { id: '00000000-0000-7000-8000-000000220002', role: Role.CONTRIBUTOR },
  editor: { id: '00000000-0000-7000-8000-000000220003', role: Role.EDITOR },
} as const;
type UserName = keyof typeof USERS;

const SOURCE_ID = '00000000-0000-7000-8000-000000220020';

const product = (code: string) => SEED_PRODUCTS.find((p) => p.code === code)!;
const OLIVES = product('olives');
/** Used only by the villages-by-product test, so other tests cannot add villages to it. */
const POTTERY = product('pottery');

interface FactBody extends Record<string, unknown> {
  claimId: string;
  status: string;
  isPreferred: boolean;
  version: number;
}

interface PageBody<T = FactBody> {
  content: T[];
  page: { totalElements: number };
}

type Collection = 'products' | 'facilities';

const BODIES: Record<Collection, Record<string, unknown>> = {
  products: { productId: OLIVES.id, significance: 'PRIMARY' },
  facilities: {
    facilityType: 'SCHOOL',
    name: 'Boys School',
    location: { latitude: 32.123456, longitude: 35.234567 },
    establishedYear: 1950,
  },
};

describe('economy: /api/v1/products and /api/v1/villages/{id}/products|facilities (e2e)', () => {
  let app: INestApplication<App>;
  let owner: Pool;
  const audit = new InMemoryAuditRecorder();
  const tokens: Record<UserName, string> = { author: '', stranger: '', editor: '' };
  let counter = 0;

  const http = () => request(app.getHttpServer());
  const as = (user: UserName) => `Bearer ${tokens[user]}`;

  async function village(status = 'PUBLISHED', nameAr = 'قرية'): Promise<string> {
    counter += 1;
    const result = await owner.query<{ id: string }>(
      `INSERT INTO village (id, slug, settlement_status, publication_status, display_name_ar,
         created_by, version, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, 'INHABITED', $2, $3, $4, 1, now(), now())
       RETURNING id`,
      [`economy-e2e-${counter}`, status, nameAr, USERS.editor.id],
    );
    return result.rows[0]!.id;
  }

  const submit = (
    villageId: string,
    collection: Collection,
    payload: object = BODIES[collection],
    user: UserName = 'author',
  ) =>
    http()
      .post(`${VILLAGES}/${villageId}/${collection}`)
      .set('Authorization', as(user))
      .send(payload);

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
        [user.id, `economy-e2e-${name}@test.local`, user.role],
      );
    }
    await owner.query(
      `INSERT INTO source (id, source_type, title, reliability, created_by, version, created_at, updated_at)
       VALUES ($1, 'BOOK', 'Economy e2e source', 4, $2, 1, now(), now()) ON CONFLICT (id) DO NOTHING`,
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

  describe('GET /products', () => {
    it('lists every seeded product publicly, by category then English name', async () => {
      const res = await http().get(PRODUCTS).expect(200);
      const body = res.body as { code: string; category: string; nameAr: string }[];
      expect(body).toHaveLength(SEED_PRODUCTS.length);
      expect(body.find((p) => p.code === 'olive-oil')).toMatchObject({
        category: 'INDUSTRY',
        nameAr: 'زيت زيتون',
        nameEn: 'Olive oil',
      });
      const categories = body.map((p) => p.category);
      expect(categories).toEqual([...categories].sort());
    });

    it('filters by category; 400 for an unknown category', async () => {
      const res = await http().get(PRODUCTS).query({ category: 'CRAFT' }).expect(200);
      expect((res.body as { code: string }[]).map((p) => p.code)).toEqual([
        'embroidery',
        'pottery',
      ]);
      await http().get(PRODUCTS).query({ category: 'FOOD' }).expect(400);
    });
  });

  describe('create', () => {
    it.each<[Collection, Record<string, unknown>]>([
      [
        'products',
        {
          productId: OLIVES.id,
          significance: 'PRIMARY',
          product: { code: 'olives', category: 'CROP', nameAr: 'زيتون', nameEn: 'Olives' },
        },
      ],
      [
        'facilities',
        {
          facilityType: 'SCHOOL',
          name: 'Boys School',
          location: { latitude: 32.12346, longitude: 35.23457 },
          establishedYear: 1950,
        },
      ],
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

    it('products: 409 for the same value again, 404 for an unknown product or village', async () => {
      const villageId = await village();
      await submit(villageId, 'products').expect(201);
      const duplicate = await submit(villageId, 'products', undefined, 'stranger').expect(409);
      expect(duplicate.headers['content-type']).toContain('application/problem+json');

      const unknown = await submit(villageId, 'products', {
        productId: MISSING,
        significance: 'PRIMARY',
      }).expect(404);
      expect(unknown.body).toMatchObject({ code: 'NOT_FOUND' });
      await submit(MISSING, 'products').expect(404);
      // Nothing was written by the failed requests.
      expect(audit.entries.map((e) => e.action)).toEqual(['claim.submitted']);
    });

    it('products: another significance is another claim on the same question (a conflict)', async () => {
      const villageId = await village();
      await submit(villageId, 'products').expect(201);
      await submit(villageId, 'products', {
        ...BODIES.products,
        significance: 'HISTORICAL',
      }).expect(201);
      await submit(villageId, 'products', { ...BODIES.products, significance: 'MAIN' }).expect(400);
    });

    it('facilities: 422 for a year or point out of range, 400 for an unknown type', async () => {
      const villageId = await village();
      for (const establishedYear of [1799, 3000]) {
        const res = await submit(villageId, 'facilities', {
          ...BODIES.facilities,
          establishedYear,
        }).expect(422);
        expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
      }
      await submit(villageId, 'facilities', {
        ...BODIES.facilities,
        location: { latitude: 95, longitude: 35 },
      }).expect(422);
      await submit(villageId, 'facilities', { ...BODIES.facilities, facilityType: 'MALL' }).expect(
        400,
      );
    });

    it('answers 401 anonymously', async () => {
      const villageId = await village();
      await http().post(`${VILLAGES}/${villageId}/products`).send(BODIES.products).expect(401);
    });
  });

  describe('lists', () => {
    it('shows the public the preferred products only, with their product', async () => {
      const villageId = await village();
      const olives = await published(villageId, 'products');
      const draft = (
        await submit(villageId, 'products', {
          productId: product('figs').id,
          significance: 'SECONDARY',
        }).expect(201)
      ).body as FactBody;

      const res = await list(villageId, 'products').expect(200);
      expect((res.body as PageBody).content).toEqual([
        expect.objectContaining({
          claimId: olives.claimId,
          status: 'VERIFIED',
          isPreferred: true,
          product: expect.objectContaining({ code: 'olives' }) as unknown,
        }),
      ]);
      expect(await ids(villageId, 'products?includeUnverified=true', 'author')).toEqual([
        draft.claimId,
        olives.claimId,
      ]);
    });

    it('filters facilities by type, by type then name', async () => {
      const villageId = await village();
      const school = await published(villageId, 'facilities');
      const clinic = await published(villageId, 'facilities', {
        facilityType: 'CLINIC',
        name: 'Health Centre',
      });
      expect(await ids(villageId, 'facilities')).toEqual([clinic.claimId, school.claimId]);
      expect(await ids(villageId, 'facilities?type=SCHOOL')).toEqual([school.claimId]);
      await list(villageId, 'facilities?type=MALL').expect(400);
    });

    it('answers 404 for an unknown village and for a draft read anonymously', async () => {
      await list(MISSING, 'products').expect(404);
      const draft = await village('DRAFT');
      await list(draft, 'facilities').expect(404);
      await list(draft, 'facilities', 'author').expect(200);
    });
  });

  describe('GET /products/{idOrCode}/villages', () => {
    it('returns only the villages with a preferred claim for the product', async () => {
      const [withClaim, unverified, draft, otherProduct] = [
        await village('PUBLISHED', 'أ قرية'),
        await village('PUBLISHED', 'ب قرية'),
        await village('DRAFT', 'ت قرية'),
        await village('PUBLISHED', 'ث قرية'),
      ];
      const pottery = { productId: POTTERY.id, significance: 'PRIMARY' };
      await published(withClaim, 'products', pottery);
      await published(draft, 'products', pottery);
      await submit(unverified, 'products', pottery).expect(201);
      await published(otherProduct, 'products');

      const byCode = await http().get(`${PRODUCTS}/pottery/villages`).expect(200);
      expect((byCode.body as PageBody<{ id: string }>).content.map((v) => v.id)).toEqual([
        withClaim,
      ]);

      // Editors see every publication status, like GET /villages.
      const editor = await http()
        .get(`${PRODUCTS}/${POTTERY.id}/villages`)
        .query({ sort: 'nameAr,desc' })
        .set('Authorization', as('editor'))
        .expect(200);
      expect((editor.body as PageBody<{ id: string }>).content.map((v) => v.id)).toEqual([
        draft,
        withClaim,
      ]);
      expect((editor.body as PageBody).page.totalElements).toBe(2);
    });

    it('404 for an unknown product, 400 for a sort it cannot use, empty for no village', async () => {
      await http().get(`${PRODUCTS}/atlantis/villages`).expect(404);
      await http().get(`${PRODUCTS}/${MISSING}/villages`).expect(404);
      await http().get(`${PRODUCTS}/olives/villages`).query({ sort: 'relevance' }).expect(400);
      const soap = await http().get(`${PRODUCTS}/soap/villages`).expect(200);
      expect(soap.body).toMatchObject({ content: [], page: { totalElements: 0 } });
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
      const facility = (await submit(villageId, 'facilities').expect(201)).body as FactBody;
      const id = facility.claimId;

      await patch(villageId, 'facilities', id, 'author')
        .send({ establishedYear: 1960 })
        .expect(428);
      await patch(villageId, 'facilities', id, 'author', 7)
        .send({ establishedYear: 1960 })
        .expect(412);
      audit.clear();
      const res = await patch(villageId, 'facilities', id, 'author', 1)
        .send({ establishedYear: 1960, location: null })
        .expect(200);

      expect(res.body).toMatchObject({
        name: 'Boys School',
        establishedYear: 1960,
        location: null,
        version: 2,
      });
      expect(res.headers.etag).toBe('"2"');
      expect(audit.entries).toEqual([
        expect.objectContaining({ action: 'claim.edited', entityId: id, villageId }),
      ]);
      expect(audit.entries[0]).toMatchObject({
        before: { fact: { establishedYear: 1950, location: { latitude: 32.12346 } } },
        after: { fact: { establishedYear: 1960, location: null } },
      });
    });

    it('products: the author changes the significance; 404 for an unknown product', async () => {
      const villageId = await village();
      const item = (await submit(villageId, 'products').expect(201)).body as FactBody;
      await patch(villageId, 'products', item.claimId, 'author', 1)
        .send({ productId: MISSING })
        .expect(404);
      const res = await patch(villageId, 'products', item.claimId, 'author', 1)
        .send({ significance: 'HISTORICAL' })
        .expect(200);
      expect(res.body).toMatchObject({ significance: 'HISTORICAL', version: 2 });
    });

    it("answers 403 to a stranger, 404 for another village's claim or another collection", async () => {
      const [villageId, other] = [await village(), await village()];
      const item = (await submit(villageId, 'products').expect(201)).body as FactBody;
      const id = item.claimId;
      await patch(villageId, 'products', id, 'stranger', 1)
        .send({ significance: 'SECONDARY' })
        .expect(403);
      await remove(villageId, 'products', id, 'stranger').expect(403);
      await patch(other, 'products', id, 'author', 1)
        .send({ significance: 'SECONDARY' })
        .expect(404);
      await patch(villageId, 'facilities', id, 'author', 1).send({ name: 'x' }).expect(404);
    });

    it('the author withdraws with one audit entry; the claim cannot be edited afterwards', async () => {
      const villageId = await village();
      const item = (await submit(villageId, 'facilities').expect(201)).body as FactBody;
      audit.clear();

      await remove(villageId, 'facilities', item.claimId, 'author').expect(204);

      expect(audit.entries).toEqual([
        expect.objectContaining({ action: 'claim.withdrawn', entityId: item.claimId, villageId }),
      ]);
      await patch(villageId, 'facilities', item.claimId, 'author', 2)
        .send({ name: 'x' })
        .expect(422);
    });
  });
});
