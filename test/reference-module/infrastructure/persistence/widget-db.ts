// Reference: copy the module database type: ModuleDb over the module's own schema, nothing else.
import type { ModuleDb } from '../../../../src/platform/database/database';
import type * as schema from './schema';

/** The widget module's Drizzle handle: `db.query` knows only `widget`. */
export type WidgetDb = ModuleDb<typeof schema>;
