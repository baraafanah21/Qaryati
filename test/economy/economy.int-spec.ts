import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PgDialect } from 'drizzle-orm/pg-core';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client, DatabaseError } from 'pg';

// Type only (erased): AppModule reads the environment when loaded, so it is required in beforeAll.
import type { AppModule as AppModuleType } from '../../src/app.module';
import { EconomyQueries } from '../../src/modules/economy';
import {
  ECONOMY_FACT_REPOSITORY,
  type EconomyFactRepository,
} from '../../src/modules/economy/domain/economy-fact.repository';
import type { ProductRepository } from '../../src/modules/economy/domain/product';
import { CachedProductRepository } from '../../src/modules/economy/infrastructure/cached-product.repository';
import { DrizzleProductRepository } from '../../src/modules/economy/infrastructure/drizzle-product.repository';
import { villageIdsWithProductQuery } from '../../src/modules/economy/infrastructure/economy.sql';
import { SEED_PRODUCTS } from '../../src/modules/economy/infrastructure/seed/products';
import { AUDIT_RECORDER, FixedClock } from '../../src/shared/kernel';
import { InMemoryAuditRecorder } from '../support/in-memory-audit-recorder';
import { createTestJwtKeys, type TestJwtKeys } from '../support/jwt-test-keys';
import {
  CONTAINER_STARTUP_TIMEOUT_MS,
  startTestDatabase,
  type TestDatabase,
} from '../support/test-database';

const SEED_SQL = resolve(__dirname, '../../migrations/0023_seed_products.sql');

const AUTHOR = '00000000-0000-7000-8000-000000002201';
const SOURCE = '00000000-0000-7000-8000-000000002220';
const VILLAGES = {
  a: '00000000-0000-7000-8000-000000002210',
  b: '00000000-0000-7000-8000-000000002211',
  c: '00000000-0000-7000-8000-000000002212',
  /** Rows of the table tests, kept apart from the lists. */
  tables: '00000000-0000-7000-8000-000000002213',
} as const;

const product = (code: string) => SEED_PRODUCTS.find((p) => p.code === code)!;
const OLIVES = product('olives');
const SOAP = product('soap');

/** Per table: its claim type and an INSERT of one valid row for `$1` (claim id). */
const TABLES = {
  village_product: {
    type: 'VILLAGE_PRODUCT',
    insert: `INSERT INTO village_product (claim_id, product_id, significance)
      VALUES ($1, '${OLIVES.id}', 'PRIMARY')`,
    insertTyped: `INSERT INTO village_product (claim_id, claim_type, product_id, significance)
      VALUES ($1, 'MEASURE', '${OLIVES.id}', 'PRIMARY')`,
  },
  facility: {
    type: 'FACILITY',
    insert: `INSERT INTO facility (claim_id, facility_type, name) VALUES ($1, 'SCHOOL', 'School')`,
    insertTyped: `INSERT INTO facility (claim_id, claim_type, facility_type, name)
      VALUES ($1, 'MEASURE', 'SCHOOL', 'School')`,
  },
} as const;

interface ProductRow {
  id: string;
  code: string;
  category: string;
  name_ar: string;
  name_en: string;
}

describe('economy: tables, seed, native SQL and EconomyQueries (PostGIS)', () => {
  let database: TestDatabase;
  let keys: TestJwtKeys;
  let app: INestApplicationContext;
  let owner: Client;
  let facts: EconomyFactRepository;
  let queries: EconomyQueries;
  let counter = 0;

  /** A claim inserted directly; preferred claims are VERIFIED (database CHECK). */
  async function insertClaim(
    claimType: string,
    options: { villageId?: string; preferred?: boolean } = {},
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
        AUTHOR,
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

  const seeded = async (): Promise<ProductRow[]> =>
    (
      await owner.query<ProductRow>(
        'SELECT id, code, category, name_ar, name_en FROM product ORDER BY code',
      )
    ).rows;

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
       VALUES ($1, 'economy-int@test.local', 'hash', 'CONTRIBUTOR', 'ACTIVE', 1, now(), now())`,
      [AUTHOR],
    );
    for (const [slug, id] of Object.entries(VILLAGES)) {
      await owner.query(
        `INSERT INTO village (id, slug, settlement_status, publication_status, display_name_ar,
           created_by, version, created_at, updated_at)
         VALUES ($1, $2, 'INHABITED', 'PUBLISHED', 'قرية', $3, 1, now(), now())`,
        [id, `economy-${slug}`, AUTHOR],
      );
    }
    await owner.query(
      `INSERT INTO source (id, source_type, title, reliability, created_by, version, created_at, updated_at)
       VALUES ($1, 'BOOK', 'Economy source', 4, $2, 1, now(), now())`,
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
    facts = app.get<EconomyFactRepository>(ECONOMY_FACT_REPOSITORY);
    queries = app.get(EconomyQueries);
  }, CONTAINER_STARTUP_TIMEOUT_MS);

  afterAll(async () => {
    await owner?.end();
    await app?.close();
    await Promise.all([database?.stop(), keys?.cleanup()]);
  });

  describe('product seed', () => {
    it('the migrated database holds exactly the products of seed/products.ts', async () => {
      const expected = SEED_PRODUCTS.map((p) => ({
        id: p.id,
        code: p.code,
        category: p.category,
        name_ar: p.nameAr,
        name_en: p.nameEn,
      })).sort((a, b) => a.code.localeCompare(b.code));
      expect(SEED_PRODUCTS).toHaveLength(15);
      expect(await seeded()).toEqual(expected);
    });

    it('running the seed SQL again changes nothing, even over an edited row', async () => {
      await owner.query(`UPDATE product SET name_en = 'Edited' WHERE code = 'soap'`);
      const before = await seeded();

      await owner.query(await readFile(SEED_SQL, 'utf8'));

      expect(await seeded()).toEqual(before);
      await owner.query(`UPDATE product SET name_en = 'Soap' WHERE code = 'soap'`);
    });

    it('a product named by a village product cannot be deleted (RESTRICT, 23503)', async () => {
      const claimId = await insertClaim('VILLAGE_PRODUCT');
      await owner.query(TABLES.village_product.insert, [claimId]);
      expect(await failure('DELETE FROM product WHERE id = $1', [OLIVES.id])).toBe('23503');
    });
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

  it('writes and reads the facility point with native SQL', async () => {
    const claimId = await insertClaim('FACILITY', { villageId: VILLAGES.c });
    const value = {
      facilityType: 'CLINIC' as const,
      name: 'Village Clinic',
      location: { latitude: 32.22111, longitude: 35.25444 },
      establishedYear: 1985,
    };
    await facts.insert('FACILITY', claimId, value);
    expect(await facts.findByClaimId('FACILITY', claimId)).toEqual(value);

    await facts.update('FACILITY', claimId, { ...value, location: null, establishedYear: null });
    expect(await facts.findByClaimId('FACILITY', claimId)).toEqual({
      ...value,
      location: null,
      establishedYear: null,
    });
  });

  describe('lists, villages by product and published sections', () => {
    const ids: Record<string, string> = {};

    async function villageProduct(
      villageId: string,
      productId: string,
      preferred: boolean,
    ): Promise<string> {
      const claimId = await insertClaim('VILLAGE_PRODUCT', { villageId, preferred });
      await facts.insert('VILLAGE_PRODUCT', claimId, { productId, significance: 'PRIMARY' });
      return claimId;
    }

    beforeAll(async () => {
      ids.aOlives = await villageProduct(VILLAGES.a, OLIVES.id, true);
      ids.aSoap = await villageProduct(VILLAGES.a, SOAP.id, true);
      // Village b: olives only as an unverified claim, so it does not produce them yet.
      ids.bOlives = await villageProduct(VILLAGES.b, OLIVES.id, false);
      ids.bSoap = await villageProduct(VILLAGES.b, SOAP.id, true);

      for (const [key, facilityType, name, preferred] of [
        ['school', 'SCHOOL', 'Girls School', true],
        ['clinic', 'CLINIC', 'Clinic', true],
        ['draft', 'PARK', 'Park', false],
      ] as const) {
        const claimId = await insertClaim('FACILITY', { villageId: VILLAGES.a, preferred });
        await facts.insert('FACILITY', claimId, {
          facilityType,
          name,
          location: null,
          establishedYear: null,
        });
        ids[key] = claimId;
      }
    });

    it('finds only the villages with a preferred claim for the product', async () => {
      expect(await facts.villageIdsWithProduct(OLIVES.id)).toEqual([VILLAGES.a]);
      expect((await facts.villageIdsWithProduct(SOAP.id)).sort()).toEqual(
        [VILLAGES.a, VILLAGES.b].sort(),
      );
      expect(await facts.villageIdsWithProduct(product('honey').id)).toEqual([]);
    });

    it('reads village_product by village_product_product_id_idx', async () => {
      await owner.query('BEGIN');
      try {
        await owner.query('SET LOCAL enable_seqscan = off');
        const query = new PgDialect().sqlToQuery(villageIdsWithProductQuery(OLIVES.id));
        const result = await owner.query<{ 'QUERY PLAN': string }>(
          `EXPLAIN ${query.sql}`,
          query.params,
        );
        const plan = result.rows.map((row) => row['QUERY PLAN']).join('\n');
        expect(plan).toContain('village_product_product_id_idx');
      } finally {
        await owner.query('ROLLBACK');
      }
    });

    it('lists facilities by type then name, with the type filter and the scopes', async () => {
      const list = (scope: { kind: 'PREFERRED' } | { kind: 'ALL' }, facilityType?: 'CLINIC') =>
        facts.list({
          type: 'FACILITY',
          villageId: VILLAGES.a,
          scope,
          filter: { facilityType },
          page: 0,
          size: 20,
        });
      expect((await list({ kind: 'PREFERRED' })).content.map((f) => f.claimId)).toEqual([
        ids.clinic,
        ids.school,
      ]);
      expect((await list({ kind: 'ALL' })).page.totalElements).toBe(3);
      expect((await list({ kind: 'PREFERRED' }, 'CLINIC')).content.map((f) => f.claimId)).toEqual([
        ids.clinic,
      ]);
    });

    it('EconomyQueries returns the published sections only, with their products', async () => {
      const sections = await queries.sectionsFor(VILLAGES.a);
      // By English product name: Olives, Soap.
      expect(sections.products.map((p) => [p.claimId, p.product.code])).toEqual([
        [ids.aOlives, 'olives'],
        [ids.aSoap, 'soap'],
      ]);
      expect(sections.facilities.map((f) => f.claimId)).toEqual([ids.clinic, ids.school]);

      const b = await queries.sectionsFor(VILLAGES.b);
      expect(b.products.map((p) => p.claimId)).toEqual([ids.bSoap]);
      expect(b.facilities).toEqual([]);
    });
  });

  describe('CachedProductRepository', () => {
    const TTL_SECONDS = 60;

    it('serves repeated reads from memory until the TTL, and never caches misses', async () => {
      const drizzle = app.get(DrizzleProductRepository);
      const clock = new FixedClock('2026-11-24T08:00:00Z');
      let calls = 0;
      const counted: ProductRepository = {
        list: (category) => {
          calls += 1;
          return drizzle.list(category);
        },
        findById: (id) => {
          calls += 1;
          return drizzle.findById(id);
        },
        findByCode: (code) => {
          calls += 1;
          return drizzle.findByCode(code);
        },
      };
      const cached = new CachedProductRepository(counted, TTL_SECONDS, clock);

      const crops = await cached.list('CROP');
      expect(crops.every((p) => p.category === 'CROP')).toBe(true);
      expect(crops).toHaveLength(SEED_PRODUCTS.filter((p) => p.category === 'CROP').length);
      await cached.list('CROP');
      expect(calls).toBe(1);

      clock.advance(TTL_SECONDS * 1000 + 1);
      await cached.list('CROP');
      expect(calls).toBe(2);

      expect((await cached.findByCode('olives'))?.id).toBe(OLIVES.id);
      await cached.findByCode('olives');
      expect(calls).toBe(3);
      await cached.findByCode('atlantis');
      await cached.findByCode('atlantis');
      expect(calls).toBe(5);
    });
  });
});
