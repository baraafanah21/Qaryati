import { sql, type SQL } from 'drizzle-orm';
import { pageOffset } from '../../../shared/kernel';
import { preferredClaimsOf } from '../../curation';
import type { VillageSearchCriteria, VillageSortField } from '../domain/village-search';

// The allow-list again, now as SQL: the only way a sort field reaches the query.
const SORT_SQL: Record<VillageSortField, SQL> = {
  nameAr: sql`v.display_name_ar`,
  nameEn: sql`v.display_name_en`,
  createdAt: sql`v.created_at`,
  relevance: sql`relevance`,
};

/**
 * The statements of `GET /villages` (#30). Built only from bound parameters and
 * fixed fragments, never by concatenating input. Exported so an integration
 * test can `EXPLAIN` exactly what runs.
 *
 * - `page` is the only statement of a normal request: the rows of the page
 *   **and** the total, as `count(*) OVER ()`. The window counts every matching
 *   row before `LIMIT`, so the trigram matching runs once per request (#50:
 *   it ran twice, once more for a separate `count(*)`, and that second run
 *   was half of the database time of the read test; docs/performance.md).
 * - `count` is the total alone, with the same `WHERE`. It runs only when a
 *   page after the last one comes back empty, so no row carries the total.
 *
 * - `q` (already normalized) matches with the pg_trgm `%` operator on
 *   `display_name_ar`, `display_name_en` and the **preferred** names in
 *   `village_name.name_normalized`. The three are a `UNION` of id lists, so
 *   each branch uses its own GIN trigram index (an `OR` across tables could
 *   not). `relevance` is the best `similarity` of the three.
 * - `governorate` matches the admin unit of a **preferred** `AFFILIATION`.
 * - Preferred claims come from curation's `preferredClaimsOf`, so this module
 *   never names the `claim` table.
 */
export function villageSearchQueries(criteria: VillageSearchCriteria): {
  page: SQL;
  count: SQL;
} {
  const { q } = criteria;
  const preferredNames = preferredClaimsOf('VILLAGE_NAME');
  const filters: SQL[] = [];

  if (criteria.publicationStatus !== undefined) {
    filters.push(sql`v.publication_status = ${criteria.publicationStatus}`);
  }
  if (criteria.settlementStatus !== undefined) {
    filters.push(sql`v.settlement_status = ${criteria.settlementStatus}`);
  }
  if (criteria.villageIds !== undefined) {
    // One array parameter, so the statement text does not change with the list length.
    filters.push(sql`v.id = ANY(${sql.param([...criteria.villageIds])}::uuid[])`);
  }
  if (criteria.governorateId !== undefined) {
    filters.push(sql`v.id IN (
      SELECT pa.village_id
      FROM village_affiliation va
      JOIN ${preferredClaimsOf('AFFILIATION')} pa ON pa.claim_id = va.claim_id
      WHERE va.admin_unit_id = ${criteria.governorateId})`);
  }
  if (q !== undefined) {
    filters.push(sql`v.id IN (
      SELECT id FROM village WHERE display_name_ar % ${q}
      UNION
      SELECT id FROM village WHERE display_name_en % ${q}
      UNION
      SELECT pn.village_id
      FROM village_name vn
      JOIN ${preferredNames} pn ON pn.claim_id = vn.claim_id
      WHERE vn.name_normalized % ${q})`);
  }

  const where = filters.length > 0 ? sql`WHERE ${sql.join(filters, sql` AND `)}` : sql``;
  const relevance =
    q === undefined
      ? sql`NULL::real`
      : sql`GREATEST(
          similarity(v.display_name_ar, ${q}),
          COALESCE(similarity(v.display_name_en, ${q}), 0),
          COALESCE((
            SELECT max(similarity(vn.name_normalized, ${q}))
            FROM village_name vn
            JOIN ${preferredNames} pn ON pn.claim_id = vn.claim_id
            WHERE pn.village_id = v.id), 0))`;
  const order = sql.join(
    criteria.sort.map(
      (sort) =>
        sql`${SORT_SQL[sort.field]} ${sort.direction === 'asc' ? sql`ASC` : sql`DESC`} NULLS LAST`,
    ),
    sql`, `,
  );

  return {
    page: sql`
      SELECT v.id, v.slug, v.settlement_status, v.publication_status,
             v.display_name_ar, v.display_name_en, v.created_at,
             ST_Y(v.location::geometry) AS latitude,
             ST_X(v.location::geometry) AS longitude,
             ${relevance} AS relevance,
             count(*) OVER ()::int AS total
      FROM village v
      ${where}
      ORDER BY ${order}, v.id
      LIMIT ${criteria.size} OFFSET ${pageOffset(criteria)}`,
    count: sql`SELECT count(*)::int AS total FROM village v ${where}`,
  };
}
