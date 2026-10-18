import { Injectable, Module } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Transactional } from '@nestjs-cls/transactional';
import { eq, sql } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
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
} from './support/fake-modules';
import {
  CONTAINER_STARTUP_TIMEOUT_MS,
  startTestDatabase,
  type TestDatabase,
} from './support/test-database';

/** The server's view of "which transaction am I in": backend and transaction id. */
interface TxIdentity {
  pid: number;
  txid: string;
}

/** A use case spanning two modules, the shape every real write use case has. */
@Injectable()
class TwoModuleUseCase {
  constructor(
    private readonly alpha: AlphaRepository,
    private readonly beta: BetaRepository,
  ) {}

  @Transactional()
  async writeBoth(id: number, failAfterWrites: boolean): Promise<void> {
    await this.alpha.db.insert(alphaSchema.alphaParent).values({ id, displayName: `parent ${id}` });
    await this.beta.db.insert(betaSchema.betaItem).values({ id, title: `item ${id}` });
    if (failAfterWrites) throw new Error('boom after both writes');
  }

  @Transactional()
  async writeTreeAndReadItBack(id: number) {
    await this.alpha.db.insert(alphaSchema.alphaParent).values({ id, displayName: 'tree' });
    await this.alpha.db.insert(alphaSchema.alphaChild).values([
      { id: id * 10 + 1, parentId: id, label: 'olives' },
      { id: id * 10 + 2, parentId: id, label: 'grapes' },
    ]);
    const tree = await this.alpha.db.query.alphaParent.findFirst({
      where: eq(alphaSchema.alphaParent.id, id),
      with: { children: { orderBy: (child, { asc }) => [asc(child.id)] } },
    });
    const keys = Object.keys(this.alpha.db.query).sort();
    // @ts-expect-error betaItem belongs to the beta module, also inside a transaction
    const foreign: unknown = this.alpha.db.query.betaItem;
    throw new RolledBack({ tree, keys, foreign });
  }

  @Transactional()
  async outer(): Promise<{ outer: TxIdentity; inner: TxIdentity }> {
    const outer = await this.identity();
    const inner = await this.inner();
    return { outer, inner };
  }

  @Transactional()
  async inner(): Promise<TxIdentity> {
    return this.identity();
  }

  /** Inserts a row, waits for `release`, and reports its transaction. */
  @Transactional()
  async insertAndHold(id: number, inserted: () => void, release: Promise<void>) {
    await this.beta.db.insert(betaSchema.betaItem).values({ id, title: 'held' });
    inserted();
    await release;
    return this.identity();
  }

  /** Reports whether row `id` is visible here, and this call's transaction. */
  @Transactional()
  async seesRow(id: number) {
    const rows = await this.beta.db
      .select()
      .from(betaSchema.betaItem)
      .where(eq(betaSchema.betaItem.id, id));
    return { visible: rows.length > 0, ...(await this.identity()) };
  }

  async identity(): Promise<TxIdentity> {
    const { rows } = await this.alpha.db.execute<{ pid: number; txid: string }>(
      sql`SELECT pg_backend_pid() AS pid, txid_current()::text AS txid`,
    );
    return rows[0] as TxIdentity;
  }
}

/** Carries what a transaction saw out of it, while forcing a rollback. */
class RolledBack extends Error {
  constructor(readonly seen: Record<string, unknown>) {
    super('rolled back on purpose');
  }
}

@Module({ imports: [AlphaModule, BetaModule], providers: [TwoModuleUseCase] })
class UseCaseModule {}

describe('@Transactional across modules (PostGIS via Testcontainers)', () => {
  let database: TestDatabase;
  let moduleRef: TestingModule;
  let useCase: TwoModuleUseCase;
  let pool: Pool;
  let cls: ClsService;

  /** Runs `fn` in its own request context, the way the CLS middleware does per request. */
  const asRequest = <T>(fn: () => Promise<T>): Promise<T> => cls.run(fn);

  const count = async (table: 'alpha_parent' | 'beta_item', id: number): Promise<number> => {
    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ${table} WHERE id = $1`,
      [id],
    );
    return rows[0]?.n ?? 0;
  };

  beforeAll(async () => {
    database = await startTestDatabase();
    await createFakeModuleTables(database.ownerUrl);
    process.env.DATABASE_URL = database.appUrl;
    moduleRef = await Test.createTestingModule({
      imports: [createAppConfigModule(), RequestContextModule, DatabaseModule, UseCaseModule],
    }).compile();
    await moduleRef.init();
    useCase = moduleRef.get(TwoModuleUseCase);
    pool = moduleRef.get<Pool>(PG_POOL);
    cls = moduleRef.get(ClsService);
  }, CONTAINER_STARTUP_TIMEOUT_MS);

  afterAll(async () => {
    await moduleRef?.close();
    await database?.stop();
  });

  it('commits the writes of two modules together', async () => {
    await asRequest(() => useCase.writeBoth(1, false));
    expect(await count('alpha_parent', 1)).toBe(1);
    expect(await count('beta_item', 1)).toBe(1);
  });

  it('rolls back the writes of both modules when the use case throws', async () => {
    await expect(asRequest(() => useCase.writeBoth(2, true))).rejects.toThrow('boom');
    expect(await count('alpha_parent', 2)).toBe(0);
    expect(await count('beta_item', 2)).toBe(0);
  });

  it('runs relational queries on the module’s own schema inside the transaction', async () => {
    const error = await asRequest(() => useCase.writeTreeAndReadItBack(3)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RolledBack);
    const { seen } = error as RolledBack;
    expect(seen.tree).toEqual({
      id: 3,
      displayName: 'tree',
      children: [
        { id: 31, parentId: 3, label: 'olives' },
        { id: 32, parentId: 3, label: 'grapes' },
      ],
    });
    // Another module's tables stay invisible inside the shared transaction.
    expect(seen.keys).toEqual(['alphaChild', 'alphaParent']);
    expect(seen.foreign).toBeUndefined();
    expect(await count('alpha_parent', 3)).toBe(0);
  });

  it('lets a nested @Transactional() join the outer transaction (one BEGIN)', async () => {
    const connect = jest.spyOn(pool, 'connect');
    try {
      const { outer, inner } = await asRequest(() => useCase.outer());
      expect(inner).toEqual(outer);
      // One transaction checks out exactly one client.
      expect(connect).toHaveBeenCalledTimes(1);
    } finally {
      connect.mockRestore();
    }
  });

  it('returns the client to the pool after a rollback (no leak)', async () => {
    await asRequest(() => useCase.writeBoth(4, false)); // warm the pool
    const idleBefore = pool.idleCount;
    for (let i = 0; i < 5; i += 1) {
      await expect(asRequest(() => useCase.writeBoth(100 + i, true))).rejects.toThrow();
    }
    expect(pool.idleCount).toBe(idleBefore);
    expect(pool.totalCount - pool.idleCount).toBe(0);
    expect(pool.waitingCount).toBe(0);
  });

  it('never shares a transaction between concurrent requests', async () => {
    let markInserted!: () => void;
    const inserted = new Promise<void>((resolve) => (markInserted = resolve));
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));

    const first = asRequest(() => useCase.insertAndHold(500, markInserted, released));
    await inserted;
    // Request two runs while request one still holds its uncommitted row.
    const second = await asRequest(() => useCase.seesRow(500));
    release();
    const firstTx = await first;

    expect(second.visible).toBe(false);
    expect(second.pid).not.toBe(firstTx.pid);
    expect(second.txid).not.toBe(firstTx.txid);
    expect(await count('beta_item', 500)).toBe(1);
  });

  it('runs queries outside @Transactional() on the pool, one statement each', async () => {
    const first = await asRequest(() => useCase.identity());
    const second = await asRequest(() => useCase.identity());
    expect(second.txid).not.toBe(first.txid);
  });
});
