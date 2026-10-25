import type { ModuleDb } from '../../../../platform/database/database';
import type * as schema from './schema';

/** IAM's schema-limited handle follows the active transaction automatically. */
export type IamDb = ModuleDb<typeof schema>;
