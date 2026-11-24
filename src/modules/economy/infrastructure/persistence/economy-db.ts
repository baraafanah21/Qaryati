import type { ModuleDb } from '../../../../platform/database/database';
import type * as schema from './schema';

/** The economy module's database handle: only economy tables are visible. */
export type EconomyDb = ModuleDb<typeof schema>;
