import type { ModuleDb } from '../../../../platform/database/database';
import type * as schema from './schema';

/** Database handle of the audit module: sees only `audit_entry`. */
export type AuditDb = ModuleDb<typeof schema>;
