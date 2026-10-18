// Reference: copy the module schema: camelCase columns without names, versionColumns(), constraints in the schema (here a partial unique index).
import { sql } from 'drizzle-orm';
import { pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { versionColumns } from '../../../../src/platform/database/versioning';

/**
 * The widget table. A real module's schema.ts lives under
 * src/modules/<m>/infrastructure/persistence and reaches the database through
 * `npm run db:generate`; this one is test-only (see widget-table.ts).
 */
export const widget = pgTable(
  'widget',
  {
    id: uuid().primaryKey(),
    name: text().notNull(),
    ...versionColumns(),
  },
  (table) => [
    // Names are unique among live widgets; a deleted widget frees its name.
    uniqueIndex('widget_name_key')
      .on(table.name)
      .where(sql`${table.deletedAt} IS NULL`),
  ],
);
