import { check, integer, pgTable, smallint, text, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Drizzle tables owned by the population module.
 *
 * drizzle.config.ts picks this file up by its path, so tables declared here
 * land in the generated migrations. Only this module edits this file; other
 * modules reach the data through `index.ts`. See docs/database.md.
 */

/**
 * `POPULATION` fact (docs/data-model.md, "Fact tables: one pattern for all"):
 * the value of exactly one claim. Village, source and review state live on
 * `claim`. The composite foreign key `(claim_id, claim_type) -> claim` is
 * cross-module, so it is raw SQL in `0018_population_claim_fks`. Ranges and
 * count types are domain rules (`domain/population-record.ts`), not CHECKs.
 */
export const populationRecord = pgTable(
  'population_record',
  {
    claimId: uuid().primaryKey(),
    claimType: text().notNull().default('POPULATION'),
    population: integer().notNull(),
    referenceYear: smallint().notNull(),
    countType: text().notNull(),
  },
  (table) => [
    // Structural, never changes: a population row belongs to a POPULATION claim.
    check('population_record_claim_type_check', sql`${table.claimType} = 'POPULATION'`),
  ],
);
