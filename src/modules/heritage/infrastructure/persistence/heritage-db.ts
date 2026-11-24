import type { ModuleDb } from '../../../../platform/database/database';
import type * as schema from './schema';

/** The heritage module's database handle: only heritage tables are visible. */
export type HeritageDb = ModuleDb<typeof schema>;
