import { z } from 'zod';
import { CLAIM_STATUSES } from '../../curation';
import { PUBLICATION_STATUSES, SETTLEMENT_STATUSES, type VillageSortField } from '../../village';
import { paginationQuery, sortQuery } from '../../../platform/http/pagination';
import {
  FACILITY_NAME_MAX,
  FACILITY_TYPES,
  PRODUCT_CATEGORIES,
  PRODUCT_SIGNIFICANCES,
} from '../domain/economy-values';

// Shape limits only. The domain owns the rules: name length after
// normalization (so the cap here is twice the domain limit), coordinate
// ranges and the established year range (all 422).

/** Where a fact comes from. */
const source = {
  sourceId: z.uuid().nullable().optional(),
  sourceLocator: z.string().min(1).max(500).nullable().optional(),
};
/** ... and, on submit, the claim it corrects. */
const provenance = { ...source, supersedesId: z.uuid().nullable().optional() };

const point = z.strictObject({ latitude: z.number(), longitude: z.number() });

const villageProductFields = {
  productId: z.uuid(),
  significance: z.enum(PRODUCT_SIGNIFICANCES),
};
const facilityFields = {
  facilityType: z.enum(FACILITY_TYPES),
  name: z
    .string()
    .min(1)
    .max(FACILITY_NAME_MAX * 2),
  location: point.nullable().optional(),
  establishedYear: z.int().nullable().optional(),
};

/** Every field optional: a PATCH changes only what it names. */
const partial = <S extends z.ZodRawShape>(shape: S) =>
  z.strictObject({ ...shape, ...source }).partial();

export const createVillageProductBody = z.strictObject({ ...villageProductFields, ...provenance });
export type CreateVillageProductBody = z.infer<typeof createVillageProductBody>;
export const updateVillageProductBody = partial(villageProductFields);
export type UpdateVillageProductBody = z.infer<typeof updateVillageProductBody>;

export const createFacilityBody = z.strictObject({ ...facilityFields, ...provenance });
export type CreateFacilityBody = z.infer<typeof createFacilityBody>;
export const updateFacilityBody = partial(facilityFields);
export type UpdateFacilityBody = z.infer<typeof updateFacilityBody>;

/** `?page=&size=&includeUnverified=`. */
export const listEconomyQuery = paginationQuery.extend({
  includeUnverified: z
    .stringbool()
    .default(false)
    .describe('EDITOR+: every claim with its status; other logged-in users: their own claims too.'),
});
export type ListEconomyQuery = z.infer<typeof listEconomyQuery>;

export const listFacilitiesQuery = listEconomyQuery.extend({
  type: z.enum(FACILITY_TYPES).optional(),
});
export type ListFacilitiesQuery = z.infer<typeof listFacilitiesQuery>;

/** `GET /products?category=`. */
export const listProductsQuery = z.strictObject({
  category: z.enum(PRODUCT_CATEGORIES).optional(),
});
export type ListProductsQuery = z.infer<typeof listProductsQuery>;

/** `{idOrCode}`: a UUID or a product code such as `olive-oil`. */
export const productIdOrCodeParam = z.string().min(1).max(120);

/** The village sorts that make sense without a text query (no `relevance`). */
export const PRODUCT_VILLAGE_SORT_FIELDS = [
  'nameAr',
  'nameEn',
  'createdAt',
] as const satisfies readonly VillageSortField[];

/** `GET /products/{idOrCode}/villages?page=&size=&sort=`; the default sort is the Arabic name. */
export const productVillagesQuery = paginationQuery.extend({
  sort: sortQuery(PRODUCT_VILLAGE_SORT_FIELDS),
});
export type ProductVillagesQuery = z.infer<typeof productVillagesQuery>;

/** One product. `version` is also sent as the ETag of a single product. */
export const productResponse = z
  .strictObject({
    id: z.uuid(),
    code: z.string(),
    category: z.enum(PRODUCT_CATEGORIES),
    nameAr: z.string(),
    nameEn: z.string(),
    version: z.int().min(1),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'ProductResponse' });
export type ProductResponse = z.infer<typeof productResponse>;

export const productListResponse = z.array(productResponse).meta({ id: 'ProductList' });

/** A village that produces the product (the village search item, without relevance). */
export const productVillage = z
  .strictObject({
    id: z.uuid(),
    slug: z.string(),
    settlementStatus: z.enum(SETTLEMENT_STATUSES),
    publicationStatus: z.enum(PUBLICATION_STATUSES),
    displayNameAr: z.string(),
    displayNameEn: z.string().nullable(),
    location: point.nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'ProductVillage' });
export type ProductVillage = z.infer<typeof productVillage>;

/** The claim's provenance and review state, first in every response. */
const claimFields = {
  claimId: z.uuid(),
  status: z.enum(CLAIM_STATUSES),
  isPreferred: z.boolean(),
  sourceId: z.uuid().nullable(),
  sourceLocator: z.string().nullable(),
  supersedesId: z.uuid().nullable(),
  createdBy: z.uuid(),
  /** The claim's version, for `If-Match`. */
  version: z.int().min(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
};

export const villageProductResponse = z
  .strictObject({
    ...claimFields,
    productId: z.uuid(),
    significance: z.enum(PRODUCT_SIGNIFICANCES),
    product: z.strictObject({
      code: z.string(),
      category: z.enum(PRODUCT_CATEGORIES),
      nameAr: z.string(),
      nameEn: z.string(),
    }),
  })
  .meta({ id: 'VillageProductResponse' });

export const facilityResponse = z
  .strictObject({
    ...claimFields,
    facilityType: z.enum(FACILITY_TYPES),
    name: z.string(),
    location: point.nullable(),
    establishedYear: z.int().nullable(),
  })
  .meta({ id: 'FacilityResponse' });
