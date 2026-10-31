import { drizzle } from 'drizzle-orm/node-postgres';
import { Client, Pool } from 'pg';
import { village } from '../src/modules/village/infrastructure/persistence/schema';
import { updateWithVersion } from '../src/platform/database/versioning';
import { FixedClock, PreconditionFailedError } from '../src/shared/kernel';
import {
  CONTAINER_STARTUP_TIMEOUT_MS,
  startTestDatabase,
  type TestDatabase,
} from './support/test-database';

jest.setTimeout(CONTAINER_STARTUP_TIMEOUT_MS);

describe('village and admin_unit tables (integration)', () => {
  let database: TestDatabase;
  let owner: Client;
  let app: Client;
  let villageCounter = 0;

  beforeAll(async () => {
    database = await startTestDatabase();
    owner = new Client({ connectionString: database.ownerUrl });
    app = new Client({ connectionString: database.appUrl });
    await owner.connect();
    await app.connect();
    await owner.query(`
      INSERT INTO user_account (id, email, password_hash, role, status, version, created_at, updated_at)
      VALUES ('00000000-0000-7000-8000-000000000001', 'village-owner@test.local', 'hash', 'CONTRIBUTOR', 'ACTIVE', 1, now(), now())
    `);
  });

  afterAll(async () => {
    await app.end();
    await owner.end();
    await database.stop();
  });

  const insertVillage = (slug: string, displayNameAr: string | null = 'بيت فوريك') => {
    villageCounter += 1;
    const id = `00000000-0000-7000-8000-${villageCounter.toString().padStart(12, '0')}`;
    return owner.query(
      `INSERT INTO village
        (id, slug, settlement_status, publication_status, display_name_ar, display_name_en, location, created_by, version, created_at, updated_at)
       VALUES ($1, $2, 'INHABITED', 'DRAFT', $3, 'Beit Furik', NULL, '00000000-0000-7000-8000-000000000001', 1, now(), now())`,
      [id, slug, displayNameAr],
    );
  };

  it('rejects a duplicate village slug', async () => {
    await insertVillage('beit-furik');
    await expect(insertVillage('beit-furik')).rejects.toMatchObject({ code: '23505' });
  });

  it('rejects a duplicate admin unit code', async () => {
    await owner.query(`INSERT INTO admin_unit (id, code, parent_id, unit_type, authority_type, era, name_ar, created_at, updated_at)
      VALUES ('00000000-0000-7000-8000-000000000011', 'nablus', NULL, 'GOVERNORATE', NULL, 'CURRENT', 'نابلس', now(), now())`);
    await expect(
      owner.query(`INSERT INTO admin_unit (id, code, parent_id, unit_type, authority_type, era, name_ar, created_at, updated_at)
      VALUES ('00000000-0000-7000-8000-000000000012', 'nablus', NULL, 'GOVERNORATE', NULL, 'CURRENT', 'نابلس ثانية', now(), now())`),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('rejects a NULL display_name_ar', async () => {
    await expect(insertVillage('missing-ar-name', null)).rejects.toMatchObject({ code: '23502' });
  });

  it('rejects an admin unit with a missing parent', async () => {
    await expect(
      owner.query(`INSERT INTO admin_unit (id, code, parent_id, unit_type, authority_type, era, name_ar, created_at, updated_at)
      VALUES ('00000000-0000-7000-8000-000000000013', 'orphan-unit', '00000000-0000-7000-8000-000000000099', 'GOVERNORATE', NULL, 'CURRENT', 'يتيم', now(), now())`),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('rejects an unknown created_by user', async () => {
    villageCounter += 1;
    const id = `00000000-0000-7000-8000-${villageCounter.toString().padStart(12, '0')}`;
    await expect(
      owner.query(
        `INSERT INTO village
          (id, slug, settlement_status, publication_status, display_name_ar, location, created_by, version, created_at, updated_at)
         VALUES ($1, 'unknown-owner', 'INHABITED', 'DRAFT', 'قرية', NULL,
                 '00000000-0000-7000-8000-000000000099', 1, now(), now())`,
        [id],
      ),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('allows runtime DML on village and forbids alteration', async () => {
    villageCounter += 1;
    const id = `00000000-0000-7000-8000-${villageCounter.toString().padStart(12, '0')}`;
    await app.query(
      `INSERT INTO village
        (id, slug, settlement_status, publication_status, display_name_ar, display_name_en, location, created_by, version, created_at, updated_at)
       VALUES ($1, 'runtime-village', 'INHABITED', 'DRAFT', 'قرية تشغيلية', 'Runtime Village', NULL,
               '00000000-0000-7000-8000-000000000001', 1, now(), now())`,
      [id],
    );
    await app.query(
      "UPDATE village SET display_name_en = 'Updated Runtime Village' WHERE slug = 'runtime-village'",
    );
    await expect(
      app.query('ALTER TABLE village ADD COLUMN forbidden_test boolean'),
    ).rejects.toMatchObject({
      code: '42501',
    });
  });

  it('enforces the migrated unique indexes village_slug_key and admin_unit_code_key', async () => {
    // Both indexes come from the migrations; the test only reads them and never recreates one.
    await insertVillage('migrated-unique-slug');
    await expect(insertVillage('migrated-unique-slug')).rejects.toMatchObject({
      code: '23505',
      constraint: 'village_slug_key',
    });
    const insertUnit = (id: string) =>
      owner.query(
        `INSERT INTO admin_unit (id, code, parent_id, unit_type, authority_type, era, name_ar, created_at, updated_at)
        VALUES ($1, 'migrated-unique-code', NULL, 'GOVERNORATE', NULL, 'CURRENT', 'رمز', now(), now())`,
        [id],
      );
    await insertUnit('00000000-0000-7000-8000-000000000021');
    await expect(insertUnit('00000000-0000-7000-8000-000000000022')).rejects.toMatchObject({
      code: '23505',
      constraint: 'admin_unit_code_key',
    });
  });

  it('updates a village with updateWithVersion: the right version wins, a stale one is 412', async () => {
    await insertVillage('versioned-village');
    const { rows } = await owner.query<{ id: string }>(
      "SELECT id FROM village WHERE slug = 'versioned-village'",
    );
    const id = rows[0]!.id;
    const pool = new Pool({ connectionString: database.appUrl });
    try {
      const clock = new FixedClock('2026-10-31T10:00:00Z');
      const ctx = { db: drizzle({ client: pool, casing: 'snake_case' }), clock };
      const updated = await updateWithVersion(ctx, village, id, 1, {
        publicationStatus: 'ARCHIVED',
      });
      expect(updated).toMatchObject({
        publicationStatus: 'ARCHIVED',
        version: 2,
        updatedAt: clock.now(),
      });
      await expect(
        updateWithVersion(ctx, village, id, 1, { publicationStatus: 'PUBLISHED' }),
      ).rejects.toBeInstanceOf(PreconditionFailedError);
      const stored = await owner.query(
        'SELECT publication_status, version FROM village WHERE id = $1',
        [id],
      );
      expect(stored.rows).toEqual([{ publication_status: 'ARCHIVED', version: 2 }]);
    } finally {
      await pool.end();
    }
  });

  it('uses the GiST index for nearby geography queries', async () => {
    await insertVillage('location-village');
    await owner.query(
      `UPDATE village SET location = ST_GeogFromText('SRID=4326;POINT(35.2 31.9)') WHERE slug = 'location-village'`,
    );
    await owner.query('BEGIN');
    await owner.query('SET LOCAL enable_seqscan = off');
    const plan = await owner.query(`EXPLAIN
      SELECT id FROM village
      WHERE ST_DWithin(location, ST_GeogFromText('SRID=4326;POINT(35.2 31.9)'), 1000)`);
    await owner.query('ROLLBACK');
    expect(plan.rows.map((row: { 'QUERY PLAN': string }) => row['QUERY PLAN']).join(' ')).toMatch(
      /gist/i,
    );
  });
});
