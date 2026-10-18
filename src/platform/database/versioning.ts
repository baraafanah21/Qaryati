import { and, eq, getTableName, isNull, sql } from 'drizzle-orm';
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
 * The columns of a versioned, soft-deletable table. Spread them into the
 * table: `pgTable('village', { id: uuid().primaryKey(), ...versionColumns(), ... })`.
 *
 * `createdAt` and `updatedAt` have no database default on purpose: the
 * repository sets them from the injected `Clock`, so tests control time.
 */
export function versionColumns() {
  return {
    version: integer().notNull().default(INITIAL_VERSION),
    createdAt: timestamp({ withTimezone: true }).notNull(),
    updatedAt: timestamp({ withTimezone: true }).notNull(),
    deletedAt: timestamp({ withTimezone: true }),
  };
}

/** A table with a primary key `id` and the columns from {@link versionColumns}. */
export type VersionedTable = PgTable & {
  id: PgColumn;
  version: PgColumn;
  updatedAt: PgColumn;
  deletedAt: PgColumn;
};

/** The values a versioned update may set; the helper owns id, version and timestamps. */
export type VersionedValues<T extends VersionedTable> = Omit<
  PgUpdateSetSource<T>,
  'id' | 'version' | 'createdAt' | 'updatedAt' | 'deletedAt'
>;

/** What the helpers need: the module's database handle and the clock. */
export interface VersionedWriteContext {
  db: Pick<ModuleDb<Record<string, unknown>>, 'update' | 'select'>;
  clock: Clock;
}

/**
 * Optimistic-lock update in one statement:
 *
 * ```sql
 * UPDATE t SET ..., version = version + 1, updated_at = <clock>
 * WHERE id = $1 AND version = $2 AND deleted_at IS NULL RETURNING *
 * ```
 *
 * Returns the updated row. When no row matched, a second query tells the two
 * reasons apart: the row is missing or soft-deleted → `NotFoundError` (404);
 * the row exists at another version → `PreconditionFailedError` (412
 * `VERSION_CONFLICT`). Of two concurrent updates with the same version, the
 * second waits for the first's row lock, then matches nothing: exactly one wins.
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
  return writeWithVersion(ctx, table, id, expectedVersion, { ...values });
}

/**
 * Optimistic-lock soft delete: sets `deleted_at`, with the same version check,
 * version increment and errors as {@link updateWithVersion}. Returns the row
 * as it was soft-deleted (the audit entry's `before` comes from the caller's
 * own read).
 */
export async function softDeleteWithVersion<T extends VersionedTable>(
  ctx: VersionedWriteContext,
  table: T,
  id: string,
  expectedVersion: number,
): Promise<T['$inferSelect']> {
  return writeWithVersion(ctx, table, id, expectedVersion, { deletedAt: ctx.clock.now() });
}

async function writeWithVersion<T extends VersionedTable>(
  ctx: VersionedWriteContext,
  table: T,
  id: string,
  expectedVersion: number,
  values: Record<string, unknown>,
): Promise<T['$inferSelect']> {
  const set = {
    ...values,
    version: sql`${table.version} + 1`,
    updatedAt: ctx.clock.now(),
  } as PgUpdateSetSource<T>;
  const rows = (await ctx.db
    .update(table)
    .set(set)
    .where(and(eq(table.id, id), eq(table.version, expectedVersion), isNull(table.deletedAt)))
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
    .select({ version: table.version, deletedAt: table.deletedAt })
    .from(table)
    .where(eq(table.id, id))) as { version: number; deletedAt: Date | null }[];
  const label = getTableName(table).replaceAll('_', ' ');
  if (!current || current.deletedAt !== null) {
    return new NotFoundError(`The ${label} ${id} does not exist.`);
  }
  return new PreconditionFailedError(
    `The ${label} ${id} is at version ${current.version}, not ${expectedVersion}. ` +
      'Read it again and retry with the new ETag.',
    { details: { currentVersion: current.version } },
  );
}
