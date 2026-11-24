import { randomUUID } from 'node:crypto';
import { CURRENT_GOVERNORATES } from '../../src/modules/village/infrastructure/seed/governorates';
import { SEED_PRODUCTS } from '../../src/modules/economy/infrastructure/seed/products';

/** Anything with pg's `query` (a Client or a Pool), connected as the owner role. */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<unknown>;
}

/** A governorate and a product that the migrations seed. */
export const SEEDED_UNIT = CURRENT_GOVERNORATES.find((g) => g.code === 'nablus')!;
export const SEEDED_PRODUCT = SEED_PRODUCTS.find((p) => p.code === 'olives')!;

/**
 * The fact row of each claim type: an INSERT for `$1` (claim id), and `$2`
 * (a text that tells rows apart, e.g. a landmark name) where the type has one.
 * The values are valid for the domain, so the facades read them back.
 */
const FACT_ROWS = {
  VILLAGE_NAME: `INSERT INTO village_name (claim_id, name, name_normalized, lang, name_type)
    VALUES ($1, $2, $2, 'ar', 'CURRENT')`,
  NAME_ORIGIN: `INSERT INTO name_origin (claim_id, meaning, origin_language, explanation)
    VALUES ($1, $2, 'Aramaic', NULL)`,
  AFFILIATION: `INSERT INTO village_affiliation (claim_id, admin_unit_id, valid_from, valid_to)
    VALUES ($1, '${SEEDED_UNIT.id}', '1995-01-01', NULL)`,
  LOCATION: `INSERT INTO village_location (claim_id, point, precision, description)
    VALUES ($1, ST_SetSRID(ST_MakePoint(35.25, 32.22), 4326)::geography, 'EXACT', $2)`,
  MEASURE: `INSERT INTO village_measure (claim_id, kind, value) VALUES ($1, 'ELEVATION_M', 550)`,
  RELATION: `INSERT INTO village_relation (claim_id, related_village_id, relation_type)
    VALUES ($1, $2, 'ADJACENT')`,
  POPULATION: `INSERT INTO population_record (claim_id, population, reference_year, count_type)
    VALUES ($1, 1200, $2::smallint, 'CENSUS')`,
  HISTORY_OVERVIEW: `INSERT INTO history_overview (claim_id, summary) VALUES ($1, $2)`,
  HISTORICAL_EVENT: `INSERT INTO historical_event
      (claim_id, title, description, start_date, end_date, date_precision)
    VALUES ($1, $2, 'What happened.', '1948-05-01', NULL, 'MONTH')`,
  LANDMARK: `INSERT INTO landmark (claim_id, name, landmark_type, description, location, era)
    VALUES ($1, $2, 'MOSQUE', NULL, NULL, NULL)`,
  CULTURAL_ITEM: `INSERT INTO cultural_item (claim_id, category, name, description)
    VALUES ($1, 'DISH', $2, 'A dish.')`,
  VILLAGE_PRODUCT: `INSERT INTO village_product (claim_id, product_id, significance)
    VALUES ($1, '${SEEDED_PRODUCT.id}', 'PRIMARY')`,
  FACILITY: `INSERT INTO facility (claim_id, facility_type, name, location, established_year)
    VALUES ($1, 'SCHOOL', $2, NULL, 1950)`,
} as const;

export type SeedClaimType = keyof typeof FACT_ROWS;
export const SEED_CLAIM_TYPES = Object.keys(FACT_ROWS) as SeedClaimType[];

/**
 * Inserts a claim and its fact row directly, as the owner role: fast setup
 * for read tests that do not exercise the review workflow. A preferred claim
 * is VERIFIED with a source (the database CHECKs demand both). `text` fills
 * the type's distinguishing column; a RELATION takes the related village id,
 * a POPULATION its reference year (default 1945).
 */
export async function seedClaim(
  db: Queryable,
  input: {
    type: SeedClaimType;
    villageId: string;
    sourceId: string;
    authorId: string;
    preferred?: boolean;
    text?: string;
  },
): Promise<string> {
  const claimId = randomUUID();
  const preferred = input.preferred ?? true;
  await db.query(
    `INSERT INTO claim (id, claim_type, village_id, group_key, value_hash, source_id, status,
       is_preferred, created_by, reviewed_at, version, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1, now(), now())`,
    [
      claimId,
      input.type,
      input.villageId,
      `seed|${claimId}`,
      `hash-${claimId}`,
      input.sourceId,
      preferred ? 'VERIFIED' : 'UNVERIFIED',
      preferred,
      input.authorId,
      preferred ? new Date('2026-11-01T09:00:00Z') : null,
    ],
  );
  const sql = FACT_ROWS[input.type];
  // A population row's `$2` is its reference year.
  const fallback = input.type === 'POPULATION' ? '1945' : `${input.type} ${claimId.slice(0, 8)}`;
  const text = input.text ?? fallback;
  await db.query(sql, sql.includes('$2') ? [claimId, text] : [claimId]);
  return claimId;
}
