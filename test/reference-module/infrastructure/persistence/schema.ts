// Reference: copy the module schema: camelCase columns without names, versionColumns(), keys, NOT NULL, uniqueness and indexes only (value rules live in the domain, never in a CHECK).
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
    // Two concurrent creates with one name: only a unique index stops the second.
    uniqueIndex('widget_name_key').on(table.name),
  ],
);
