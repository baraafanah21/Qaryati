import { sql, type SQL } from 'drizzle-orm';
import { pageOffset } from '../../../shared/kernel';
import { claimsOf, preferredClaimsOf } from '../../curation';
import type { EconomyClaimScope, EconomyListQuery } from '../domain/economy-fact.repository';
import type { EconomyFactFilters, EconomyFactType, EconomyPoint } from '../domain/economy-facts';

// The native statements of the economy module. Built only from bound
// parameters and fixed fragments, never by concatenating input; exported so the
// integration tests can run and EXPLAIN exactly what the repository runs.
// Claim state comes from curation's fragments, so the `claim` table is never named here.

/** Per type: the table, a join for the order, its value columns (on alias `f`) and its list order. */
const FACTS: Record<EconomyFactType, { table: string; join: SQL; columns: SQL; order: SQL }> = {
  VILLAGE_PRODUCT: {
    table: 'village_product',
    // Ordered by the product's English name: products are few and the join is by primary key.
    join: sql`JOIN product p ON p.id = f.product_id`,
    columns: sql`f.product_id AS "productId", f.significance`,
    order: sql`p.name_en, f.claim_id`,
  },
  FACILITY: {
    table: 'facility',
    join: sql``,
    columns: sql`f.facility_type AS "facilityType", f.name,
      f.established_year AS "establishedYear",
      ST_Y(f.location::geometry) AS latitude, ST_X(f.location::geometry) AS longitude`,
    order: sql`f.facility_type, f.name, f.claim_id`,
  },
};

/** Which claims of `scope` a reader sees, on the alias `c` of `claimsOf`. */
function scopeFilter(scope: EconomyClaimScope): SQL {
  switch (scope.kind) {
    case 'PREFERRED':
      return sql`c.is_preferred`;
    case 'ALL':
      return sql`TRUE`;
    case 'PREFERRED_OR_OWN':
      return sql`(c.is_preferred OR c.created_by = ${scope.userId})`;
  }
}

/** The `?type=` filter of the facilities list, or nothing. */
function valueFilter<T extends EconomyFactType>(type: T, filter: EconomyFactFilters[T]): SQL {
  if (type === 'FACILITY') {
    const { facilityType } = filter as EconomyFactFilters['FACILITY'];
    if (facilityType) return sql`AND f.facility_type = ${facilityType}`;
  }
  return sql``;
}

/** One page of a village's facts of one type, and the total with the same `WHERE`. */
export function listFactsQueries<T extends EconomyFactType>(
  query: EconomyListQuery<T>,
): { page: SQL; count: SQL } {
  const fact = FACTS[query.type];
  const where = sql`WHERE c.village_id = ${query.villageId} AND ${scopeFilter(query.scope)}
    ${valueFilter(query.type, query.filter)}`;
  const claims = sql`JOIN ${claimsOf(query.type)} c ON c.claim_id = f.claim_id`;
  return {
    page: sql`SELECT f.claim_id AS "claimId", ${fact.columns}
      FROM ${sql.identifier(fact.table)} f ${claims} ${fact.join} ${where}
      ORDER BY ${fact.order}
      LIMIT ${query.size} OFFSET ${pageOffset(query)}`,
    count: sql`SELECT count(*)::int AS total FROM ${sql.identifier(fact.table)} f ${claims} ${where}`,
  };
}

/** Every preferred fact of one type of a village, in list order. */
export function preferredFactsQuery(type: EconomyFactType, villageId: string): SQL {
  const fact = FACTS[type];
  return sql`SELECT f.claim_id AS "claimId", ${fact.columns}
    FROM ${sql.identifier(fact.table)} f
    JOIN ${preferredClaimsOf(type)} pc ON pc.claim_id = f.claim_id
    ${fact.join}
    WHERE pc.village_id = ${villageId}
    ORDER BY ${fact.order}`;
}

/** The value of one claim (by primary key). */
export function findFactQuery(type: EconomyFactType, claimId: string): SQL {
  const fact = FACTS[type];
  return sql`SELECT f.claim_id AS "claimId", ${fact.columns}
    FROM ${sql.identifier(fact.table)} f WHERE f.claim_id = ${claimId}`;
}

/**
 * The villages with a preferred `VILLAGE_PRODUCT` claim for one product: the
 * product's rows by `village_product_product_id_idx`, each joined to its claim
 * by primary key. One row per village: the question `product|v|product_id`
 * has at most one preferred claim (`claim_one_preferred`).
 */
export function villageIdsWithProductQuery(productId: string): SQL {
  return sql`SELECT pc.village_id AS "villageId"
    FROM village_product f
    JOIN ${preferredClaimsOf('VILLAGE_PRODUCT')} pc ON pc.claim_id = f.claim_id
    WHERE f.product_id = ${productId}`;
}

/** A point as a `geography`, or SQL NULL. */
export function pointSql(point: EconomyPoint | null): SQL {
  return point === null
    ? sql`NULL`
    : sql`ST_SetSRID(ST_MakePoint(${point.longitude}, ${point.latitude}), 4326)::geography`;
}
