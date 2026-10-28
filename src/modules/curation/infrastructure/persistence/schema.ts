import { sql } from 'drizzle-orm';
import { check, index, pgTable, smallint, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
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
    updatedBy: uuid().notNull(),
    ...versionColumns(),
  },
  (table) => [
    check(
      'source_type_check',
      sql`${table.sourceType} IN (
        'BOOK', 'ARTICLE', 'CENSUS', 'GOV_DATASET',
        'ARCHIVE', 'ORAL_HISTORY', 'WEBSITE', 'EXTERNAL_API'
      )`,
    ),
    check('source_title_check', sql`char_length(${table.title}) BETWEEN 1 AND 300`),
    check('source_reliability_check', sql`${table.reliability} BETWEEN 1 AND 5`),
    check('source_published_year_check', sql`${table.publishedYear} BETWEEN 1000 AND 2100`),
    check('source_url_length_check', sql`char_length(${table.url}) <= 2048`),
    check('source_url_scheme_check', sql`${table.url} ~* '^https?://'`),
    check('source_notes_check', sql`char_length(${table.notes}) <= 2000`),
    check('source_isbn_check', sql`${table.isbn} ~ '^([0-9]{9}[0-9X]|[0-9]{13})$'`),
    check('source_version_check', sql`${table.version} >= 1`),

    uniqueIndex('source_url_key')
      .on(table.url)
      .where(sql`${table.url} IS NOT NULL AND ${table.deletedAt} IS NULL`),

    uniqueIndex('source_isbn_key')
      .on(table.isbn)
      .where(sql`${table.isbn} IS NOT NULL AND ${table.deletedAt} IS NULL`),

    index('source_type_idx').on(table.sourceType),

    index('source_title_trgm_idx').using('gin', sql`${table.title} gin_trgm_ops`),
  ],
);
