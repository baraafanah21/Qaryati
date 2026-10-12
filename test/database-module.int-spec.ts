import { Test, type TestingModule } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import { integer, pgTable, text } from 'drizzle-orm/pg-core';
import { Client } from 'pg';
import { createAppConfigModule } from '../src/config/app-config.module';
import { DRIZZLE, type Database } from '../src/platform/database/database';
import { DatabaseModule } from '../src/platform/database/database.module';
import {
  CONTAINER_STARTUP_TIMEOUT_MS,
  startTestDatabase,
  type TestDatabase,
} from './support/test-database';

// Declared like a module's schema.ts would, to check casing: camelCase in
// TypeScript, snake_case in the database.
const probe = pgTable('probe_item', {
  id: integer().primaryKey(),
  displayName: text().notNull(),
});

describe('DatabaseModule (PostGIS via Testcontainers)', () => {
  let database: TestDatabase;
  let moduleRef: TestingModule;
  let db: Database;

  beforeAll(async () => {
    database = await startTestDatabase();
    const owner = new Client({ connectionString: database.ownerUrl });
    await owner.connect();
    await owner.query(
      'CREATE TABLE probe_item (id integer PRIMARY KEY, display_name text NOT NULL)',
    );
    await owner.end();

    process.env.DATABASE_URL = database.appUrl;
    moduleRef = await Test.createTestingModule({
      imports: [createAppConfigModule(), DatabaseModule],
    }).compile();
    await moduleRef.init();
    db = moduleRef.get<Database>(DRIZZLE);
  }, CONTAINER_STARTUP_TIMEOUT_MS);

  afterAll(async () => {
    await moduleRef?.close();
    await database?.stop();
  });

  it('connects as the runtime role qaryati_app', async () => {
    const { rows } = await db.execute<{ role: string }>(sql`SELECT current_user AS role`);
    expect(rows).toEqual([{ role: 'qaryati_app' }]);
  });

  it('maps camelCase properties to snake_case columns', async () => {
    await db.insert(probe).values({ id: 1, displayName: 'Beit Furik' });
    const rows = await db.select().from(probe);
    expect(rows).toEqual([{ id: 1, displayName: 'Beit Furik' }]);
  });
});
