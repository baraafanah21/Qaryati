import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

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

/** Shared provenance and review record for a typed village fact. */
export const claim = pgTable(
  'claim',
  {
    id: uuid().primaryKey(),
    claimType: text().notNull(),
    villageId: uuid().notNull(),
    groupKey: text().notNull(),
    valueHash: text().notNull(),
    sourceId: uuid(),
    sourceLocator: text(),
    status: text().notNull().default('UNVERIFIED'),
    isPreferred: boolean().notNull().default(false),
    supersedesId: uuid(),
    createdBy: uuid().notNull(),
    reviewedBy: uuid(),
    reviewedAt: timestamp({ withTimezone: true }),
    reviewNote: text(),
    ...versionColumns(),
  },
  (table) => [
    unique('claim_id_type_unique').on(table.id, table.claimType),

    foreignKey({
      columns: [table.sourceId],
      foreignColumns: [source.id],
      name: 'claim_source_id_fk',
    }).onDelete('restrict'),

    foreignKey({
      columns: [table.supersedesId],
      foreignColumns: [table.id],
      name: 'claim_supersedes_id_fk',
    }).onDelete('restrict'),

    check(
      'claim_preferred_verified_check',
      sql`NOT ${table.isPreferred} OR ${table.status} = 'VERIFIED'`,
    ),

    check(
      'claim_verified_source_check',
      sql`${table.status} <> 'VERIFIED' OR ${table.sourceId} IS NOT NULL`,
    ),

    uniqueIndex('claim_one_preferred')
      .on(table.groupKey)
      .where(sql`${table.isPreferred}`),

    index('claim_review_queue')
      .on(table.status, table.createdAt)
      .where(sql`${table.status} IN ('UNVERIFIED', 'DISPUTED')`),

    index('claim_village_published')
      .on(table.villageId, table.claimType)
      .where(sql`${table.isPreferred}`),

    index('claim_group').on(table.groupKey),

    index('claim_village_id_idx').on(table.villageId),
    index('claim_source_id_idx').on(table.sourceId),
    index('claim_supersedes_id_idx').on(table.supersedesId),
    index('claim_created_by_idx').on(table.createdBy),
    index('claim_reviewed_by_idx').on(table.reviewedBy),
  ],
);
