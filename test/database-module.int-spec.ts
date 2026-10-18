import { Test, type TestingModule } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { createAppConfigModule } from '../src/config/app-config.module';
import { RequestContextModule } from '../src/platform/context/request-context.module';
import { PG_POOL } from '../src/platform/database/database';
import { DatabaseModule } from '../src/platform/database/database.module';
import {
  AlphaModule,
  AlphaRepository,
  alphaSchema,
  BetaModule,
  BetaRepository,
  betaSchema,
  createFakeModuleTables,
  type AlphaDb,
  type BetaDb,
} from './support/fake-modules';
import {
  CONTAINER_STARTUP_TIMEOUT_MS,
  startTestDatabase,
  type TestDatabase,
} from './support/test-database';

describe('DatabaseModule (PostGIS via Testcontainers)', () => {
  let database: TestDatabase;
  let moduleRef: TestingModule;
  let alpha: AlphaDb;
  let beta: BetaDb;

  beforeAll(async () => {
    database = await startTestDatabase();
    await createFakeModuleTables(database.ownerUrl);

    process.env.DATABASE_URL = database.appUrl;
    moduleRef = await Test.createTestingModule({
      imports: [
        createAppConfigModule(),
        RequestContextModule,
        DatabaseModule,
        AlphaModule,
        BetaModule,
      ],
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

  it('runs every module handle on the one shared pool', async () => {
    const pool = moduleRef.get<Pool>(PG_POOL);
    expect(alpha).not.toBe(beta);
    // Outside a transaction both handles send their queries to the pool itself.
    const query = jest.spyOn(pool, 'query');
    try {
      await alpha.select().from(alphaSchema.alphaParent);
      await beta.select().from(betaSchema.betaItem);
      expect(query).toHaveBeenCalledTimes(2);
    } finally {
      query.mockRestore();
    }
  });

  it('refuses db.transaction(): transactions belong to use cases', () => {
    const db = alpha as unknown as { transaction: () => unknown };
    expect(() => db.transaction()).toThrow(/@Transactional\(\)/);
  });
});
