import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client, DatabaseError } from 'pg';

// Type only (erased): AppModule reads the environment when loaded, so it is required in beforeAll.
import type { AppModule as AppModuleType } from '../../src/app.module';
import { PopulationQueries } from '../../src/modules/population';
import {
  POPULATION_REPOSITORY,
  type PopulationRepository,
} from '../../src/modules/population/domain/population.repository';
import { AUDIT_RECORDER } from '../../src/shared/kernel';
import { InMemoryAuditRecorder } from '../support/in-memory-audit-recorder';
import { createTestJwtKeys, type TestJwtKeys } from '../support/jwt-test-keys';
import {
  CONTAINER_STARTUP_TIMEOUT_MS,
  startTestDatabase,
  type TestDatabase,
} from '../support/test-database';

const AUTHOR = '00000000-0000-7000-8000-000000001f01';
const SOURCE = '00000000-0000-7000-8000-000000001f20';
const VILLAGES = {
  a: '00000000-0000-7000-8000-000000001f10',
  b: '00000000-0000-7000-8000-000000001f11',
  empty: '00000000-0000-7000-8000-000000001f12',
} as const;

describe('population: table, lag() statistics and DISTINCT ON (PostGIS)', () => {
  let database: TestDatabase;
  let keys: TestJwtKeys;
  let app: INestApplicationContext;
  let owner: Client;
  let records: PopulationRepository;
  let queries: PopulationQueries;
  let counter = 0;

  /** A claim inserted directly; preferred claims are VERIFIED (database CHECK). */
  async function insertClaim(
    claimType: string,
    options: { villageId?: string; groupKey?: string; preferred?: boolean } = {},
  ): Promise<string> {
    counter += 1;
    const preferred = options.preferred ?? false;
    const result = await owner.query<{ id: string }>(
      `INSERT INTO claim (id, claim_type, village_id, group_key, value_hash, source_id, status,
         is_preferred, created_by, version, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, 1, now(), now())
       RETURNING id`,
      [
        claimType,
        options.villageId ?? VILLAGES.a,
        options.groupKey ?? `int|${counter}`,
        `hash-${counter}`,
        SOURCE,
        preferred ? 'VERIFIED' : 'UNVERIFIED',
        preferred,
        AUTHOR,
      ],
    );
    return result.rows[0]!.id;
  }

  /** A population claim and its row. */
  async function record(
    villageId: string,
    referenceYear: number,
    countType: string,
    population: number,
    preferred = true,
  ): Promise<string> {
    const claimId = await insertClaim('POPULATION', {
      villageId,
      preferred,
      groupKey: `population|${villageId}|${referenceYear}|${countType}|${counter}`,
    });
    await owner.query(
      `INSERT INTO population_record (claim_id, population, reference_year, count_type)
       VALUES ($1, $2, $3, $4)`,
      [claimId, population, referenceYear, countType],
    );
    return claimId;
  }

  beforeAll(async () => {
    [database, keys] = await Promise.all([startTestDatabase(), createTestJwtKeys()]);
    process.env.DATABASE_URL = database.appUrl;
    process.env.JWT_PRIVATE_KEY_FILE = keys.privateKeyFile;
    process.env.JWT_PUBLIC_KEY_FILE = keys.publicKeyFile;
    process.env.LOG_LEVEL ??= 'silent';

    owner = new Client({ connectionString: database.ownerUrl });
    await owner.connect();
    await owner.query(
      `INSERT INTO user_account (id, email, password_hash, role, status, version, created_at, updated_at)
       VALUES ($1, 'population-int@test.local', 'hash', 'CONTRIBUTOR', 'ACTIVE', 1, now(), now())`,
      [AUTHOR],
    );
    for (const [slug, id] of Object.entries(VILLAGES)) {
      await owner.query(
        `INSERT INTO village (id, slug, settlement_status, publication_status, display_name_ar,
           created_by, version, created_at, updated_at)
         VALUES ($1, $2, 'INHABITED', 'PUBLISHED', 'قرية', $3, 1, now(), now())`,
        [id, `population-${slug}`, AUTHOR],
      );
    }
    await owner.query(
      `INSERT INTO source (id, source_type, title, reliability, created_by, version, created_at, updated_at)
       VALUES ($1, 'CENSUS', 'Population source', 4, $2, 1, now(), now())`,
      [SOURCE, AUTHOR],
    );

    const { AppModule } = jest.requireActual<{ AppModule: typeof AppModuleType }>(
      '../../src/app.module',
    );
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AUDIT_RECORDER)
      .useValue(new InMemoryAuditRecorder())
      .compile();
    app = await moduleRef.init();
    records = app.get<PopulationRepository>(POPULATION_REPOSITORY);
    queries = app.get(PopulationQueries);
  }, CONTAINER_STARTUP_TIMEOUT_MS);

  afterAll(async () => {
    await owner?.end();
    await app?.close();
    await Promise.all([database?.stop(), keys?.cleanup()]);
  });

  describe('population_record', () => {
    it('rejects a claim of another type (composite foreign key)', async () => {
      const claimId = await insertClaim('MEASURE');
      const error = await owner
        .query(
          `INSERT INTO population_record (claim_id, population, reference_year, count_type)
           VALUES ($1, 10, 1945, 'CENSUS')`,
          [claimId],
        )
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(DatabaseError);
      expect((error as DatabaseError).code).toBe('23503');
    });

    it('keeps claim_type constant (structural CHECK)', async () => {
      const claimId = await insertClaim('MEASURE');
      const error = await owner
        .query(
          `INSERT INTO population_record (claim_id, claim_type, population, reference_year, count_type)
           VALUES ($1, 'MEASURE', 10, 1945, 'CENSUS')`,
          [claimId],
        )
        .catch((e: unknown) => e);
      expect((error as DatabaseError).code).toBe('23514');
    });

    it('loses the row when its claim is deleted (cascade)', async () => {
      const claimId = await record(VILLAGES.empty, 1900, 'CENSUS', 10, false);
      await owner.query('DELETE FROM claim WHERE id = $1', [claimId]);
      const left = await owner.query('SELECT 1 FROM population_record WHERE claim_id = $1', [
        claimId,
      ]);
      expect(left.rowCount).toBe(0);
    });
  });

  describe('statistics and latest records', () => {
    const ids: Record<string, string> = {};

    beforeAll(async () => {
      // Village a, CENSUS: 1000 (1931) -> 1210 (1933) -> 605 (1945); ESTIMATE 3000 (1940).
      ids.c1931 = await record(VILLAGES.a, 1931, 'CENSUS', 1000);
      ids.c1933 = await record(VILLAGES.a, 1933, 'CENSUS', 1210);
      ids.e1940 = await record(VILLAGES.a, 1940, 'ESTIMATE', 3000);
      ids.c1945 = await record(VILLAGES.a, 1945, 'CENSUS', 605);
      // Not published: must appear nowhere.
      ids.unverified = await record(VILLAGES.a, 1950, 'CENSUS', 99_999, false);
      // Village b: same latest year, a census beats an estimate.
      ids.b1990 = await record(VILLAGES.b, 1990, 'REGISTERED', 400);
      ids.b1997e = await record(VILLAGES.b, 1997, 'ESTIMATE', 520);
      ids.b1997c = await record(VILLAGES.b, 1997, 'CENSUS', 500);
    });

    it('computes lag() changes per count type over the preferred records only', async () => {
      const series = await records.changes(VILLAGES.a);
      expect(series).toEqual([
        {
          claimId: ids.c1931,
          referenceYear: 1931,
          countType: 'CENSUS',
          population: 1000,
          previousYear: null,
          previousPopulation: null,
          absoluteChange: null,
          percentChange: null,
          averageYearlyGrowthPercent: null,
        },
        {
          claimId: ids.c1933,
          referenceYear: 1933,
          countType: 'CENSUS',
          population: 1210,
          previousYear: 1931,
          previousPopulation: 1000,
          absoluteChange: 210,
          percentChange: 21,
          averageYearlyGrowthPercent: 10,
        },
        {
          claimId: ids.e1940,
          referenceYear: 1940,
          countType: 'ESTIMATE',
          population: 3000,
          previousYear: null,
          previousPopulation: null,
          absoluteChange: null,
          percentChange: null,
          averageYearlyGrowthPercent: null,
        },
        {
          claimId: ids.c1945,
          referenceYear: 1945,
          countType: 'CENSUS',
          population: 605,
          previousYear: 1933,
          previousPopulation: 1210,
          absoluteChange: -605,
          percentChange: -50,
          // 0.5 ^ (1/12) - 1 = -5.6126%
          averageYearlyGrowthPercent: -5.61,
        },
      ]);
    });

    it('returns the latest preferred record per village with DISTINCT ON', async () => {
      const latest = await queries.latestFor([VILLAGES.a, VILLAGES.b, VILLAGES.empty, VILLAGES.a]);
      expect([...latest.keys()].sort()).toEqual([VILLAGES.a, VILLAGES.b].sort());
      expect(latest.get(VILLAGES.a)).toEqual({
        claimId: ids.c1945,
        population: 605,
        referenceYear: 1945,
        countType: 'CENSUS',
      });
      expect(latest.get(VILLAGES.b)?.claimId).toBe(ids.b1997c);
      expect((await queries.latestFor([])).size).toBe(0);
    });

    it('returns the published history of a village by year', async () => {
      const history = await queries.historyFor(VILLAGES.b);
      expect(history.map((r) => r.claimId)).toEqual([ids.b1990, ids.b1997c, ids.b1997e]);
    });

    it('lists by year, with unverified claims only in the wider scopes', async () => {
      const page = (scope: Parameters<PopulationRepository['listForVillage']>[0]['scope']) =>
        records.listForVillage({ villageId: VILLAGES.a, scope, page: 0, size: 10 });
      const preferred = await page({ kind: 'PREFERRED' });
      expect(preferred.content.map((r) => r.referenceYear)).toEqual([1931, 1933, 1940, 1945]);
      expect(preferred.page.totalElements).toBe(4);
      expect((await page({ kind: 'ALL' })).content.map((r) => r.claimId)).toContain(ids.unverified);
      expect((await page({ kind: 'PREFERRED_OR_OWN', userId: AUTHOR })).page.totalElements).toBe(5);
      expect((await page({ kind: 'PREFERRED_OR_OWN', userId: SOURCE })).page.totalElements).toBe(4);
    });
  });
});
