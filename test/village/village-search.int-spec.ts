import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PgDialect } from 'drizzle-orm/pg-core';
import { Client, type Pool } from 'pg';

// Type only (erased): AppModule reads the environment when loaded, so it is required in beforeAll.
import type { AppModule as AppModuleType } from '../../src/app.module';
import { Role } from '../../src/modules/iam';
import { PG_POOL } from '../../src/platform/database/database';
import { VillageQueries, type SearchVillagesInput } from '../../src/modules/village';
import { villageSearchQueries } from '../../src/modules/village/infrastructure/village-search.sql';
import { CURRENT_GOVERNORATES } from '../../src/modules/village/infrastructure/seed/governorates';
import { createTestJwtKeys, type TestJwtKeys } from '../support/jwt-test-keys';
import {
  CONTAINER_STARTUP_TIMEOUT_MS,
  startTestDatabase,
  type TestDatabase,
} from '../support/test-database';

const AUTHOR = '00000000-0000-7000-8000-000000000e01';
const SOURCE = '00000000-0000-7000-8000-000000000e20';
const EDITOR = { id: '00000000-0000-7000-8000-000000000e02', role: Role.EDITOR };
const CONTRIBUTOR = { id: AUTHOR, role: Role.CONTRIBUTOR };
const NABLUS = CURRENT_GOVERNORATES.find((unit) => unit.code === 'nablus')!;
const JENIN = CURRENT_GOVERNORATES.find((unit) => unit.code === 'jenin')!;

const VILLAGES = {
  beitFurik: { id: '00000000-0000-7000-8000-000000000e10', ar: 'بيت فوريك', en: 'Beit Furik' },
  majdal: { id: '00000000-0000-7000-8000-000000000e11', ar: 'المجدل', en: 'Al-Majdal' },
  burin: { id: '00000000-0000-7000-8000-000000000e12', ar: 'بورين', en: 'Burin' },
  draft: { id: '00000000-0000-7000-8000-000000000e13', ar: 'عصيرة الشمالية', en: null },
} as const;

describe('village search: trigram, filters and visibility (PostGIS)', () => {
  let database: TestDatabase;
  let keys: TestJwtKeys;
  let app: INestApplicationContext;
  let owner: Client;
  let villages: VillageQueries;
  let counter = 0;

  const search = (input: Partial<SearchVillagesInput>) =>
    villages.search({ sort: [], page: 0, size: 20, viewer: undefined, ...input });
  const ids = async (input: Partial<SearchVillagesInput>) =>
    (await search(input)).content.map((hit) => hit.id);

  /** A claim (preferred = verified and published) and its fact row, as the owner role. */
  async function insertFact(
    villageId: string,
    claimType: 'VILLAGE_NAME' | 'AFFILIATION',
    preferred: boolean,
    factSql: string,
    factParams: unknown[],
  ): Promise<void> {
    counter += 1;
    const { rows } = await owner.query<{ id: string }>(
      `INSERT INTO claim (id, claim_type, village_id, group_key, value_hash, source_id, status,
         is_preferred, created_by, version, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, 1, now(), now())
       RETURNING id`,
      [
        claimType,
        villageId,
        `search|${counter}`,
        `hash-${counter}`,
        SOURCE,
        preferred ? 'VERIFIED' : 'UNVERIFIED',
        preferred,
        AUTHOR,
      ],
    );
    await owner.query(factSql, [rows[0]!.id, ...factParams]);
  }

  const insertName = (villageId: string, name: string, normalized: string, preferred: boolean) =>
    insertFact(
      villageId,
      'VILLAGE_NAME',
      preferred,
      `INSERT INTO village_name (claim_id, name, name_normalized, lang, name_type)
       VALUES ($1, $2, $3, 'ar', 'HISTORICAL')`,
      [name, normalized],
    );

  const insertAffiliation = (villageId: string, unitId: string, preferred: boolean) =>
    insertFact(
      villageId,
      'AFFILIATION',
      preferred,
      'INSERT INTO village_affiliation (claim_id, admin_unit_id) VALUES ($1, $2)',
      [unitId],
    );

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
       VALUES ($1, 'search-author@test.local', 'hash', 'CONTRIBUTOR', 'ACTIVE', 1, now(), now())`,
      [AUTHOR],
    );
    await owner.query(
      `INSERT INTO source (id, source_type, title, reliability, created_by, version, created_at, updated_at)
       VALUES ($1, 'BOOK', 'Village search source', 4, $2, 1, now(), now())`,
      [SOURCE, AUTHOR],
    );
    for (const [slug, village] of Object.entries(VILLAGES)) {
      await owner.query(
        `INSERT INTO village (id, slug, settlement_status, publication_status, display_name_ar,
           display_name_en, created_by, version, created_at, updated_at)
         VALUES ($1, $2, 'INHABITED', $3, $4, $5, $6, 1, now(), now())`,
        [
          village.id,
          `search-${slug.toLowerCase()}`,
          slug === 'draft' ? 'DRAFT' : 'PUBLISHED',
          village.ar,
          village.en,
          AUTHOR,
        ],
      );
    }
    // Al-Majdal was also called Asqalan: a published alternative name, and an unpublished one.
    await insertName(VILLAGES.majdal.id, 'عسقلان', 'عسقلان', true);
    await insertName(VILLAGES.burin.id, 'خربة الطنطورة', 'خربه الطنطوره', false);
    // Beit Furik and the draft in Nablus (published), Burin only by an unpublished claim.
    await insertAffiliation(VILLAGES.beitFurik.id, NABLUS.id, true);
    await insertAffiliation(VILLAGES.draft.id, NABLUS.id, true);
    await insertAffiliation(VILLAGES.burin.id, NABLUS.id, false);
    await insertAffiliation(VILLAGES.burin.id, JENIN.id, true);

    const { AppModule } = jest.requireActual<{ AppModule: typeof AppModuleType }>(
      '../../src/app.module',
    );
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = await moduleRef.init();
    villages = app.get(VillageQueries);
  }, CONTAINER_STARTUP_TIMEOUT_MS);

  afterAll(async () => {
    await owner?.end();
    await app?.close();
    await Promise.all([database?.stop(), keys?.cleanup()]);
  });

  describe('q (trigram similarity)', () => {
    it('finds a village by a misspelled Arabic name, with its relevance', async () => {
      const page = await search({ q: 'بيت فوريق' });
      expect(page.content.map((hit) => hit.id)).toEqual([VILLAGES.beitFurik.id]);
      expect(page.content[0]!.relevance).toBeGreaterThan(0.3);
      expect(page.content[0]!.relevance).toBeLessThan(1);
    });

    it('normalizes q first: tashkeel and letter variants do not matter', async () => {
      expect(await ids({ q: 'بَيْت فُورِيك' })).toEqual([VILLAGES.beitFurik.id]);
    });

    it('finds a village by its English name, case-insensitively', async () => {
      expect(await ids({ q: 'beit fureik' })).toEqual([VILLAGES.beitFurik.id]);
    });

    it('finds a village by a published alternative name stored as village_name', async () => {
      expect(await ids({ q: 'عسقلان' })).toEqual([VILLAGES.majdal.id]);
      expect(await ids({ q: 'عسقلانن' })).toEqual([VILLAGES.majdal.id]);
    });

    it('ignores names that are not published (no preferred claim)', async () => {
      expect(await ids({ q: 'خربة الطنطورة' })).toEqual([]);
    });

    it('returns an empty page for text that normalizes to nothing', async () => {
      expect((await search({ q: '---' })).page.totalElements).toBe(0);
    });

    it('uses a GIN trigram index for every branch of q (EXPLAIN, seqscan off)', async () => {
      const { page } = villageSearchQueries({
        q: 'بيت فوريق',
        publicationStatus: 'PUBLISHED',
        sort: [{ field: 'relevance', direction: 'desc' }],
        page: 0,
        size: 20,
      });
      const query = new PgDialect().sqlToQuery(page);
      await owner.query('BEGIN');
      try {
        await owner.query('SET LOCAL enable_seqscan = off');
        // With one published name, starting from the few preferred claims is cheaper than the
        // trigram index. Give the planner a realistic number of names (rolled back below).
        await owner.query(
          `WITH c AS (
             INSERT INTO claim (id, claim_type, village_id, group_key, value_hash, source_id, status,
               is_preferred, created_by, version, created_at, updated_at)
             SELECT gen_random_uuid(), 'VILLAGE_NAME', $1, 'bulk|' || g, 'bulk-' || g, $2,
               'VERIFIED', true, $3, 1, now(), now()
             FROM generate_series(1, 20000) AS g
             RETURNING id)
           INSERT INTO village_name (claim_id, name, name_normalized, lang, name_type)
           SELECT id, id::text, id::text, 'ar', 'HISTORICAL' FROM c`,
          [VILLAGES.majdal.id, SOURCE, AUTHOR],
        );
        await owner.query('ANALYZE claim');
        await owner.query('ANALYZE village_name');
        const result = await owner.query<{ 'QUERY PLAN': string }>(
          `EXPLAIN ${query.sql}`,
          query.params,
        );
        const plan = result.rows.map((row) => row['QUERY PLAN']).join('\n');
        expect(plan).toContain('village_display_name_ar_trgm_idx');
        expect(plan).toContain('village_display_name_en_trgm_idx');
        expect(plan).toContain('village_name_name_normalized_trgm_idx');
      } finally {
        await owner.query('ROLLBACK');
      }
    });
  });

  describe('filters', () => {
    it('filters by governorate id or code through the preferred AFFILIATION', async () => {
      expect(await ids({ governorate: NABLUS.code })).toEqual([VILLAGES.beitFurik.id]);
      expect(await ids({ governorate: NABLUS.id.toUpperCase() })).toEqual([VILLAGES.beitFurik.id]);
      expect(await ids({ governorate: JENIN.code })).toEqual([VILLAGES.burin.id]);
    });

    it('rejects an unknown governorate with 422 on the field', async () => {
      await expect(search({ governorate: 'atlantis' })).rejects.toMatchObject({
        errors: [{ field: 'governorate' }],
      });
    });

    it('narrows to the given village ids, combined with the other filters', async () => {
      expect(await ids({ villageIds: [VILLAGES.burin.id, VILLAGES.majdal.id] })).toEqual([
        VILLAGES.majdal.id,
        VILLAGES.burin.id,
      ]);
      expect(
        await ids({ villageIds: [VILLAGES.burin.id, VILLAGES.majdal.id], q: 'بورين' }),
      ).toEqual([VILLAGES.burin.id]);
      expect(await ids({ villageIds: [] })).toEqual([]);
    });
  });

  describe('paging: the page carries the total, one statement per request (#50)', () => {
    let query: jest.SpiedFunction<Pool['query']>;
    /** The search statements sent to the pool (a read outside a transaction uses the pool). */
    const searchStatements = () =>
      query.mock.calls.filter(([config]) => {
        const text = typeof config === 'string' ? config : (config as { text: string }).text;
        return text.includes('FROM village v');
      }).length;

    beforeEach(() => {
      query = jest.spyOn(app.get<Pool>(PG_POOL, { strict: false }), 'query');
    });
    afterEach(() => query.mockRestore());

    it('counts every published match on the first and on a middle page, in one statement', async () => {
      const first = await search({ size: 1, page: 0 });
      expect(first.content).toHaveLength(1);
      expect(first.page.totalElements).toBe(3);
      expect(first.page.totalPages).toBe(3);

      const middle = await search({ size: 1, page: 1 });
      expect(middle.content).toHaveLength(1);
      expect(middle.page.totalElements).toBe(3);
      expect(searchStatements()).toBe(2);
    });

    it('counts the matches of q alone, not every village', async () => {
      const page = await search({ q: 'بيت فوريق' });
      expect(page.page.totalElements).toBe(1);
      expect(searchStatements()).toBe(1);
    });

    it('keeps the total on an empty page after the last one, with the separate count', async () => {
      const past = await search({ size: 1, page: 7 });
      expect(past.content).toEqual([]);
      expect(past.page.totalElements).toBe(3);
      expect(searchStatements()).toBe(2);
    });

    it('answers 0 for no match on the first page without a second statement', async () => {
      const none = await search({ q: 'زززززز' });
      expect(none.content).toEqual([]);
      expect(none.page.totalElements).toBe(0);
      expect(searchStatements()).toBe(1);
    });
  });

  describe('visibility', () => {
    it('hides drafts from anonymous callers and contributors, even when they filter for them', async () => {
      for (const viewer of [undefined, CONTRIBUTOR]) {
        expect(await ids({ viewer, q: 'عصيرة الشمالية' })).toEqual([]);
        expect(await ids({ viewer, publicationStatus: 'DRAFT' })).not.toContain(VILLAGES.draft.id);
      }
    });

    it('shows every status to editors, who may filter by one', async () => {
      expect(await ids({ viewer: EDITOR, governorate: NABLUS.code })).toEqual([
        VILLAGES.beitFurik.id,
        VILLAGES.draft.id,
      ]);
      expect(await ids({ viewer: EDITOR, publicationStatus: 'DRAFT' })).toEqual([
        VILLAGES.draft.id,
      ]);
    });
  });
});
