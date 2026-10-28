import {
  customType,
  foreignKey,
  index,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { versionColumns } from '../../../../platform/database/versioning';

const geographyPoint = customType<{ data: string; driverData: string }>({
  dataType: () => 'geography(Point,4326)',
});

const villageKernelVersionColumns = (() => {
  const columns = versionColumns();
  return {
    version: columns.version,
    createdAt: columns.createdAt,
    updatedAt: columns.updatedAt,
  };
})();

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
    ...villageKernelVersionColumns,
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

/** Administrative reference units, including self-parented historical units. */
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
