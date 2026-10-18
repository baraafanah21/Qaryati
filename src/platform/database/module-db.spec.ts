import { integer, pgTable } from 'drizzle-orm/pg-core';
import type { Pool, PoolClient } from 'pg';
import { createModuleDb } from './module-db';

const schema = { thing: pgTable('thing', { id: integer().primaryKey() }) };

describe('createModuleDb', () => {
  const pool = { query: jest.fn() } as unknown as Pool;
  const client = { query: jest.fn() } as unknown as PoolClient;

  it('forwards to an instance on whichever client is current', () => {
    let current: Pool | PoolClient = pool;
    const db = createModuleDb(schema, () => current);
    const clientOf = () => (db as unknown as { $client: unknown }).$client;
    expect(clientOf()).toBe(pool);
    current = client;
    expect(clientOf()).toBe(client);
  });

  it('builds one instance per client and reuses it', () => {
    let current: Pool | PoolClient = pool;
    const db = createModuleDb(schema, () => current);
    const onPool = db.query;
    expect(db.query).toBe(onPool);
    current = client;
    expect(db.query).not.toBe(onPool);
  });

  it('exposes only the module’s own tables on db.query', () => {
    const db = createModuleDb(schema, () => pool);
    expect(Object.keys(db.query)).toEqual(['thing']);
  });

  it('refuses db.transaction() with a pointer to @Transactional()', () => {
    const db = createModuleDb(schema, () => pool) as unknown as { transaction: () => unknown };
    expect('transaction' in db).toBe(false);
    expect(() => db.transaction()).toThrow(/@Transactional\(\)/);
  });
});
