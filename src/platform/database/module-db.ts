import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool, PoolClient } from 'pg';
import type { ModuleDb } from './database';

const TRANSACTION_HINT =
  'Do not call db.transaction() in a module. Put @Transactional() on the use case: ' +
  'every repository then runs in the same transaction (docs/kernel.md, "Transactions").';

/**
 * Builds the handle a module injects as `MODULE_DB`.
 *
 * The handle looks like a Drizzle instance with the module's schema, but it
 * holds no connection of its own. On every property access it asks
 * `currentClient()` for the client to use, which is the active transaction's
 * client inside `@Transactional()` and the pool otherwise, and forwards to a
 * Drizzle instance built on that client with **only this module's schema**.
 * Repositories therefore never receive or pass a transaction, and
 * `db.query` still knows only the module's own tables.
 *
 * Instances are cached per client in a `WeakMap`. The pool keeps and reuses
 * its clients, so after warm-up every access is a map lookup, and an entry
 * disappears with its client.
 */
export function createModuleDb<TSchema extends Record<string, unknown>>(
  schema: TSchema,
  currentClient: () => Pool | PoolClient,
): ModuleDb<TSchema> {
  const instances = new WeakMap<Pool | PoolClient, NodePgDatabase<TSchema>>();

  const resolve = (): NodePgDatabase<TSchema> => {
    const client = currentClient();
    let db = instances.get(client);
    if (!db) {
      db = drizzle({ client, schema, casing: 'snake_case' });
      instances.set(client, db);
    }
    return db;
  };

  const forbidden = (): never => {
    throw new Error(TRANSACTION_HINT);
  };

  return new Proxy({} as ModuleDb<TSchema>, {
    get(_target, property) {
      if (property === 'transaction') return forbidden;
      const db = resolve();
      const value: unknown = Reflect.get(db, property, db);
      return typeof value === 'function' ? (value as () => unknown).bind(db) : value;
    },
    has(_target, property) {
      return property !== 'transaction' && Reflect.has(resolve(), property);
    },
    ownKeys() {
      return Reflect.ownKeys(resolve()).filter((key) => key !== 'transaction');
    },
    getOwnPropertyDescriptor(_target, property) {
      if (property === 'transaction') return undefined;
      const descriptor = Reflect.getOwnPropertyDescriptor(resolve(), property);
      // The target is an empty object, so a proxy may not report a
      // non-configurable property it does not have.
      return descriptor && { ...descriptor, configurable: true };
    },
  });
}
