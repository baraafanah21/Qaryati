import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  foreignKey,
  index,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { versionColumns } from '../../../../platform/database/versioning';

/**
 * Drizzle tables owned by the economy module.
 *
 * drizzle.config.ts picks this file up by its path, so tables declared here
 * land in the generated migrations. Only this module edits this file; other
 * modules reach the data through `index.ts`. See docs/database.md.
 *
 * `product` is reference data (seeded by a data migration). `village_product`
 * and `facility` are fact tables (docs/data-model.md, "Fact tables: one
 * pattern for all"): the value of exactly one claim of their type. The
 * composite foreign keys `(claim_id, claim_type) -> claim` are cross-module,
 * so they are raw SQL in the `economy_claim_fks` migration. Categories,
 * significances, facility types, the name length and the year range are domain
 * rules (`domain/economy-values.ts`), not CHECKs; the only CHECK is the
 * constant type.
 */

/** A WGS 84 point. Written and read with native SQL (`ST_MakePoint`, `ST_X`/`ST_Y`). */
const geographyPoint = customType<{ data: string; driverData: string }>({
  dataType: () => 'geography(Point,4326)',
});

/** Products a village can be known for (olives, embroidery, ...). Reference data, not claims. */
export const product = pgTable(
  'product',
  {
    id: uuid().primaryKey(),
    code: text().notNull(),
    category: text().notNull(),
    nameAr: text().notNull(),
    nameEn: text().notNull(),
    ...versionColumns(),
  },
  (table) => [
    uniqueIndex('product_code_key').on(table.code),
    index('product_category_idx').on(table.category),
  ],
);

/** `VILLAGE_PRODUCT`: the village produces `product_id`, with a significance. */
export const villageProduct = pgTable(
  'village_product',
  {
    claimId: uuid().primaryKey(),
    claimType: text().notNull().default('VILLAGE_PRODUCT'),
    productId: uuid().notNull(),
    significance: text().notNull(),
  },
  (table) => [
    check('village_product_claim_type_check', sql`${table.claimType} = 'VILLAGE_PRODUCT'`),
    // A product named by a claim cannot be deleted: claims are history.
    foreignKey({
      name: 'village_product_product_id_fk',
      columns: [table.productId],
      foreignColumns: [product.id],
    }).onDelete('restrict'),
    // The foreign key, and GET /products/{idOrCode}/villages.
    index('village_product_product_id_idx').on(table.productId),
  ],
);

/** `FACILITY`: a community facility, with an optional point (GiST for distance queries). */
export const facility = pgTable(
  'facility',
  {
    claimId: uuid().primaryKey(),
    claimType: text().notNull().default('FACILITY'),
    facilityType: text().notNull(),
    name: text().notNull(),
    location: geographyPoint(),
    establishedYear: smallint(),
  },
  (table) => [
    check('facility_claim_type_check', sql`${table.claimType} = 'FACILITY'`),
    index('facility_location_gist').using('gist', table.location),
  ],
);
