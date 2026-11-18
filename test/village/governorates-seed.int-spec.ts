import { Module } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { createAppConfigModule } from '../../src/config/app-config.module';
import { CachedAdminUnitRepository } from '../../src/modules/village/infrastructure/cached-admin-unit.repository';
import { DrizzleAdminUnitRepository } from '../../src/modules/village/infrastructure/drizzle-admin-unit.repository';
import * as schema from '../../src/modules/village/infrastructure/persistence/schema';
import { CURRENT_GOVERNORATES } from '../../src/modules/village/infrastructure/seed/governorates';
import { RequestContextModule } from '../../src/platform/context/request-context.module';
import { DatabaseModule } from '../../src/platform/database/database.module';
import { asId, FixedClock } from '../../src/shared/kernel';
import {
  CONTAINER_STARTUP_TIMEOUT_MS,
  startTestDatabase,
  type TestDatabase,
} from '../support/test-database';

const SEED_SQL = resolve(__dirname, '../../migrations/0013_seed_current_governorates.sql');

@Module({
  imports: [DatabaseModule.forFeature(schema)],
  providers: [DrizzleAdminUnitRepository],
})
class RepositoryModule {}

interface AdminUnitRow {
  id: string;
  code: string;
  parent_id: string | null;
  unit_type: string;
  authority_type: string | null;
  era: string;
  name_ar: string;
  name_en: string | null;
}

describe('current governorates seed and the admin-unit cache (integration)', () => {
  let database: TestDatabase;
  let owner: Client;
  let moduleRef: TestingModule;
  let drizzle: DrizzleAdminUnitRepository;

  const governorates = async (): Promise<AdminUnitRow[]> =>
    (
      await owner.query<AdminUnitRow>(
        `SELECT id, code, parent_id, unit_type, authority_type, era, name_ar, name_en
         FROM admin_unit WHERE unit_type = 'GOVERNORATE' AND era = 'CURRENT' ORDER BY code`,
      )
    ).rows;

  beforeAll(async () => {
    database = await startTestDatabase();
    owner = new Client({ connectionString: database.ownerUrl });
    await owner.connect();
    process.env.DATABASE_URL = database.appUrl;
    moduleRef = await Test.createTestingModule({
      imports: [createAppConfigModule(), RequestContextModule, DatabaseModule, RepositoryModule],
    }).compile();
    await moduleRef.init();
    drizzle = moduleRef.get(DrizzleAdminUnitRepository);
  }, CONTAINER_STARTUP_TIMEOUT_MS);

  afterAll(async () => {
    await moduleRef?.close();
    await owner?.end();
    await database?.stop();
  });

  it('the migrated database holds exactly the governorates of seed/governorates.ts', async () => {
    const expected = CURRENT_GOVERNORATES.map((g) => ({
      id: g.id,
      code: g.code,
      parent_id: null,
      unit_type: 'GOVERNORATE',
      authority_type: null,
      era: 'CURRENT',
      name_ar: g.nameAr,
      name_en: g.nameEn,
    })).sort((a, b) => a.code.localeCompare(b.code));
    expect(CURRENT_GOVERNORATES).toHaveLength(16);
    expect(await governorates()).toEqual(expected);
  });

  it('running the seed SQL again changes nothing, even over an edited row', async () => {
    await owner.query(`UPDATE admin_unit SET name_en = 'Edited' WHERE code = 'jenin'`);
    const before = await governorates();

    await owner.query(await readFile(SEED_SQL, 'utf8'));

    expect(await governorates()).toEqual(before);
    await owner.query(`UPDATE admin_unit SET name_en = 'Jenin' WHERE code = 'jenin'`);
  });

  describe('CachedAdminUnitRepository', () => {
    const TTL_SECONDS = 60;
    let clock: FixedClock;
    let cached: CachedAdminUnitRepository;
    let listCalls: number;
    let findCalls: number;

    beforeEach(() => {
      clock = new FixedClock('2026-11-18T08:00:00Z');
      listCalls = 0;
      findCalls = 0;
      // The real Drizzle repository, counted, behind the cache.
      cached = new CachedAdminUnitRepository(
        {
          list: (filter) => {
            listCalls += 1;
            return drizzle.list(filter);
          },
          findById: (id) => {
            findCalls += 1;
            return drizzle.findById(id);
          },
          findByCode: (code) => drizzle.findByCode(code),
        },
        TTL_SECONDS,
        clock,
      );
    });

    it('serves a repeated list from memory and sorts by Arabic name', async () => {
      const first = await cached.list({ type: 'GOVERNORATE' });
      const second = await cached.list({ type: 'GOVERNORATE' });

      expect(listCalls).toBe(1);
      expect(second).toEqual(first);
      expect(first.map((u) => u.nameAr)).toEqual(
        [...first.map((u) => u.nameAr)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
      );
      // Another filter is another entry.
      await cached.list({ type: 'LOCAL_AUTHORITY' });
      expect(listCalls).toBe(2);
    });

    it('reloads after the TTL, using the injected clock (no sleep)', async () => {
      await cached.list({});
      clock.advance(TTL_SECONDS * 1000 - 1);
      await cached.list({});
      expect(listCalls).toBe(1);

      clock.advance(2);
      await cached.list({});
      expect(listCalls).toBe(2);
    });

    it('caches hits by id but not misses', async () => {
      const nablus = CURRENT_GOVERNORATES.find((g) => g.code === 'nablus')!;
      await cached.findById(asId<'AdminUnit'>(nablus.id));
      await cached.findById(asId<'AdminUnit'>(nablus.id));
      expect(findCalls).toBe(1);

      const missing = asId<'AdminUnit'>('00000000-0000-7000-8000-0000000000ff');
      await cached.findById(missing);
      await cached.findById(missing);
      expect(findCalls).toBe(3);
    });
  });
});
