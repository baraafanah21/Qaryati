import { Client } from 'pg';
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
    await owner.query(`INSERT INTO admin_unit (id, code, parent_id, unit_type, authority_type, era, name_ar)
      VALUES ('00000000-0000-7000-8000-000000000011', 'nablus', NULL, 'GOVERNORATE', NULL, 'CURRENT', 'نابلس')`);
    await expect(
      owner.query(`INSERT INTO admin_unit (id, code, parent_id, unit_type, authority_type, era, name_ar)
      VALUES ('00000000-0000-7000-8000-000000000012', 'nablus', NULL, 'GOVERNORATE', NULL, 'CURRENT', 'نابلس ثانية')`),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('rejects a NULL display_name_ar', async () => {
    await expect(insertVillage('missing-ar-name', null)).rejects.toMatchObject({ code: '23502' });
  });

  it('rejects an admin unit with a missing parent', async () => {
    await expect(
      owner.query(`INSERT INTO admin_unit (id, code, parent_id, unit_type, authority_type, era, name_ar)
      VALUES ('00000000-0000-7000-8000-000000000013', 'orphan-unit', '00000000-0000-7000-8000-000000000099', 'GOVERNORATE', NULL, 'CURRENT', 'يتيم')`),
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

  it('temporarily detects a broken unique index constraint and restores it', async () => {
    await owner.query('DROP INDEX village_slug_key');
    try {
      await insertVillage('broken-constraint-check');
      await insertVillage('broken-constraint-check');
      await owner.query("DELETE FROM village WHERE slug = 'broken-constraint-check' AND id <> $1", [
        (
          await owner.query<{ id: string }>(
            "SELECT id FROM village WHERE slug = 'broken-constraint-check' ORDER BY id LIMIT 1",
          )
        ).rows[0]?.id,
      ]);
    } finally {
      await owner.query('CREATE UNIQUE INDEX village_slug_key ON village USING btree (slug)');
    }
    await expect(insertVillage('broken-constraint-check')).rejects.toMatchObject({ code: '23505' });
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
