import { and, eq, getTableName, sql } from 'drizzle-orm';
import {
  integer,
  timestamp,
  type PgColumn,
  type PgTable,
  type PgUpdateSetSource,
} from 'drizzle-orm/pg-core';
import {
  INITIAL_VERSION,
  NotFoundError,
  PreconditionFailedError,
  type Clock,
} from '../../shared/kernel';
import type { ModuleDb } from './database';

/**
 * The columns of a versioned table. Spread them into the table:
 * `pgTable('village', { id: uuid().primaryKey(), ...versionColumns(), ... })`.
 *
 * `createdAt` and `updatedAt` have no database default on purpose: the
 * repository sets them from the injected `Clock`, so tests control time.
 * Nothing else: a row leaves public reads through a status column
 * (archived, disabled, withdrawn), or is removed for good with
 * {@link deleteWithVersion}.
 */
export function versionColumns() {
  return {
    version: integer().notNull().default(INITIAL_VERSION),
    createdAt: timestamp({ withTimezone: true }).notNull(),
    updatedAt: timestamp({ withTimezone: true }).notNull(),
  };
}

/** A table with a primary key `id` and the `version` and `updatedAt` columns from {@link versionColumns}. */
export type VersionedTable = PgTable & {
  id: PgColumn;
  version: PgColumn;
  updatedAt: PgColumn;
};

/** The values a versioned update may set; the helper owns id, version and timestamps. */
export type VersionedValues<T extends VersionedTable> = Omit<
  PgUpdateSetSource<T>,
  'id' | 'version' | 'createdAt' | 'updatedAt'
>;

/** What the helpers need: the module's database handle and the clock. */
export interface VersionedWriteContext {
  db: Pick<ModuleDb<Record<string, unknown>>, 'update' | 'delete' | 'select'>;
  clock: Clock;
}

/**
 * Optimistic-lock update in one statement:
 *
 * ```sql
 * UPDATE t SET ..., version = version + 1, updated_at = <clock>
 * WHERE id = $1 AND version = $2 RETURNING *
 * ```
 *
 * Returns the updated row. When no row matched, a second query tells the two
 * reasons apart: the row is missing → `NotFoundError` (404); the row exists at
 * another version → `PreconditionFailedError` (412 `VERSION_CONFLICT`). Of two
 * concurrent writes with the same version, the second waits for the first's
 * row lock, then matches nothing: exactly one wins.
 *
 * Runs in the active transaction like any other query on the handle.
 */
export async function updateWithVersion<T extends VersionedTable>(
  ctx: VersionedWriteContext,
  table: T,
  id: string,
  expectedVersion: number,
  values: VersionedValues<T>,
): Promise<T['$inferSelect']> {
  const set = {
    ...values,
    version: sql`${table.version} + 1`,
    updatedAt: ctx.clock.now(),
  } as PgUpdateSetSource<T>;
  const rows = (await ctx.db
    .update(table)
    .set(set)
    .where(and(eq(table.id, id), eq(table.version, expectedVersion)))
    .returning()) as T['$inferSelect'][];
  const [row] = rows;
  if (row) return row;
  throw await explainMiss(ctx, table, id, expectedVersion);
}

/**
 * Optimistic-lock hard delete in one statement:
 *
 * ```sql
 * DELETE FROM t WHERE id = $1 AND version = $2 RETURNING *
 * ```
 *
 * Returns the deleted row, which the caller records as the audit entry's
 * `before`. Same errors and row-lock behaviour as {@link updateWithVersion}.
 * Rows that still have dependants fail with the foreign key's `ON DELETE
 * RESTRICT` (409 `REFERENCE_CONFLICT`).
 */
export async function deleteWithVersion<T extends VersionedTable>(
  ctx: VersionedWriteContext,
  table: T,
  id: string,
  expectedVersion: number,
): Promise<T['$inferSelect']> {
  const rows = (await ctx.db
    .delete(table)
    .where(and(eq(table.id, id), eq(table.version, expectedVersion)))
    .returning()) as T['$inferSelect'][];
  const [row] = rows;
  if (row) return row;
  throw await explainMiss(ctx, table, id, expectedVersion);
}

async function explainMiss(
  ctx: VersionedWriteContext,
  table: VersionedTable,
  id: string,
  expectedVersion: number,
): Promise<Error> {
  const [current] = (await ctx.db
    .select({ version: table.version })
    .from(table)
    .where(eq(table.id, id))) as { version: number }[];
  const label = getTableName(table).replaceAll('_', ' ');
  if (!current) {
    return new NotFoundError(`The ${label} ${id} does not exist.`);
  }
  return new PreconditionFailedError(
    `The ${label} ${id} is at version ${current.version}, not ${expectedVersion}. ` +
      'Read it again and retry with the new ETag.',
    { details: { currentVersion: current.version } },
  );
}
