import { drizzle } from 'drizzle-orm/node-postgres';
import { pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { FixedClock, NotFoundError, PreconditionFailedError } from '../../shared/kernel';
import { softDeleteWithVersion, updateWithVersion, versionColumns } from './versioning';

const note = pgTable('village_note', {
  id: uuid().primaryKey(),
  body: text().notNull(),
  ...versionColumns(),
});

const NOW = new Date('2026-10-18T10:00:00Z');

/**
 * A real Drizzle instance on a fake client: the SQL is what Drizzle really
 * generates, and each query answers with the next prepared rows. Drizzle asks
 * for `rowMode: 'array'`, so rows are arrays in column order.
 */
function setup(results: unknown[][][]) {
  const queries: { text: string; values: unknown[] }[] = [];
  const client = {
    query: jest.fn((query: { text: string }, values: unknown[]) => {
      queries.push({ text: query.text, values });
      return Promise.resolve({ rows: results.shift() ?? [], rowCount: 0, fields: [] });
    }),
  };
  const db = drizzle({ client: client as never, casing: 'snake_case' });
  return { ctx: { db, clock: new FixedClock(NOW) }, queries };
}

// id, body, version, created_at, updated_at, deleted_at
const stored = ['n1', 'new', 4, NOW, NOW, null];
const row = { id: 'n1', body: 'new', version: 4, createdAt: NOW, updatedAt: NOW, deletedAt: null };

describe('updateWithVersion', () => {
  it('sends one UPDATE that checks id, version and deleted_at and bumps the version', async () => {
    const { ctx, queries } = setup([[stored]]);
    await expect(updateWithVersion(ctx, note, 'n1', 3, { body: 'new' })).resolves.toEqual(row);
    expect(queries).toHaveLength(1);
    expect(queries[0]?.text).toMatch(
      /^update "village_note" set "body" = \$1, "version" = "village_note"\."version" \+ 1, "updated_at" = \$2 where \("village_note"\."id" = \$3 and "village_note"\."version" = \$4 and "village_note"\."deleted_at" is null\) returning /,
    );
    expect(queries[0]?.values).toEqual(['new', NOW.toISOString(), 'n1', 3]);
  });

  it('reports a missing row as NotFoundError', async () => {
    const { ctx } = setup([[], []]);
    await expect(updateWithVersion(ctx, note, 'n1', 3, { body: 'x' })).rejects.toThrow(
      new NotFoundError('The village note n1 does not exist.'),
    );
  });

  it('reports a soft-deleted row as NotFoundError', async () => {
    const { ctx } = setup([[], [[4, NOW]]]);
    await expect(updateWithVersion(ctx, note, 'n1', 4, { body: 'x' })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('reports a row at another version as PreconditionFailedError', async () => {
    const { ctx } = setup([[], [[5, null]]]);
    const error = await updateWithVersion(ctx, note, 'n1', 3, { body: 'x' }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(PreconditionFailedError);
    expect((error as PreconditionFailedError).message).toMatch(/version 5, not 3/);
  });
});

describe('softDeleteWithVersion', () => {
  it('sets deleted_at from the clock with the same version check', async () => {
    const { ctx, queries } = setup([[[...stored.slice(0, 5), NOW]]]);
    await softDeleteWithVersion(ctx, note, 'n1', 3);
    expect(queries[0]?.text).toMatch(
      /^update "village_note" set "version" = .*, "updated_at" = \$1, "deleted_at" = \$2 where .*"version" = \$4 and "village_note"\."deleted_at" is null\)/,
    );
    expect(queries[0]?.values).toEqual([NOW.toISOString(), NOW.toISOString(), 'n1', 3]);
  });
});
