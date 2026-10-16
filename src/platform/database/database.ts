import { Inject } from '@nestjs/common';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

/** Injection token of the node-postgres pool, the one pool every module shares. */
export const PG_POOL = Symbol('PG_POOL');

/**
 * Injection token of the calling module's own Drizzle instance, provided by
 * `DatabaseModule.forFeature(schema)`. Each module that imports `forFeature`
 * gets its own instance under this same token; Nest resolves it from the
 * module's own imports, so one module never receives another's.
 */
export const MODULE_DB = Symbol('MODULE_DB');

/**
 * A module's Drizzle instance, typed with that module's schema: `db.query`
 * knows exactly the module's tables and relations.
 *
 * ```ts
 * import * as schema from './schema';
 * export type VillageDb = ModuleDb<typeof schema>;
 * ```
 */
export type ModuleDb<TSchema extends Record<string, unknown>> = NodePgDatabase<TSchema>;

/** Injects the module's own Drizzle instance: `@InjectModuleDb() db: VillageDb`. */
export function InjectModuleDb(): ParameterDecorator & PropertyDecorator {
  return Inject(MODULE_DB);
}
