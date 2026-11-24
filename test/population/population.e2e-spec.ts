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
const MISSING = '00000000-0000-7000-8000-0000000f00ff';

const USERS = {
  author: { id: '00000000-0000-7000-8000-0000000f0001', role: Role.CONTRIBUTOR },
  stranger: { id: '00000000-0000-7000-8000-0000000f0002', role: Role.CONTRIBUTOR },
  editor: { id: '00000000-0000-7000-8000-0000000f0003', role: Role.EDITOR },
} as const;
type UserName = keyof typeof USERS;

const SOURCE_ID = '00000000-0000-7000-8000-0000000f0020';
const SOURCE_2_ID = '00000000-0000-7000-8000-0000000f0021';

interface RecordBody {
  claimId: string;
  status: string;
  isPreferred: boolean;
  version: number;
  population: number;
  referenceYear: number;
  countType: string;
  warnings?: string[];
}

interface PageBody {
  content: RecordBody[];
  page: { totalElements: number };
}

describe('population: /api/v1/villages/{id}/population (e2e)', () => {
  let app: INestApplication<App>;
  let owner: Pool;
  const audit = new InMemoryAuditRecorder();
  const tokens: Record<UserName, string> = { author: '', stranger: '', editor: '' };
  let counter = 0;
  let thisYear = 0;

  const http = () => request(app.getHttpServer());
  const as = (user: UserName) => `Bearer ${tokens[user]}`;

  async function village(status = 'PUBLISHED'): Promise<string> {
    counter += 1;
    const result = await owner.query<{ id: string }>(
      `INSERT INTO village (id, slug, settlement_status, publication_status, display_name_ar,
         created_by, version, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, 'INHABITED', $2, 'قرية', $3, 1, now(), now())
       RETURNING id`,
      [`population-e2e-${counter}`, status, USERS.editor.id],
    );
    return result.rows[0]!.id;
  }

  const body = (referenceYear: number, population: number, extra: object = {}) => ({
    population,
    referenceYear,
    countType: 'CENSUS',
    sourceId: SOURCE_ID,
    ...extra,
  });

  const submit = (villageId: string, payload: object, user: UserName = 'author') =>
    http().post(`${VILLAGES}/${villageId}/population`).set('Authorization', as(user)).send(payload);

  /** Submitted by the author and verified by the editor: the published record. */
  async function published(villageId: string, year: number, population: number) {
    const res = await submit(villageId, body(year, population)).expect(201);
    await http()
      .post(`${CLAIMS}/${(res.body as RecordBody).claimId}/verify`)
      .set('Authorization', as('editor'))
      .set('If-Match', '"1"')
      .expect(200);
    return res.body as RecordBody;
  }

  const list = (villageId: string, user?: UserName, includeUnverified = false) => {
    const req = http().get(
      `${VILLAGES}/${villageId}/population?includeUnverified=${includeUnverified}`,
    );
    return user ? req.set('Authorization', as(user)) : req;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AUDIT_RECORDER)
      .useValue(audit)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    thisYear = app.get<Clock>(CLOCK).now().getUTCFullYear();

    owner = new Pool({ connectionString: process.env.TEST_DATABASE_OWNER_URL });
    for (const [name, user] of Object.entries(USERS)) {
      await owner.query(
        `INSERT INTO user_account (id, email, password_hash, role, status, version, created_at, updated_at)
         VALUES ($1, $2, 'hash', $3, 'ACTIVE', 1, now(), now()) ON CONFLICT (id) DO NOTHING`,
        [user.id, `population-e2e-${name}@test.local`, user.role],
      );
    }
    for (const id of [SOURCE_ID, SOURCE_2_ID]) {
      await owner.query(
        `INSERT INTO source (id, source_type, title, reliability, created_by, version, created_at, updated_at)
         VALUES ($1, 'CENSUS', $2, 4, $3, 1, now(), now()) ON CONFLICT (id) DO NOTHING`,
        [id, `Population e2e source ${id}`, USERS.editor.id],
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

  describe('POST', () => {
    it('answers 201 with the claim, an ETag, no warnings and one audit entry', async () => {
      const villageId = await village();
      const res = await submit(villageId, body(1945, 1200)).expect(201);

      expect(res.body).toMatchObject({
        status: 'UNVERIFIED',
        isPreferred: false,
        population: 1200,
        referenceYear: 1945,
        countType: 'CENSUS',
        sourceId: SOURCE_ID,
        createdBy: USERS.author.id,
        version: 1,
        warnings: [],
      });
      expect(res.headers.etag).toBe('"1"');
      expect(audit.entries).toEqual([
        expect.objectContaining({
          action: 'claim.submitted',
          entityId: (res.body as RecordBody).claimId,
          villageId,
          inTransaction: true,
        }),
      ]);
    });

    it('rule 5: answers 201 with ANOMALY_SUSPECTED for a jump above 50% a year', async () => {
      const villageId = await village();
      await published(villageId, 1945, 1000);

      const jump = await submit(villageId, body(1946, 1600)).expect(201);
      expect((jump.body as RecordBody).warnings).toEqual(['ANOMALY_SUSPECTED']);
      const calm = await submit(villageId, body(1946, 1400)).expect(201);
      expect((calm.body as RecordBody).warnings).toEqual([]);
    });

    it('rule 1: answers 422 without a source', async () => {
      const villageId = await village();
      await submit(villageId, body(1945, 1200, { sourceId: undefined })).expect(422);
      await submit(villageId, body(1945, 1200, { sourceId: null })).expect(422);
    });

    it('rule 3: answers 422 MUST_NOT_BE_FUTURE for next year, and 400 for a bad shape', async () => {
      const villageId = await village();
      const res = await submit(villageId, body(thisYear + 1, 1200)).expect(422);
      expect(res.body).toMatchObject({
        code: 'VALIDATION_FAILED',
        errors: [expect.objectContaining({ field: 'referenceYear', code: 'MUST_NOT_BE_FUTURE' })],
      });
      await submit(villageId, body(thisYear, 1200)).expect(201);
      await submit(villageId, body(1945, 1_000_001)).expect(422);
      await submit(villageId, body(1945, 12.5)).expect(400);
      await submit(villageId, body(1945, 1200, { countType: 'GUESS' })).expect(400);
      await submit(villageId, body(1945, 1200, { extra: true })).expect(400);
    });

    it('rule 2: answers 409 for the same number from the same source, 201 from another', async () => {
      const villageId = await village();
      await submit(villageId, body(1945, 1200)).expect(201);
      await submit(villageId, body(1945, 1200), 'stranger').expect(409);
      await submit(villageId, body(1945, 1200, { sourceId: SOURCE_2_ID })).expect(201);
    });

    it('rule 4: accepts another number for the same question and lists it as a conflict', async () => {
      const villageId = await village();
      const first = await published(villageId, 1945, 1200);
      await submit(villageId, body(1945, 1300, { sourceId: SOURCE_2_ID })).expect(201);

      const conflicts = await http()
        .get(`/api/v1/curation/conflicts?villageId=${villageId}&claimType=POPULATION`)
        .set('Authorization', as('editor'))
        .expect(200);
      expect((conflicts.body as { content: unknown[] }).content).toEqual([
        expect.objectContaining({ distinctValues: 2, claimCount: 2 }),
      ]);
      // The published number is untouched.
      const publicList = (await list(villageId).expect(200)).body as PageBody;
      expect(publicList.content.map((r) => [r.claimId, r.population])).toEqual([
        [first.claimId, 1200],
      ]);
    });

    it('answers 404 for an unknown village and 401 without a token', async () => {
      await submit(MISSING, body(1945, 1200)).expect(404);
      await http().post(`${VILLAGES}/${MISSING}/population`).send(body(1945, 1)).expect(401);
    });
  });

  describe('GET', () => {
    it('shows the public the preferred records only, ordered by year', async () => {
      const villageId = await village();
      await published(villageId, 1961, 900);
      await published(villageId, 1922, 500);
      await submit(villageId, body(1931, 700)).expect(201);

      const res = await list(villageId).expect(200);
      const page = res.body as PageBody;
      expect(page.content.map((r) => r.referenceYear)).toEqual([1922, 1961]);
      expect(page.content.every((r) => r.isPreferred && r.status === 'VERIFIED')).toBe(true);
      expect(page.page.totalElements).toBe(2);
    });

    it('honours includeUnverified for editors and authors, not for a stranger', async () => {
      const villageId = await village();
      await published(villageId, 1922, 500);
      await submit(villageId, body(1931, 700)).expect(201);

      const years = async (user?: UserName) =>
        ((await list(villageId, user, true).expect(200)).body as PageBody).content.map(
          (r) => r.referenceYear,
        );
      expect(await years('editor')).toEqual([1922, 1931]);
      expect(await years('author')).toEqual([1922, 1931]);
      expect(await years('stranger')).toEqual([1922]);
      expect(await years()).toEqual([1922]);
    });

    it('answers 404 for an unknown village and for a draft read anonymously', async () => {
      await list(MISSING).expect(404);
      const draft = await village('DRAFT');
      await list(draft).expect(404);
      await list(draft, 'stranger').expect(200);
    });
  });

  describe('GET /stats', () => {
    it('returns the lag() series of the preferred records and the summary', async () => {
      const villageId = await village();
      await published(villageId, 1931, 1000);
      await published(villageId, 1933, 1210);
      await submit(villageId, body(1940, 5)).expect(201); // unverified: ignored

      const res = await http().get(`${VILLAGES}/${villageId}/population/stats`).expect(200);
      expect(res.body).toMatchObject({
        villageId,
        series: [
          { referenceYear: 1931, previousYear: null, percentChange: null },
          {
            referenceYear: 1933,
            countType: 'CENSUS',
            population: 1210,
            previousYear: 1931,
            previousPopulation: 1000,
            absoluteChange: 210,
            percentChange: 21,
            averageYearlyGrowthPercent: 10,
          },
        ],
        summary: {
          first: { referenceYear: 1931, population: 1000 },
          latest: { referenceYear: 1933, population: 1210 },
          min: { population: 1000 },
          max: { population: 1210 },
        },
      });
      expect((res.body as { series: unknown[] }).series).toHaveLength(2);
    });

    it('returns an empty series and a null summary without records, 404 for an unknown village', async () => {
      const villageId = await village();
      const res = await http().get(`${VILLAGES}/${villageId}/population/stats`).expect(200);
      expect(res.body).toEqual({ villageId, series: [], summary: null });
      await http().get(`${VILLAGES}/${MISSING}/population/stats`).expect(404);
    });
  });

  describe('PATCH and DELETE /{claimId}', () => {
    const patch = (villageId: string, claimId: string, user: UserName, version?: number) => {
      const req = http()
        .patch(`${VILLAGES}/${villageId}/population/${claimId}`)
        .set('Authorization', as(user));
      return version === undefined ? req : req.set('If-Match', `"${version}"`);
    };
    const remove = (villageId: string, claimId: string, user: UserName, version = 1) =>
      http()
        .delete(`${VILLAGES}/${villageId}/population/${claimId}`)
        .set('Authorization', as(user))
        .set('If-Match', `"${version}"`);

    it('answers 428 without If-Match, 412 when stale, 200 with the new value and version', async () => {
      const villageId = await village();
      const record = (await submit(villageId, body(1945, 1200)).expect(201)).body as RecordBody;

      await patch(villageId, record.claimId, 'author').send({ population: 1250 }).expect(428);
      await patch(villageId, record.claimId, 'author', 7).send({ population: 1250 }).expect(412);
      audit.clear();
      const res = await patch(villageId, record.claimId, 'author', 1)
        .send({ population: 1250, countType: 'ESTIMATE' })
        .expect(200);

      expect(res.body).toMatchObject({
        population: 1250,
        countType: 'ESTIMATE',
        referenceYear: 1945,
        version: 2,
        warnings: [],
      });
      expect(res.headers.etag).toBe('"2"');
      expect(audit.entries).toEqual([
        expect.objectContaining({ action: 'claim.edited', villageId }),
      ]);
      expect(audit.entries[0]).toMatchObject({
        before: { fact: { population: 1200, countType: 'CENSUS', referenceYear: 1945 } },
        after: { fact: { population: 1250, countType: 'ESTIMATE', referenceYear: 1945 } },
      });
    });

    it("answers 403 to someone else's record and 404 for another village's", async () => {
      const [villageId, other] = [await village(), await village()];
      const record = (await submit(villageId, body(1945, 1200)).expect(201)).body as RecordBody;
      await patch(villageId, record.claimId, 'stranger', 1).send({ population: 1 }).expect(403);
      await patch(other, record.claimId, 'author', 1).send({ population: 1 }).expect(404);
      await patch(villageId, record.claimId, 'author', 1)
        .send({ referenceYear: thisYear + 1 })
        .expect(422);
    });

    it('withdraws with one audit entry; the record cannot be edited afterwards', async () => {
      const villageId = await village();
      const record = (await submit(villageId, body(1945, 1200)).expect(201)).body as RecordBody;
      audit.clear();

      await remove(villageId, record.claimId, 'author').expect(204);

      expect(audit.entries).toEqual([
        expect.objectContaining({ action: 'claim.withdrawn', villageId }),
      ]);
      await patch(villageId, record.claimId, 'author', 2).send({ population: 1 }).expect(422);
    });
  });
});
