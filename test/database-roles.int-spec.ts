import { Client, DatabaseError } from 'pg';
import { runMigrations } from '../src/platform/database/migrate';
import {
  CONTAINER_STARTUP_TIMEOUT_MS,
  startTestDatabase,
  type TestDatabase,
} from './support/test-database';

const INSUFFICIENT_PRIVILEGE = '42501';

async function connect(url: string): Promise<Client> {
  const client = new Client({ connectionString: url });
  await client.connect();
  return client;
}

/** Runs `sql` and returns the SQLSTATE it failed with, or undefined if it succeeded. */
async function sqlState(client: Client, sql: string): Promise<string | undefined> {
  try {
    await client.query(sql);
    return undefined;
  } catch (error) {
    if (error instanceof DatabaseError) return error.code;
    throw error;
  }
}

describe('database baseline (PostGIS via Testcontainers)', () => {
  let db: TestDatabase;
  let owner: Client;
  let app: Client;

  beforeAll(async () => {
    db = await startTestDatabase();
    owner = await connect(db.ownerUrl);
    app = await connect(db.appUrl);
    // A table created the way a migration creates it: by the owner.
    await owner.query('CREATE TABLE probe (id serial PRIMARY KEY, name text NOT NULL)');
  }, CONTAINER_STARTUP_TIMEOUT_MS);

  afterAll(async () => {
    await app?.end();
    await owner?.end();
    await db?.stop();
  });

  describe('baseline migration', () => {
    it('enables postgis, pg_trgm and citext', async () => {
      const { rows } = await owner.query<{ extname: string }>(
        "SELECT extname FROM pg_extension WHERE extname IN ('postgis', 'pg_trgm', 'citext')",
      );
      expect(rows.map((r) => r.extname).sort()).toEqual(['citext', 'pg_trgm', 'postgis']);
    });

    it('makes the extensions usable by the runtime role', async () => {
      const { rows } = await app.query<{ distance: number; similar: boolean; equal: boolean }>(
        `SELECT ST_Distance('SRID=4326;POINT(35.2 31.9)'::geography,
                            'SRID=4326;POINT(35.3 32.0)'::geography) AS distance,
                similarity('بيت فوريك', 'بيت فوريق') > 0.3 AS similar,
                'Name@Example.org'::citext = 'name@example.org' AS equal`,
      );
      expect(rows[0]?.distance).toBeGreaterThan(10_000);
      expect(rows[0]?.similar).toBe(true);
      expect(rows[0]?.equal).toBe(true);
    });

    it('can run again without changes', async () => {
      await expect(runMigrations(db.ownerUrl)).resolves.toBeUndefined();
    });
  });

  describe('runtime role qaryati_app', () => {
    it('connects as qaryati_app without elevated attributes', async () => {
      const { rows } = await app.query<Record<string, unknown>>(
        `SELECT current_user, rolsuper, rolcreatedb, rolcreaterole, rolbypassrls
           FROM pg_roles WHERE rolname = current_user`,
      );
      expect(rows[0]).toEqual({
        current_user: 'qaryati_app',
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolbypassrls: false,
      });
    });

    it('cannot create tables, schemas or extensions', async () => {
      expect(await sqlState(app, 'CREATE TABLE intruder (id int)')).toBe(INSUFFICIENT_PRIVILEGE);
      expect(await sqlState(app, 'CREATE SCHEMA intruder')).toBe(INSUFFICIENT_PRIVILEGE);
      expect(await sqlState(app, 'CREATE TEMP TABLE intruder (id int)')).toBe(
        INSUFFICIENT_PRIVILEGE,
      );
      expect(await sqlState(app, 'CREATE EXTENSION hstore')).toBe(INSUFFICIENT_PRIVILEGE);
    });

    it('cannot alter, drop or truncate tables created by migrations', async () => {
      expect(await sqlState(app, 'ALTER TABLE probe ADD COLUMN x int')).toBe(
        INSUFFICIENT_PRIVILEGE,
      );
      expect(await sqlState(app, 'DROP TABLE probe')).toBe(INSUFFICIENT_PRIVILEGE);
      expect(await sqlState(app, 'TRUNCATE probe')).toBe(INSUFFICIENT_PRIVILEGE);
    });

    it('can read and write rows in tables created by migrations', async () => {
      await app.query("INSERT INTO probe (name) VALUES ('a')");
      await app.query("UPDATE probe SET name = 'b'");
      const { rows } = await app.query<{ name: string }>('SELECT name FROM probe');
      expect(rows).toEqual([{ name: 'b' }]);
      await app.query('DELETE FROM probe');
    });
  });
});
