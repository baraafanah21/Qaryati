import { sql, type SQL } from 'drizzle-orm';
import { pageOffset, type PageRequest } from '../../../shared/kernel';
import { claimsOf, preferredClaimsOf } from '../../curation';
import type { PopulationClaimScope } from '../domain/population.repository';
import { COUNT_TYPE_PRIORITY } from '../domain/population-values';

// The native statements of the population module. Built only from bound
// parameters and fixed fragments, never by concatenating input; exported so the
// integration tests can run and EXPLAIN exactly what the repository runs.
// Claim state comes from curation's fragments, so the `claim` table is never named here.

/** `array_position` of the count type in the priority list: the tie-break on equal years. */
const countTypeRank = sql`array_position(${sql.param([...COUNT_TYPE_PRIORITY])}::text[], p.count_type)`;

/** The value columns, camelCase, as every statement returns them. */
const recordColumns = sql`p.claim_id AS "claimId", p.population, p.reference_year AS "referenceYear",
  p.count_type AS "countType"`;

/** Which claims of `scope` a reader sees, on the alias `c` of `claimsOf`. */
function scopeFilter(scope: PopulationClaimScope): SQL {
  switch (scope.kind) {
    case 'PREFERRED':
      return sql`c.is_preferred`;
    case 'ALL':
      return sql`TRUE`;
    case 'PREFERRED_OR_OWN':
      return sql`(c.is_preferred OR c.created_by = ${scope.userId})`;
  }
}

/** One page of a village's records, by year, and the total with the same `WHERE`. */
export function listRecordsQueries(
  query: PageRequest & { villageId: string; scope: PopulationClaimScope },
): { page: SQL; count: SQL } {
  const from = sql`FROM population_record p
    JOIN ${claimsOf('POPULATION')} c ON c.claim_id = p.claim_id
    WHERE c.village_id = ${query.villageId} AND ${scopeFilter(query.scope)}`;
  return {
    page: sql`SELECT ${recordColumns} ${from}
      ORDER BY p.reference_year, ${countTypeRank}, p.claim_id
      LIMIT ${query.size} OFFSET ${pageOffset(query)}`,
    count: sql`SELECT count(*)::int AS total ${from}`,
  };
}

/** Every preferred record of one village, by year. */
export function preferredHistoryQuery(villageId: string): SQL {
  return sql`SELECT ${recordColumns}
    FROM population_record p
    JOIN ${preferredClaimsOf('POPULATION')} pc ON pc.claim_id = p.claim_id
    WHERE pc.village_id = ${villageId}
    ORDER BY p.reference_year, ${countTypeRank}`;
}

/**
 * The latest preferred record of each village: `DISTINCT ON (village_id)`
 * keeps the first row of each village in `ORDER BY village_id, year DESC,
 * count-type rank`, so one statement answers for a whole page of villages.
 */
export function latestPreferredQuery(villageIds: readonly string[]): SQL {
  return sql`SELECT DISTINCT ON (pc.village_id) pc.village_id AS "villageId", ${recordColumns}
    FROM population_record p
    JOIN ${preferredClaimsOf('POPULATION')} pc ON pc.claim_id = p.claim_id
    WHERE pc.village_id = ANY(${sql.param([...villageIds])}::uuid[])
    ORDER BY pc.village_id, p.reference_year DESC, ${countTypeRank}`;
}

/**
 * Growth statistics of one village: each preferred record with the previous
 * preferred record of the same count type (`lag()` over `PARTITION BY
 * count_type ORDER BY reference_year`), the absolute and percentage change and
 * the compounded average yearly growth. Census and estimate series are never
 * mixed. A previous count of 0 gives null percentages instead of a division by zero.
 */
export function populationChangesQuery(villageId: string): SQL {
  return sql`WITH series AS (
      SELECT p.claim_id, p.population, p.reference_year, p.count_type,
             lag(p.reference_year) OVER w AS previous_year,
             lag(p.population) OVER w AS previous_population
      FROM population_record p
      JOIN ${preferredClaimsOf('POPULATION')} pc ON pc.claim_id = p.claim_id
      WHERE pc.village_id = ${villageId}
      WINDOW w AS (PARTITION BY p.count_type ORDER BY p.reference_year)
    )
    SELECT claim_id AS "claimId", population, reference_year AS "referenceYear",
           count_type AS "countType",
           previous_year AS "previousYear",
           previous_population AS "previousPopulation",
           population - previous_population AS "absoluteChange",
           round((population - previous_population) * 100.0
                 / NULLIF(previous_population, 0), 2)::float8 AS "percentChange",
           round((power(population::numeric / NULLIF(previous_population, 0),
                        1.0 / (reference_year - previous_year)) - 1) * 100, 2)::float8
             AS "averageYearlyGrowthPercent"
    FROM series
    ORDER BY reference_year, array_position(${sql.param([...COUNT_TYPE_PRIORITY])}::text[], count_type)`;
}
