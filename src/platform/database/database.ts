import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

/**
 * Injection token of the Drizzle instance. Repositories in a module's
 * `infrastructure/` inject it with `@Inject(DRIZZLE) db: Database`.
 */
export const DRIZZLE = Symbol('DRIZZLE');

/** Injection token of the underlying node-postgres pool (owned by DatabaseModule). */
export const PG_POOL = Symbol('PG_POOL');

/**
 * Drizzle instance connected as `qaryati_app`.
 *
 * Queries are typed by the table objects passed to them (`db.select().from(village)`),
 * so a repository can only reach tables it can import, and dependency-cruiser
 * allows importing only the module's own schema. No combined schema is
 * registered: it would hand every module every other module's tables through
 * `db.query`. See docs/database.md.
 */
export type Database = NodePgDatabase;
