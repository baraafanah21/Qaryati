import { sql, type SQL } from 'drizzle-orm';
import type { ClaimType } from '../domain/claim-values';

/**
 * A derived table `(claim_id, village_id)` of the preferred (published) claims
 * of one type, for an owning module's native SQL. Alias it and join it to the
 * fact table by `claim_id`:
 *
 * ```ts
 * sql`SELECT pn.village_id FROM village_name vn
 *     JOIN ${preferredClaimsOf('VILLAGE_NAME')} pn ON pn.claim_id = vn.claim_id`
 * ```
 *
 * Why it exists: a list query (village search, #30) has to filter and rank by
 * preferred facts of many villages in one statement, which the page-per-village
 * `ClaimQueries.listForVillage` cannot do. Curation keeps the SQL that reads
 * `claim`, so the owner never names curation's table or columns itself. Joined
 * by `village_id`, it reads the partial index `claim_village_published`;
 * joined by `claim_id`, the primary key.
 */
export function preferredClaimsOf(claimType: ClaimType): SQL {
  return sql`(SELECT id AS claim_id, village_id FROM claim
    WHERE claim_type = ${claimType} AND is_preferred)`;
}

/**
 * A derived table `(claim_id, village_id, is_preferred, created_by)` of every
 * claim of one type, whatever its status, for an owner that pages its own
 * fact rows in its own order (population lists by year, #28) and must also
 * show unverified claims to editors and authors. Filter it by `village_id`
 * (index `claim_village_id_idx`); curation still keeps the SQL that reads `claim`.
 */
export function claimsOf(claimType: ClaimType): SQL {
  return sql`(SELECT id AS claim_id, village_id, is_preferred, created_by FROM claim
    WHERE claim_type = ${claimType})`;
}
