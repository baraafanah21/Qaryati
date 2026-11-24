/**
 * Allowed values and limits of the economy module (docs/data-model.md). The
 * columns are plain `text`; these constants are the only guard, and the API
 * schemas read the same arrays.
 */

/** What kind of product a `product` row is. */
export const PRODUCT_CATEGORIES = ['CROP', 'LIVESTOCK', 'CRAFT', 'INDUSTRY', 'SERVICE'] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

/** How much a product matters to a village: today's main or side product, or one of the past. */
export const PRODUCT_SIGNIFICANCES = ['PRIMARY', 'SECONDARY', 'HISTORICAL'] as const;
export type ProductSignificance = (typeof PRODUCT_SIGNIFICANCES)[number];

/** What kind of community facility a `facility` row is. */
export const FACILITY_TYPES = [
  'SCHOOL',
  'CLINIC',
  'HOSPITAL',
  'LIBRARY',
  'COMMUNITY_CENTER',
  'PARK',
  'SPORTS',
  'MOSQUE',
  'CHURCH',
  'MUNICIPALITY',
  'OTHER',
] as const;
export type FacilityType = (typeof FACILITY_TYPES)[number];

const member =
  <T extends string>(values: readonly T[]) =>
  (value: unknown): value is T =>
    typeof value === 'string' && (values as readonly string[]).includes(value);

/** Exact, case-sensitive membership checks. */
export const isProductCategory = member(PRODUCT_CATEGORIES);
export const isProductSignificance = member(PRODUCT_SIGNIFICANCES);
export const isFacilityType = member(FACILITY_TYPES);

/** A facility name: 1–200 characters after normalization. */
export const FACILITY_NAME_MAX = 200;

/** The earliest `established_year`; the latest is the current year (from the `Clock`). */
export const MIN_ESTABLISHED_YEAR = 1800;
