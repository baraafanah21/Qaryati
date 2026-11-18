import type { ModuleDb } from '../../../../platform/database/database';
import type * as schema from './schema';

/** The village module's database handle: only village tables are visible. */
export type VillageDb = ModuleDb<typeof schema>;
