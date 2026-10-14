import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { integer, pgTable, text } from 'drizzle-orm/pg-core';
import { Client, Pool } from 'pg';
import type { ModuleDb } from '../src/platform/database/database';
import {
  CONTAINER_STARTUP_TIMEOUT_MS,
  startTestDatabase,
  type TestDatabase,
} from './support/test-database';

// A sample of the queries the village search (#30) and nearby villages (#34)
// will run: PostGIS distance search and pg_trgm fuzzy name search, each backed
// by its index, written with Drizzle's sql template as docs/database.md asks.
// The location column has no Drizzle type yet, so it is used through sql only.
const place = pgTable('sample_place', {
  id: integer().primaryKey(),
  name: text().notNull(),
});

const BEIT_FURIK = { lon: 35.336, lat: 32.177 };

describe('PostGIS and pg_trgm (sample)', () => {
  let database: TestDatabase;
  let pool: Pool;
  let db: ModuleDb<Record<string, never>>;

  beforeAll(async () => {
    database = await startTestDatabase();

    // Created by the owner, the way a migration would create it.
    const owner = new Client({ connectionString: database.ownerUrl });
    await owner.connect();
    await owner.query(`
      CREATE TABLE sample_place (
        id integer PRIMARY KEY,
        name text NOT NULL,
        location geography(Point, 4326) NOT NULL
      );
      CREATE INDEX sample_place_location_gist ON sample_place USING gist (location);
      CREATE INDEX sample_place_name_trgm ON sample_place USING gin (name gin_trgm_ops);
      INSERT INTO sample_place VALUES
        (1, 'بيت فوريك', 'SRID=4326;POINT(35.336 32.177)'),
        (2, 'نابلس',     'SRID=4326;POINT(35.262 32.222)'),
        (3, 'جنين',      'SRID=4326;POINT(35.300 32.460)');
      ANALYZE sample_place;
    `);
    await owner.end();

    pool = new Pool({ connectionString: database.appUrl, max: 1 });
    db = drizzle({ client: pool, casing: 'snake_case' });
  }, CONTAINER_STARTUP_TIMEOUT_MS);

  afterAll(async () => {
    await pool?.end();
    await database?.stop();
  });

  const near = (meters: number) =>
    sql`ST_DWithin(location, ST_MakePoint(${BEIT_FURIK.lon}, ${BEIT_FURIK.lat})::geography, ${meters})`;
  const similarTo = (term: string) => sql`${place.name} % ${term}`;

  it('finds places within a distance, nearest first', async () => {
    const rows = await db
      .select({ name: place.name })
      .from(place)
      .where(near(10_000))
      .orderBy(sql`location <-> ST_MakePoint(${BEIT_FURIK.lon}, ${BEIT_FURIK.lat})::geography`);

    expect(rows.map((r) => r.name)).toEqual(['بيت فوريك', 'نابلس']);
  });

  it('finds a name despite a spelling variant', async () => {
    const rows = await db
      .select({ name: place.name })
      .from(place)
      .where(similarTo('بيت فوريق'))
      .orderBy(sql`similarity(${place.name}, ${'بيت فوريق'}) DESC`);

    expect(rows.map((r) => r.name)).toEqual(['بيت فوريك']);
  });

  it('serves both searches from their indexes', async () => {
    // With three rows a sequential scan is cheapest, and with more rows the
    // planner's choice depends on statistics. Disabling sequential scans makes
    // the question independent of the data size: *can* these predicates use
    // their index? SET LOCAL ends with the transaction, so the setting never
    // leaks to the pooled connection, even if an assertion fails.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL enable_seqscan = off');
      const plan = async (where: ReturnType<typeof sql>) => {
        const query = db.select().from(place).where(where).toSQL();
        const { rows } = await client.query<{ 'QUERY PLAN': string }>(
          `EXPLAIN ${query.sql}`,
          query.params,
        );
        return rows.map((r) => r['QUERY PLAN']).join('\n');
      };

      expect(await plan(near(10_000))).toContain('sample_place_location_gist');
      expect(await plan(similarTo('بيت فوريق'))).toContain('sample_place_name_trgm');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
