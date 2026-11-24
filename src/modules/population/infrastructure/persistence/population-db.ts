import type { ModuleDb } from '../../../../platform/database/database';
import type * as schema from './schema';

/** The population module's database handle: only population tables are visible. */
export type PopulationDb = ModuleDb<typeof schema>;
