import * as argon2 from 'argon2';
import { v5 as uuidv5 } from 'uuid';
import { roundCoordinate } from '../../modules/curation';
import { SEED_PRODUCTS } from '../../modules/economy/infrastructure/seed/products';
import { villageProductClaim } from '../../modules/economy/domain/economy-claims';
import { landmarkClaim } from '../../modules/heritage/domain/heritage-claims';
import { populationClaim } from '../../modules/population/domain/population-claim';
import { normalizeName } from '../../modules/village';
import {
  affiliationClaim,
  locationClaim,
  villageNameClaim,
} from '../../modules/village/domain/fact-claims';
import { CURRENT_GOVERNORATES } from '../../modules/village/infrastructure/seed/governorates';
import { DEV_SEED_PASSWORD } from '../dev/dev-seed';
import { generatePerfVillages, type PerfVillage } from './perf-generator';

/** Anything with pg's `query`, connected as the owner role. */
export interface OwnerDb {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/** Namespace of the perf seed's name-based (v5) ids: the same row always gets the same id. */
const PERF_NAMESPACE = '6f1d3c1e-5a0b-4e8e-9a43-1d2f0c7b9e55';
const id = (name: string) => uuidv5(`qaryati-perf:${name}`, PERF_NAMESPACE);

export const PERF_USERS = {
  author: { id: id('user:author'), email: 'perf-author@qaryati.test', role: 'CONTRIBUTOR' },
  editor: { id: id('user:editor'), email: 'perf-editor@qaryati.test', role: 'EDITOR' },
} as const;

/** Three synthetic sources; their titles say what they are. */
const PERF_SOURCES = {
  places: {
    id: id('source:places'),
    type: 'ARCHIVE',
    title: 'Synthetic perf dataset: names and places',
  },
  population: {
    id: id('source:population'),
    type: 'CENSUS',
    title: 'Synthetic perf dataset: population series',
  },
  heritage: {
    id: id('source:heritage'),
    type: 'ARCHIVE',
    title: 'Synthetic perf dataset: heritage and economy',
  },
} as const;

/** All claims date from here, one minute apart per village: deterministic timestamps. */
const BASE_TIME = Date.UTC(2026, 0, 1);

type Row = Record<string, unknown>;

/** Every row the seed writes, by table, in insertion order (claims before their facts). */
export interface PerfRows {
  village: Row[];
  claim: Row[];
  village_name: Row[];
  village_location: Row[];
  village_affiliation: Row[];
  population_record: Row[];
  landmark: Row[];
  village_product: Row[];
}

/**
 * Turns generated villages into rows. Every fact is a VERIFIED, preferred claim
 * written by the perf author and reviewed by the perf editor (four eyes), with
 * `group_key` and `value_hash` from the owning modules' own pure functions, so
 * the rows are exactly what the API would have written. The village projections
 * (`display_name_ar/en`, `location`) equal their preferred claims.
 */
export function buildPerfRows(villages: readonly PerfVillage[]): PerfRows {
  const governorates = new Map<string, string>(CURRENT_GOVERNORATES.map((g) => [g.code, g.id]));
  const products = new Map<string, string>(SEED_PRODUCTS.map((p) => [p.code, p.id]));
  const rows: PerfRows = {
    village: [],
    claim: [],
    village_name: [],
    village_location: [],
    village_affiliation: [],
    population_record: [],
    landmark: [],
    village_product: [],
  };

  for (const v of villages) {
    const villageId = id(`village:${v.slug}`);
    const created = new Date(BASE_TIME + v.index * 60_000);
    const reviewed = new Date(created.getTime() + 3_600_000);
    rows.village.push({
      id: villageId,
      slug: v.slug,
      settlement_status: v.settlementStatus,
      publication_status: 'PUBLISHED',
      display_name_ar: v.nameAr,
      display_name_en: v.nameEn,
      latitude: v.latitude,
      longitude: v.longitude,
      created_by: PERF_USERS.author.id,
      version: 4,
      created_at: created.toISOString(),
      updated_at: reviewed.toISOString(),
    });

    let n = 0;
    const claim = (
      key: { claimType: string; groupKey: string; valueHash: string },
      sourceId: string,
    ): string => {
      const claimId = id(`claim:${v.slug}:${n++}`);
      rows.claim.push({
        id: claimId,
        claim_type: key.claimType,
        village_id: villageId,
        group_key: key.groupKey,
        value_hash: key.valueHash,
        source_id: sourceId,
        status: 'VERIFIED',
        is_preferred: true,
        created_by: PERF_USERS.author.id,
        reviewed_by: PERF_USERS.editor.id,
        reviewed_at: reviewed.toISOString(),
        version: 2,
        created_at: created.toISOString(),
        updated_at: reviewed.toISOString(),
      });
      return claimId;
    };

    for (const [name, lang] of [
      [v.nameAr, 'ar'],
      [v.nameEn, 'en'],
    ] as const) {
      const value = {
        name,
        nameNormalized: normalizeName(name),
        lang,
        nameType: 'CURRENT' as const,
        periodFromYear: null,
        periodToYear: null,
      };
      const claimId = claim(villageNameClaim(villageId, value), PERF_SOURCES.places.id);
      rows.village_name.push({
        claim_id: claimId,
        name,
        name_normalized: value.nameNormalized,
        lang,
        name_type: 'CURRENT',
      });
    }

    const location = {
      latitude: roundCoordinate(v.latitude),
      longitude: roundCoordinate(v.longitude),
      precision: 'APPROXIMATE' as const,
      description: null,
    };
    rows.village_location.push({
      claim_id: claim(locationClaim(villageId, location), PERF_SOURCES.places.id),
      latitude: location.latitude,
      longitude: location.longitude,
      precision: location.precision,
    });

    const adminUnitId = governorates.get(v.governorate);
    if (!adminUnitId) throw new Error(`Unknown governorate ${v.governorate}`);
    rows.village_affiliation.push({
      claim_id: claim(
        affiliationClaim(villageId, {
          adminUnitId,
          validFrom: null,
          validTo: null,
          unitType: 'GOVERNORATE',
          era: 'CURRENT',
        }),
        PERF_SOURCES.places.id,
      ),
      admin_unit_id: adminUnitId,
    });

    for (const p of v.population) {
      rows.population_record.push({
        claim_id: claim(populationClaim(villageId, p), PERF_SOURCES.population.id),
        population: p.population,
        reference_year: p.referenceYear,
        count_type: p.countType,
      });
    }

    for (const l of v.landmarks) {
      const value = {
        name: l.name,
        landmarkType: l.landmarkType as Parameters<typeof landmarkClaim>[1]['landmarkType'],
        description: l.description,
        location: { latitude: l.latitude, longitude: l.longitude },
        era: l.era as Parameters<typeof landmarkClaim>[1]['era'],
      };
      rows.landmark.push({
        claim_id: claim(landmarkClaim(villageId, value), PERF_SOURCES.heritage.id),
        name: l.name,
        landmark_type: l.landmarkType,
        description: l.description,
        latitude: l.latitude,
        longitude: l.longitude,
        era: l.era,
      });
    }

    for (const p of v.products) {
      const productId = products.get(p.code);
      if (!productId) throw new Error(`Unknown product ${p.code}`);
      rows.village_product.push({
        claim_id: claim(
          villageProductClaim(villageId, { productId, significance: p.significance }),
          PERF_SOURCES.heritage.id,
        ),
        product_id: productId,
        significance: p.significance,
      });
    }
  }
  return rows;
}

/** Rows per statement: large enough to be fast, small enough for one JSON parameter. */
const BATCH = 2000;

/**
 * One `INSERT ... SELECT FROM jsonb_to_recordset($1)` per table and batch:
 * a whole batch in one bound parameter, no string concatenation of values.
 * `ON CONFLICT DO NOTHING` with the deterministic ids makes a second run a no-op.
 */
const INSERTS: Record<keyof PerfRows, { columns: string; select: string; from: string }> = {
  village: {
    columns:
      'id, slug, settlement_status, publication_status, display_name_ar, display_name_en, ' +
      'location, created_by, version, created_at, updated_at',
    select:
      'id, slug, settlement_status, publication_status, display_name_ar, display_name_en, ' +
      'ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography, created_by, version, ' +
      'created_at, updated_at',
    from:
      'id uuid, slug text, settlement_status text, publication_status text, display_name_ar text, ' +
      'display_name_en text, latitude float8, longitude float8, created_by uuid, version int, ' +
      'created_at timestamptz, updated_at timestamptz',
  },
  claim: {
    columns:
      'id, claim_type, village_id, group_key, value_hash, source_id, status, is_preferred, ' +
      'created_by, reviewed_by, reviewed_at, version, created_at, updated_at',
    select:
      'id, claim_type, village_id, group_key, value_hash, source_id, status, is_preferred, ' +
      'created_by, reviewed_by, reviewed_at, version, created_at, updated_at',
    from:
      'id uuid, claim_type text, village_id uuid, group_key text, value_hash text, source_id uuid, ' +
      'status text, is_preferred boolean, created_by uuid, reviewed_by uuid, ' +
      'reviewed_at timestamptz, version int, created_at timestamptz, updated_at timestamptz',
  },
  village_name: {
    columns: 'claim_id, name, name_normalized, lang, name_type',
    select: 'claim_id, name, name_normalized, lang, name_type',
    from: 'claim_id uuid, name text, name_normalized text, lang text, name_type text',
  },
  village_location: {
    columns: 'claim_id, point, precision',
    select: 'claim_id, ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography, precision',
    from: 'claim_id uuid, latitude float8, longitude float8, precision text',
  },
  village_affiliation: {
    columns: 'claim_id, admin_unit_id',
    select: 'claim_id, admin_unit_id',
    from: 'claim_id uuid, admin_unit_id uuid',
  },
  population_record: {
    columns: 'claim_id, population, reference_year, count_type',
    select: 'claim_id, population, reference_year, count_type',
    from: 'claim_id uuid, population int, reference_year smallint, count_type text',
  },
  landmark: {
    columns: 'claim_id, name, landmark_type, description, location, era',
    select:
      'claim_id, name, landmark_type, description, ' +
      'ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography, era',
    from:
      'claim_id uuid, name text, landmark_type text, description text, latitude float8, ' +
      'longitude float8, era text',
  },
  village_product: {
    columns: 'claim_id, product_id, significance',
    select: 'claim_id, product_id, significance',
    from: 'claim_id uuid, product_id uuid, significance text',
  },
};

/** The tables the report counts (whole tables, whatever wrote the rows). */
export const COUNTED_TABLES = [
  'village',
  'claim',
  'village_name',
  'village_location',
  'village_affiliation',
  'population_record',
  'landmark',
  'village_product',
  'source',
  'user_account',
  'audit_entry',
] as const;

export interface PerfSeedReport {
  villages: number;
  inserted: Record<keyof PerfRows, number>;
  tableCounts: Record<(typeof COUNTED_TABLES)[number], number>;
}

/**
 * `npm run db:seed:perf`: bulk-loads `count` synthetic villages as the owner
 * role in one transaction, then `ANALYZE`s, so the planner sees the real sizes
 * before a measurement. Not through the API on purpose (speed), and therefore
 * not audited: it is a fixture loader for load tests, not a user action.
 */
export async function seedPerf(owner: OwnerDb, count: number): Promise<PerfSeedReport> {
  const rows = buildPerfRows(generatePerfVillages(count));
  const passwordHash = await argon2.hash(DEV_SEED_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  const inserted = Object.fromEntries(Object.keys(INSERTS).map((t) => [t, 0])) as Record<
    keyof PerfRows,
    number
  >;

  await owner.query('BEGIN');
  try {
    for (const user of Object.values(PERF_USERS)) {
      await owner.query(
        `INSERT INTO user_account (id, email, password_hash, role, status, version, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'ACTIVE', 1, now(), now()) ON CONFLICT DO NOTHING`,
        [user.id, user.email, passwordHash, user.role],
      );
    }
    for (const source of Object.values(PERF_SOURCES)) {
      await owner.query(
        `INSERT INTO source (id, source_type, title, reliability, notes, created_by, version, created_at, updated_at)
         VALUES ($1, $2, $3, 1, $4, $5, 1, now(), now()) ON CONFLICT DO NOTHING`,
        [
          source.id,
          source.type,
          source.title,
          'Generated by npm run db:seed:perf for load tests; not real data.',
          PERF_USERS.author.id,
        ],
      );
    }
    for (const table of Object.keys(INSERTS) as (keyof PerfRows)[]) {
      const { columns, select, from } = INSERTS[table];
      for (let i = 0; i < rows[table].length; i += BATCH) {
        const batch = rows[table].slice(i, i + BATCH);
        const result = await owner.query(
          `WITH ins AS (
             INSERT INTO ${table} (${columns})
             SELECT ${select} FROM jsonb_to_recordset($1::jsonb) AS r(${from})
             ON CONFLICT DO NOTHING RETURNING 1)
           SELECT count(*)::int AS n FROM ins`,
          [JSON.stringify(batch)],
        );
        inserted[table] += Number(result.rows[0]?.n ?? 0);
      }
    }
    await owner.query('COMMIT');
  } catch (error) {
    await owner.query('ROLLBACK');
    throw error;
  }
  await owner.query(`ANALYZE ${COUNTED_TABLES.join(', ')}`);

  const tableCounts = {} as PerfSeedReport['tableCounts'];
  for (const table of COUNTED_TABLES) {
    const result = await owner.query(`SELECT count(*)::int AS n FROM ${table}`);
    tableCounts[table] = Number(result.rows[0]?.n ?? 0);
  }
  return { villages: count, inserted, tableCounts };
}
