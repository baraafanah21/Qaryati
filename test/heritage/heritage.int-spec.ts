import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client, DatabaseError } from 'pg';

// Type only (erased): AppModule reads the environment when loaded, so it is required in beforeAll.
import type { AppModule as AppModuleType } from '../../src/app.module';
import { HeritageQueries } from '../../src/modules/heritage';
import {
  HERITAGE_FACT_REPOSITORY,
  type HeritageFactRepository,
} from '../../src/modules/heritage/domain/heritage-fact.repository';
import { AUDIT_RECORDER } from '../../src/shared/kernel';
import { InMemoryAuditRecorder } from '../support/in-memory-audit-recorder';
import { createTestJwtKeys, type TestJwtKeys } from '../support/jwt-test-keys';
import {
  CONTAINER_STARTUP_TIMEOUT_MS,
  startTestDatabase,
  type TestDatabase,
} from '../support/test-database';

const AUTHOR = '00000000-0000-7000-8000-000000002f01';
const OTHER = '00000000-0000-7000-8000-000000002f02';
const SOURCE = '00000000-0000-7000-8000-000000002f20';
const VILLAGES = {
  a: '00000000-0000-7000-8000-000000002f10',
  b: '00000000-0000-7000-8000-000000002f11',
  /** Rows of the table tests, kept apart from the lists. */
  tables: '00000000-0000-7000-8000-000000002f12',
} as const;

/** Per table: its claim type and an INSERT of one valid row for `$1` (claim id). */
const TABLES = {
  history_overview: {
    type: 'HISTORY_OVERVIEW',
    insert: `INSERT INTO history_overview (claim_id, summary) VALUES ($1, 'Founded long ago.')`,
    insertTyped: `INSERT INTO history_overview (claim_id, claim_type, summary)
      VALUES ($1, 'MEASURE', 'x')`,
  },
  historical_event: {
    type: 'HISTORICAL_EVENT',
    insert: `INSERT INTO historical_event (claim_id, title, description, start_date, date_precision)
      VALUES ($1, 'Flood', 'The wadi flooded.', '1948-01-01', 'YEAR')`,
    insertTyped: `INSERT INTO historical_event (claim_id, claim_type, title, description,
      start_date, date_precision) VALUES ($1, 'MEASURE', 'x', 'x', '1948-01-01', 'YEAR')`,
  },
  landmark: {
    type: 'LANDMARK',
    insert: `INSERT INTO landmark (claim_id, name, landmark_type) VALUES ($1, 'Old Well', 'WELL')`,
    insertTyped: `INSERT INTO landmark (claim_id, claim_type, name, landmark_type)
      VALUES ($1, 'MEASURE', 'x', 'WELL')`,
  },
  cultural_item: {
    type: 'CULTURAL_ITEM',
    insert: `INSERT INTO cultural_item (claim_id, category, name, description)
      VALUES ($1, 'DISH', 'Musakhan', 'Bread and onions.')`,
    insertTyped: `INSERT INTO cultural_item (claim_id, claim_type, category, name, description)
      VALUES ($1, 'MEASURE', 'DISH', 'x', 'x')`,
  },
} as const;

describe('heritage: tables, native SQL and HeritageQueries (PostGIS)', () => {
  let database: TestDatabase;
  let keys: TestJwtKeys;
  let app: INestApplicationContext;
  let owner: Client;
  let facts: HeritageFactRepository;
  let queries: HeritageQueries;
  let counter = 0;

  /** A claim inserted directly; preferred claims are VERIFIED (database CHECK). */
  async function insertClaim(
    claimType: string,
    options: { villageId?: string; preferred?: boolean; createdBy?: string } = {},
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
        options.villageId ?? VILLAGES.tables,
        `int|${counter}`,
        `hash-${counter}`,
        SOURCE,
        preferred ? 'VERIFIED' : 'UNVERIFIED',
        preferred,
        options.createdBy ?? AUTHOR,
      ],
    );
    return result.rows[0]!.id;
  }

  async function failure(statement: string, params: unknown[]): Promise<string | undefined> {
    const error = await owner.query(statement, params).then(
      () => undefined,
      (e: unknown) => e,
    );
    if (error === undefined) return undefined;
    expect(error).toBeInstanceOf(DatabaseError);
    return (error as DatabaseError).code;
  }

  beforeAll(async () => {
    [database, keys] = await Promise.all([startTestDatabase(), createTestJwtKeys()]);
    process.env.DATABASE_URL = database.appUrl;
    process.env.JWT_PRIVATE_KEY_FILE = keys.privateKeyFile;
    process.env.JWT_PUBLIC_KEY_FILE = keys.publicKeyFile;
    process.env.LOG_LEVEL ??= 'silent';

    owner = new Client({ connectionString: database.ownerUrl });
    await owner.connect();
    for (const [id, email] of [
      [AUTHOR, 'heritage-int@test.local'],
      [OTHER, 'heritage-int-other@test.local'],
    ]) {
      await owner.query(
        `INSERT INTO user_account (id, email, password_hash, role, status, version, created_at, updated_at)
         VALUES ($1, $2, 'hash', 'CONTRIBUTOR', 'ACTIVE', 1, now(), now())`,
        [id, email],
      );
    }
    for (const [slug, id] of Object.entries(VILLAGES)) {
      await owner.query(
        `INSERT INTO village (id, slug, settlement_status, publication_status, display_name_ar,
           created_by, version, created_at, updated_at)
         VALUES ($1, $2, 'INHABITED', 'PUBLISHED', 'قرية', $3, 1, now(), now())`,
        [id, `heritage-${slug}`, AUTHOR],
      );
    }
    await owner.query(
      `INSERT INTO source (id, source_type, title, reliability, created_by, version, created_at, updated_at)
       VALUES ($1, 'BOOK', 'Heritage source', 4, $2, 1, now(), now())`,
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
    facts = app.get<HeritageFactRepository>(HERITAGE_FACT_REPOSITORY);
    queries = app.get(HeritageQueries);
  }, CONTAINER_STARTUP_TIMEOUT_MS);

  afterAll(async () => {
    await owner?.end();
    await app?.close();
    await Promise.all([database?.stop(), keys?.cleanup()]);
  });

  describe.each(Object.entries(TABLES))('%s', (table, { type, insert, insertTyped }) => {
    it('accepts a row of its own claim type', async () => {
      const claimId = await insertClaim(type);
      expect(await failure(insert, [claimId])).toBeUndefined();
    });

    it('rejects a claim of another type (composite foreign key, 23503)', async () => {
      const claimId = await insertClaim('MEASURE');
      expect(await failure(insert, [claimId])).toBe('23503');
    });

    it('keeps claim_type constant (structural CHECK, 23514)', async () => {
      const claimId = await insertClaim('MEASURE');
      expect(await failure(insertTyped, [claimId])).toBe('23514');
    });

    it('holds one row per claim (primary key, 23505)', async () => {
      const claimId = await insertClaim(type);
      await owner.query(insert, [claimId]);
      expect(await failure(insert, [claimId])).toBe('23505');
    });

    it('loses the row when its claim is deleted (cascade)', async () => {
      const claimId = await insertClaim(type);
      await owner.query(insert, [claimId]);
      await owner.query('DELETE FROM claim WHERE id = $1', [claimId]);
      const left = await owner.query(`SELECT 1 FROM ${table} WHERE claim_id = $1`, [claimId]);
      expect(left.rowCount).toBe(0);
    });
  });

  describe('landmark location', () => {
    it('writes and reads the point with native SQL', async () => {
      const claimId = await insertClaim('LANDMARK', { villageId: VILLAGES.b });
      const value = {
        name: 'Ottoman Khan',
        landmarkType: 'KHAN' as const,
        description: null,
        location: { latitude: 32.22111, longitude: 35.25444 },
        era: 'OTTOMAN' as const,
      };
      await facts.insert('LANDMARK', claimId, value);
      expect(await facts.findByClaimId('LANDMARK', claimId)).toEqual(value);

      await facts.update('LANDMARK', claimId, { ...value, location: null });
      expect(await facts.findByClaimId('LANDMARK', claimId)).toEqual({ ...value, location: null });
    });

    it('uses the GiST index landmark_location_gist for ST_DWithin', async () => {
      await owner.query('BEGIN');
      try {
        await owner.query('SET LOCAL enable_seqscan = off');
        const result = await owner.query<{ 'QUERY PLAN': string }>(
          `EXPLAIN SELECT claim_id FROM landmark
           WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint(35.25, 32.22), 4326)::geography, 1000)`,
        );
        const plan = result.rows.map((row) => row['QUERY PLAN']).join('\n');
        expect(plan).toContain('landmark_location_gist');
      } finally {
        await owner.query('ROLLBACK');
      }
    });
  });

  describe('lists and published sections', () => {
    const ids: Record<string, string> = {};

    /** A claim of `type` about village a and its row, written through the repository. */
    async function fact<T extends Parameters<HeritageFactRepository['insert']>[0]>(
      type: T,
      value: Parameters<HeritageFactRepository['insert']>[2] & object,
      options: { preferred?: boolean; createdBy?: string } = {},
    ): Promise<string> {
      const claimId = await insertClaim(type, {
        villageId: VILLAGES.a,
        preferred: true,
        ...options,
      });
      await facts.insert(type, claimId, value as never);
      return claimId;
    }

    const event = (title: string, startDate: string) => ({
      title,
      description: `About ${title}.`,
      startDate,
      endDate: null,
      datePrecision: 'DAY' as const,
    });

    beforeAll(async () => {
      ids.e1948 = await fact('HISTORICAL_EVENT', event('Exile', '1948-05-15'));
      ids.e1917 = await fact('HISTORICAL_EVENT', event('Mandate', '1917-12-09'));
      ids.eDraft = await fact('HISTORICAL_EVENT', event('Draft', '1930-01-01'), {
        preferred: false,
      });
      ids.eOther = await fact('HISTORICAL_EVENT', event('Other', '1920-01-01'), {
        preferred: false,
        createdBy: OTHER,
      });
      ids.mosque = await fact('LANDMARK', {
        name: 'Mosque',
        landmarkType: 'MOSQUE',
        description: null,
        location: null,
        era: null,
      });
      ids.spring = await fact('LANDMARK', {
        name: 'Ain',
        landmarkType: 'SPRING',
        description: 'Fresh water.',
        location: { latitude: 32.1, longitude: 35.2 },
        era: null,
      });
      ids.dish = await fact('CULTURAL_ITEM', {
        category: 'DISH',
        name: 'Musakhan',
        description: 'Bread.',
      });
      ids.song = await fact('CULTURAL_ITEM', {
        category: 'FOLK_SONG',
        name: 'Dalouna',
        description: 'A song.',
      });
      ids.history = await fact('HISTORY_OVERVIEW', { summary: 'An old village.' });
      ids.historyDraft = await fact(
        'HISTORY_OVERVIEW',
        { summary: 'A draft.' },
        { preferred: false },
      );
    });

    const list = <T extends 'HISTORICAL_EVENT' | 'LANDMARK' | 'CULTURAL_ITEM'>(
      type: T,
      scope: Parameters<HeritageFactRepository['list']>[0]['scope'],
      filter: object = {},
    ) =>
      facts.list({
        type,
        villageId: VILLAGES.a,
        scope,
        filter: filter as never,
        page: 0,
        size: 20,
      });

    it('orders events by start date, preferred only unless the scope is wider', async () => {
      const preferred = await list('HISTORICAL_EVENT', { kind: 'PREFERRED' });
      expect(preferred.content.map((e) => e.claimId)).toEqual([ids.e1917, ids.e1948]);
      expect(preferred.content[0]).toMatchObject({ startDate: '1917-12-09', endDate: null });

      const all = await list('HISTORICAL_EVENT', { kind: 'ALL' });
      expect(all.content.map((e) => e.claimId)).toEqual([
        ids.e1917,
        ids.eOther,
        ids.eDraft,
        ids.e1948,
      ]);
      const own = await list('HISTORICAL_EVENT', { kind: 'PREFERRED_OR_OWN', userId: OTHER });
      expect(own.page.totalElements).toBe(3);
    });

    it('filters landmarks by type and cultural items by category', async () => {
      const springs = await list('LANDMARK', { kind: 'PREFERRED' }, { landmarkType: 'SPRING' });
      expect(springs.content).toEqual([
        {
          claimId: ids.spring,
          name: 'Ain',
          landmarkType: 'SPRING',
          description: 'Fresh water.',
          location: { latitude: 32.1, longitude: 35.2 },
          era: null,
        },
      ]);
      expect(springs.page.totalElements).toBe(1);
      const dishes = await list('CULTURAL_ITEM', { kind: 'PREFERRED' }, { category: 'DISH' });
      expect(dishes.content.map((c) => c.claimId)).toEqual([ids.dish]);
    });

    it('HeritageQueries returns the published sections only', async () => {
      const sections = await queries.sectionsFor(VILLAGES.a);
      expect(sections.history).toEqual({ claimId: ids.history, summary: 'An old village.' });
      expect(sections.events.map((e) => e.claimId)).toEqual([ids.e1917, ids.e1948]);
      expect(sections.landmarks.map((l) => l.claimId)).toEqual([ids.spring, ids.mosque]);
      expect(sections.culturalItems.map((c) => c.claimId)).toEqual([ids.dish, ids.song]);

      const empty = await queries.sectionsFor(VILLAGES.b);
      expect(empty).toEqual({ history: null, events: [], landmarks: [], culturalItems: [] });
    });
  });
});
