import type { ModuleDb } from '../../../../platform/database/database';
import type * as schema from './schema';

/** Database handle for the curation module. */
export type SourceDb = ModuleDb<typeof schema>;
