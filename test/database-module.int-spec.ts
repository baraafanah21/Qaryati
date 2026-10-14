import { Injectable, Module } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { relations, sql } from 'drizzle-orm';
import { integer, pgTable, text } from 'drizzle-orm/pg-core';
import { Client, type Pool } from 'pg';
import { createAppConfigModule } from '../src/config/app-config.module';
import { InjectModuleDb, PG_POOL, type ModuleDb } from '../src/platform/database/database';
import { DatabaseModule } from '../src/platform/database/database.module';
import {
  CONTAINER_STARTUP_TIMEOUT_MS,
  startTestDatabase,
  type TestDatabase,
} from './support/test-database';

// Two fake modules, each with its own schema.ts, declared the way a real
// module would: camelCase properties, snake_case columns, relations.
const alphaSchema = (() => {
  const alphaParent = pgTable('alpha_parent', {
    id: integer().primaryKey(),
    displayName: text().notNull(),
  });
  const alphaChild = pgTable('alpha_child', {
    id: integer().primaryKey(),
    parentId: integer().notNull(),
    label: text().notNull(),
  });
  const alphaParentRelations = relations(alphaParent, ({ many }) => ({
    children: many(alphaChild),
  }));
  const alphaChildRelations = relations(alphaChild, ({ one }) => ({
    parent: one(alphaParent, { fields: [alphaChild.parentId], references: [alphaParent.id] }),
  }));
  return { alphaParent, alphaChild, alphaParentRelations, alphaChildRelations };
})();

const betaSchema = {
  betaItem: pgTable('beta_item', { id: integer().primaryKey(), title: text().notNull() }),
};

type AlphaDb = ModuleDb<typeof alphaSchema>;
type BetaDb = ModuleDb<typeof betaSchema>;

@Injectable()
class AlphaRepository {
  constructor(@InjectModuleDb() readonly db: AlphaDb) {}
}

@Module({ imports: [DatabaseModule.forFeature(alphaSchema)], providers: [AlphaRepository] })
class AlphaModule {}

@Injectable()
class BetaRepository {
  constructor(@InjectModuleDb() readonly db: BetaDb) {}
}

@Module({ imports: [DatabaseModule.forFeature(betaSchema)], providers: [BetaRepository] })
class BetaModule {}

describe('DatabaseModule (PostGIS via Testcontainers)', () => {
  let database: TestDatabase;
  let moduleRef: TestingModule;
  let alpha: AlphaDb;
  let beta: BetaDb;

  beforeAll(async () => {
    database = await startTestDatabase();
    // Created by the owner, the way a migration would create them.
    const owner = new Client({ connectionString: database.ownerUrl });
    await owner.connect();
    await owner.query(`
      CREATE TABLE alpha_parent (id integer PRIMARY KEY, display_name text NOT NULL);
      CREATE TABLE alpha_child (id integer PRIMARY KEY, parent_id integer NOT NULL REFERENCES alpha_parent, label text NOT NULL);
      CREATE TABLE beta_item (id integer PRIMARY KEY, title text NOT NULL);
    `);
    await owner.end();

    process.env.DATABASE_URL = database.appUrl;
    moduleRef = await Test.createTestingModule({
      imports: [createAppConfigModule(), DatabaseModule, AlphaModule, BetaModule],
    }).compile();
    await moduleRef.init();
    alpha = moduleRef.get(AlphaRepository).db;
    beta = moduleRef.get(BetaRepository).db;
  }, CONTAINER_STARTUP_TIMEOUT_MS);

  afterAll(async () => {
    await moduleRef?.close();
    await database?.stop();
  });

  it('connects as the runtime role qaryati_app', async () => {
    const { rows } = await alpha.execute<{ role: string }>(sql`SELECT current_user AS role`);
    expect(rows).toEqual([{ role: 'qaryati_app' }]);
  });

  it('maps camelCase properties to snake_case columns', async () => {
    await alpha.insert(alphaSchema.alphaParent).values({ id: 1, displayName: 'Beit Furik' });
    const rows = await alpha.select().from(alphaSchema.alphaParent);
    expect(rows).toEqual([{ id: 1, displayName: 'Beit Furik' }]);
  });

  it('runs relational queries on the module’s own tables', async () => {
    await alpha.insert(alphaSchema.alphaChild).values([
      { id: 10, parentId: 1, label: 'olives' },
      { id: 11, parentId: 1, label: 'grapes' },
    ]);
    const parents = await alpha.query.alphaParent.findMany({
      with: { children: { orderBy: (child, { asc }) => [asc(child.id)] } },
    });
    expect(parents).toEqual([
      {
        id: 1,
        displayName: 'Beit Furik',
        children: [
          { id: 10, parentId: 1, label: 'olives' },
          { id: 11, parentId: 1, label: 'grapes' },
        ],
      },
    ]);
  });

  it('gives each module only its own tables on db.query', async () => {
    expect(Object.keys(alpha.query).sort()).toEqual(['alphaChild', 'alphaParent']);
    expect(Object.keys(beta.query)).toEqual(['betaItem']);

    // The compiler rejects the other module's tables as well.
    // @ts-expect-error betaItem belongs to the beta module
    expect(alpha.query.betaItem).toBeUndefined();
    // @ts-expect-error alphaParent belongs to the alpha module
    expect(beta.query.alphaParent).toBeUndefined();

    await beta.insert(betaSchema.betaItem).values({ id: 1, title: 'mill' });
    await expect(beta.query.betaItem.findMany()).resolves.toEqual([{ id: 1, title: 'mill' }]);
  });

  it('builds every module instance on the one shared pool', () => {
    const pool = moduleRef.get<Pool>(PG_POOL);
    expect(alpha).not.toBe(beta);
    // drizzle() keeps its client on $client; ModuleDb hides it from modules.
    const clientOf = (db: object) => (db as { $client: Pool }).$client;
    const clients = new Set([clientOf(alpha), clientOf(beta)]);
    expect(clients.size).toBe(1);
    expect(clientOf(alpha)).toBe(pool);
  });
});
