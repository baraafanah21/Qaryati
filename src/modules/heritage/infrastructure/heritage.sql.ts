import { sql, type SQL } from 'drizzle-orm';
import { pageOffset } from '../../../shared/kernel';
import { claimsOf, preferredClaimsOf } from '../../curation';
import type { HeritageFactFilters, HeritageFactType } from '../domain/heritage-fact-types';
import type { HeritageClaimScope, HeritageListQuery } from '../domain/heritage-fact.repository';
import type { HeritagePoint } from '../domain/heritage-facts';

// The native statements of the heritage module. Built only from bound
// parameters and fixed fragments, never by concatenating input; exported so the
// integration tests can run and EXPLAIN exactly what the repository runs.
// Claim state comes from curation's fragments, so the `claim` table is never named here.

/** Per type: the table, its value columns (camelCase, on alias `f`) and its list order. */
const FACTS: Record<HeritageFactType, { table: string; columns: SQL; order: SQL }> = {
  HISTORY_OVERVIEW: {
    table: 'history_overview',
    columns: sql`f.summary`,
    // claim ids are UUIDv7: oldest first.
    order: sql`f.claim_id`,
  },
  HISTORICAL_EVENT: {
    table: 'historical_event',
    // ::text keeps the date as YYYY-MM-DD (node-postgres would build a local-time Date).
    columns: sql`f.title, f.description, f.start_date::text AS "startDate",
      f.end_date::text AS "endDate", f.date_precision AS "datePrecision"`,
    order: sql`f.start_date, f.claim_id`,
  },
  LANDMARK: {
    table: 'landmark',
    columns: sql`f.name, f.landmark_type AS "landmarkType", f.description, f.era,
      ST_Y(f.location::geometry) AS latitude, ST_X(f.location::geometry) AS longitude`,
    order: sql`f.name, f.claim_id`,
  },
  CULTURAL_ITEM: {
    table: 'cultural_item',
    columns: sql`f.category, f.name, f.description`,
    order: sql`f.category, f.name, f.claim_id`,
  },
};

/** Which claims of `scope` a reader sees, on the alias `c` of `claimsOf`. */
function scopeFilter(scope: HeritageClaimScope): SQL {
  switch (scope.kind) {
    case 'PREFERRED':
      return sql`c.is_preferred`;
    case 'ALL':
      return sql`TRUE`;
    case 'PREFERRED_OR_OWN':
      return sql`(c.is_preferred OR c.created_by = ${scope.userId})`;
  }
}

/** The `?type=` / `?category=` filter of a list, or nothing. */
function valueFilter<T extends HeritageFactType>(type: T, filter: HeritageFactFilters[T]): SQL {
  if (type === 'LANDMARK') {
    const { landmarkType } = filter as HeritageFactFilters['LANDMARK'];
    if (landmarkType) return sql`AND f.landmark_type = ${landmarkType}`;
  }
  if (type === 'CULTURAL_ITEM') {
    const { category } = filter as HeritageFactFilters['CULTURAL_ITEM'];
    if (category) return sql`AND f.category = ${category}`;
  }
  return sql``;
}

/** One page of a village's facts of one type, and the total with the same `WHERE`. */
export function listFactsQueries<T extends HeritageFactType>(
  query: HeritageListQuery<T>,
): { page: SQL; count: SQL } {
  const fact = FACTS[query.type];
  const from = sql`FROM ${sql.identifier(fact.table)} f
    JOIN ${claimsOf(query.type)} c ON c.claim_id = f.claim_id
    WHERE c.village_id = ${query.villageId} AND ${scopeFilter(query.scope)}
    ${valueFilter(query.type, query.filter)}`;
  return {
    page: sql`SELECT f.claim_id AS "claimId", ${fact.columns} ${from}
      ORDER BY ${fact.order}
      LIMIT ${query.size} OFFSET ${pageOffset(query)}`,
    count: sql`SELECT count(*)::int AS total ${from}`,
  };
}

/** Every preferred fact of one type of a village, in list order. */
export function preferredFactsQuery(type: HeritageFactType, villageId: string): SQL {
  const fact = FACTS[type];
  return sql`SELECT f.claim_id AS "claimId", ${fact.columns}
    FROM ${sql.identifier(fact.table)} f
    JOIN ${preferredClaimsOf(type)} pc ON pc.claim_id = f.claim_id
    WHERE pc.village_id = ${villageId}
    ORDER BY ${fact.order}`;
}

/** The value of one claim (by primary key). */
export function findFactQuery(type: HeritageFactType, claimId: string): SQL {
  const fact = FACTS[type];
  return sql`SELECT f.claim_id AS "claimId", ${fact.columns}
    FROM ${sql.identifier(fact.table)} f WHERE f.claim_id = ${claimId}`;
}

/** A point as a `geography`, or SQL NULL. */
export function pointSql(point: HeritagePoint | null): SQL {
  return point === null
    ? sql`NULL`
    : sql`ST_SetSRID(ST_MakePoint(${point.longitude}, ${point.latitude}), 4326)::geography`;
}
