import { Logger } from '@nestjs/common';
import type { TransactionalAdapter, TransactionalAdapterOptions } from '@nestjs-cls/transactional';
import type { Pool, PoolClient } from 'pg';
import { PG_POOL } from './database';

const logger = new Logger('Transaction');

/** A callback registered to run once the transaction has committed. */
export type AfterCommitCallback = () => Promise<void> | void;

/**
 * What the transaction host holds: the client every module's queries run on.
 *
 * - Inside `@Transactional()`: the one pool client the transaction checked
 *   out, plus the queue of callbacks to run after `COMMIT`.
 * - Outside: the pool itself, and no queue.
 */
export interface DbConnection {
  readonly client: Pool | PoolClient;
  /** Present only inside a transaction. Domain events wait here for the commit. */
  readonly afterCommit?: AfterCommitCallback[];
}

/** No options yet: every transaction is READ COMMITTED, PostgreSQL's default. */
export type PgTransactionOptions = Record<string, never>;

/**
 * Runs `fn` in one PostgreSQL transaction on a client checked out of `pool`.
 *
 * `BEGIN` before, `COMMIT` when `fn` resolves, `ROLLBACK` when it (or the
 * commit) throws; the client always goes back to the pool. If the rollback
 * itself fails, the connection is in an unknown state, so it is destroyed
 * instead of being reused.
 *
 * After the commit the transaction is cleared from the context (so callbacks
 * that query run on the pool, not on a released client) and the after-commit
 * callbacks run in order. They can no longer change the outcome: a failing
 * callback is logged and the result is still returned.
 */
export async function runInTransaction<T>(
  pool: Pool,
  fn: () => Promise<T>,
  setTx: (tx?: DbConnection) => void,
): Promise<T> {
  const client = await pool.connect();
  const afterCommit: AfterCommitCallback[] = [];
  let destroyClient: Error | undefined;
  let result: T;
  try {
    await client.query('BEGIN');
    setTx({ client, afterCommit });
    result = await fn();
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch((rollbackError: unknown) => {
      destroyClient =
        rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
    });
    throw error;
  } finally {
    setTx(undefined);
    client.release(destroyClient);
  }

  for (const callback of afterCommit) {
    try {
      await callback();
    } catch (err) {
      logger.error({ err }, 'After-commit callback failed');
    }
  }
  return result;
}

/**
 * `@nestjs-cls/transactional` adapter that runs transactions at the
 * connection level, on the shared `pg` pool, instead of on one Drizzle
 * instance.
 *
 * Why not the official Drizzle adapter: it calls `db.transaction()` on a
 * single Drizzle instance, and that instance's transaction object knows only
 * that instance's schema. Every module has its own instance (docs/database.md),
 * so a use case writing to two modules would need one combined schema, which
 * would let every module query every table. Here the transaction is a pool
 * client; each module builds its own schema-limited Drizzle instance on top of
 * it (module-db.ts), so all modules share the transaction and still see only
 * their own tables.
 *
 * Propagation is the library's: the default `REQUIRED` joins an active
 * transaction. Savepoints (`NESTED`) are not supported yet.
 */
export class PgTransactionalAdapter implements TransactionalAdapter<
  Pool,
  DbConnection,
  PgTransactionOptions
> {
  readonly connectionToken = PG_POOL;

  optionsFactory = (
    pool: Pool,
  ): TransactionalAdapterOptions<DbConnection, PgTransactionOptions> => {
    // One object for "no transaction", so the module-db cache keys stay stable.
    const outside: DbConnection = { client: pool };
    return {
      wrapWithTransaction: (_options, fn, setTx) => runInTransaction(pool, fn, setTx),
      getFallbackInstance: () => outside,
    };
  };
}
