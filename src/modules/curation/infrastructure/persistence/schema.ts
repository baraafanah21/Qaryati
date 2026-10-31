import { sql } from 'drizzle-orm';
import { index, pgTable, smallint, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { versionColumns } from '../../../../platform/database/versioning';

/** Sources used to support and verify village information. */
export const source = pgTable(
  'source',
  {
    id: uuid().primaryKey(),

    sourceType: text().notNull(),

    title: text().notNull(),

    author: text(),

    publisher: text(),

    publishedYear: smallint(),

    url: text(),

    isbn: text(),

    reliability: smallint().notNull(),

    notes: text(),

    createdBy: uuid().notNull(),

    ...versionColumns(),
  },
  (table) => [
    uniqueIndex('source_url_key').on(table.url),

    uniqueIndex('source_isbn_key').on(table.isbn),

    index('source_type_idx').on(table.sourceType),

    index('source_created_by_idx').on(table.createdBy),

    index('source_title_trgm_idx').using('gin', sql`${table.title} gin_trgm_ops`),
  ],
);
