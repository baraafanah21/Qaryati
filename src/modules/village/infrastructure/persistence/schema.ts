import { sql, type SQLWrapper } from 'drizzle-orm';
import {
  check,
  customType,
  date,
  foreignKey,
  index,
  numeric,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { versionColumns } from '../../../../platform/database/versioning';

const geographyPoint = customType<{ data: string; driverData: string }>({
  dataType: () => 'geography(Point,4326)',
});

/** Village identity and the display projections maintained with preferred claims. */
export const village = pgTable(
  'village',
  {
    id: uuid().primaryKey(),
    slug: text().notNull(),
    settlementStatus: text().notNull(),
    publicationStatus: text().notNull().default('DRAFT'),
    /** Projection of the preferred current Arabic name; written only by claim preference hooks. */
    displayNameAr: text().notNull(),
    /** Projection of the preferred current English name; written only by claim preference hooks. */
    displayNameEn: text(),
    /** Projection of the preferred location claim; written only by claim preference hooks. */
    location: geographyPoint(),
    createdBy: uuid().notNull(),
    ...versionColumns(),
  },
  (table) => [
    uniqueIndex('village_slug_key').on(table.slug),
    index('village_created_by_idx').on(table.createdBy),
    index('village_location_gist').using('gist', table.location),
    index('village_publication_display_name_ar_idx').on(
      table.publicationStatus,
      table.displayNameAr,
    ),
  ],
);

/** Administrative reference units, including self-parented historical units. Admin-managed, so edits need If-Match. */
export const adminUnit = pgTable(
  'admin_unit',
  {
    id: uuid().primaryKey(),
    code: text().notNull(),
    parentId: uuid(),
    unitType: text().notNull(),
    authorityType: text(),
    era: text().notNull().default('CURRENT'),
    nameAr: text().notNull(),
    nameEn: text(),
    ...versionColumns(),
  },
  (table) => [
    uniqueIndex('admin_unit_code_key').on(table.code),
    foreignKey({
      name: 'admin_unit_parent_id_fk',
      columns: [table.parentId],
      foreignColumns: [table.id],
    }).onDelete('restrict'),
    index('admin_unit_parent_id_idx').on(table.parentId),
    index('admin_unit_unit_type_era_idx').on(table.unitType, table.era),
  ],
);

/*
 * Fact tables (docs/data-model.md, "Fact tables: one pattern for all"). Each
 * row is the value of exactly one claim: `claim_id` is the key, `claim_type`
 * is a constant, and the composite foreign key `(claim_id, claim_type) ->
 * claim (id, claim_type) ON DELETE CASCADE` crosses into curation, so it is
 * raw SQL in the custom migration `village_claim_fks`. Value rules (allowed
 * values, ranges, lengths) live in `domain/village-facts.ts`, not in CHECKs.
 */

/** The structural columns of every fact table: one row per claim of `claimType`. */
function factColumns(claimType: string) {
  return {
    claimId: uuid().primaryKey(),
    claimType: text().notNull().default(claimType),
  };
}

/** The one CHECK a fact table has: its `claim_type` never changes. */
function claimTypeCheck(table: string, claimType: string, column: SQLWrapper) {
  return check(`${table}_claim_type_check`, sql`${column} = ${sql.raw(`'${claimType}'`)}`);
}

/** `VILLAGE_NAME`: one name of a village in one language. */
export const villageName = pgTable(
  'village_name',
  {
    ...factColumns('VILLAGE_NAME'),
    name: text().notNull(),
    nameNormalized: text().notNull(),
    lang: text().notNull(),
    nameType: text().notNull(),
    periodFromYear: smallint(),
    periodToYear: smallint(),
  },
  (table) => [claimTypeCheck('village_name', 'VILLAGE_NAME', table.claimType)],
);

/** `NAME_ORIGIN`: the meaning and origin of a village name. */
export const nameOrigin = pgTable(
  'name_origin',
  {
    ...factColumns('NAME_ORIGIN'),
    meaning: text().notNull(),
    originLanguage: text(),
    explanation: text(),
  },
  (table) => [claimTypeCheck('name_origin', 'NAME_ORIGIN', table.claimType)],
);

/** `AFFILIATION`: the administrative unit a village belonged to, and when. */
export const villageAffiliation = pgTable(
  'village_affiliation',
  {
    ...factColumns('AFFILIATION'),
    adminUnitId: uuid().notNull(),
    validFrom: date({ mode: 'string' }),
    validTo: date({ mode: 'string' }),
  },
  (table) => [
    claimTypeCheck('village_affiliation', 'AFFILIATION', table.claimType),
    foreignKey({
      name: 'village_affiliation_admin_unit_id_fk',
      columns: [table.adminUnitId],
      foreignColumns: [adminUnit.id],
    }).onDelete('restrict'),
    index('village_affiliation_admin_unit_id_idx').on(table.adminUnitId),
  ],
);

/** `LOCATION`: a WGS 84 point. Written with native SQL (`ST_MakePoint`). */
export const villageLocation = pgTable(
  'village_location',
  {
    ...factColumns('LOCATION'),
    point: geographyPoint().notNull(),
    precision: text().notNull(),
    description: text(),
  },
  (table) => [claimTypeCheck('village_location', 'LOCATION', table.claimType)],
);

/** `MEASURE`: a measured quantity (elevation in metres, area in dunum). */
export const villageMeasure = pgTable(
  'village_measure',
  {
    ...factColumns('MEASURE'),
    kind: text().notNull(),
    value: numeric({ mode: 'number' }).notNull(),
  },
  (table) => [claimTypeCheck('village_measure', 'MEASURE', table.claimType)],
);

/** `RELATION`: how this village relates to another village. */
export const villageRelation = pgTable(
  'village_relation',
  {
    ...factColumns('RELATION'),
    relatedVillageId: uuid().notNull(),
    relationType: text().notNull(),
  },
  (table) => [
    claimTypeCheck('village_relation', 'RELATION', table.claimType),
    foreignKey({
      name: 'village_relation_related_village_id_fk',
      columns: [table.relatedVillageId],
      foreignColumns: [village.id],
    }).onDelete('restrict'),
    index('village_relation_related_village_id_idx').on(table.relatedVillageId),
  ],
);
