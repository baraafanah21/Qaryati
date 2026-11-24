import { sql } from 'drizzle-orm';
import { check, customType, date, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';

/**
 * Drizzle tables owned by the heritage module.
 *
 * drizzle.config.ts picks this file up by its path, so tables declared here
 * land in the generated migrations. Only this module edits this file; other
 * modules reach the data through `index.ts`. See docs/database.md.
 *
 * Each table is a fact table (docs/data-model.md, "Fact tables: one pattern for
 * all"): the value of exactly one claim of its type. Village, source and review
 * state live on `claim`. The composite foreign keys `(claim_id, claim_type) ->
 * claim` are cross-module, so they are raw SQL in `0020_heritage_claim_fks`.
 * Lengths, dates, precisions and allowed values are domain rules
 * (`domain/heritage-facts.ts`), not CHECKs; the only CHECK is the constant type.
 */

/** A WGS 84 point. Written and read with native SQL (`ST_MakePoint`, `ST_X`/`ST_Y`). */
const geographyPoint = customType<{ data: string; driverData: string }>({
  dataType: () => 'geography(Point,4326)',
});

/** `HISTORY_OVERVIEW`: the story of a village. */
export const historyOverview = pgTable(
  'history_overview',
  {
    claimId: uuid().primaryKey(),
    claimType: text().notNull().default('HISTORY_OVERVIEW'),
    summary: text().notNull(),
  },
  (table) => [
    check('history_overview_claim_type_check', sql`${table.claimType} = 'HISTORY_OVERVIEW'`),
  ],
);

/** `HISTORICAL_EVENT`: dates are the first day of their period (`date_precision`). */
export const historicalEvent = pgTable(
  'historical_event',
  {
    claimId: uuid().primaryKey(),
    claimType: text().notNull().default('HISTORICAL_EVENT'),
    title: text().notNull(),
    description: text().notNull(),
    startDate: date({ mode: 'string' }).notNull(),
    endDate: date({ mode: 'string' }),
    datePrecision: text().notNull(),
  },
  (table) => [
    check('historical_event_claim_type_check', sql`${table.claimType} = 'HISTORICAL_EVENT'`),
  ],
);

/** `LANDMARK`: a place, with an optional point (GiST for distance queries). */
export const landmark = pgTable(
  'landmark',
  {
    claimId: uuid().primaryKey(),
    claimType: text().notNull().default('LANDMARK'),
    name: text().notNull(),
    landmarkType: text().notNull(),
    description: text(),
    location: geographyPoint(),
    era: text(),
  },
  (table) => [
    check('landmark_claim_type_check', sql`${table.claimType} = 'LANDMARK'`),
    index('landmark_location_gist').using('gist', table.location),
  ],
);

/** `CULTURAL_ITEM`: intangible heritage (songs, dishes, crafts, ...). */
export const culturalItem = pgTable(
  'cultural_item',
  {
    claimId: uuid().primaryKey(),
    claimType: text().notNull().default('CULTURAL_ITEM'),
    category: text().notNull(),
    name: text().notNull(),
    description: text().notNull(),
  },
  (table) => [check('cultural_item_claim_type_check', sql`${table.claimType} = 'CULTURAL_ITEM'`)],
);
