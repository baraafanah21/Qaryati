/**
 * Allowed values of the village fact tables (docs/data-model.md, "Claim
 * types"). The columns are plain `text`; these lists are the only guard, and
 * the API schemas read the same arrays.
 */

/** Kinds of village name. Only a `CURRENT` name feeds the display-name projection. */
export const NAME_TYPES = [
  'CURRENT',
  'HISTORICAL',
  'ALTERNATIVE_SPELLING',
  'TRANSLITERATION',
] as const;
export type NameType = (typeof NAME_TYPES)[number];

/** How exact a submitted location is. */
export const LOCATION_PRECISIONS = ['EXACT', 'APPROXIMATE'] as const;
export type LocationPrecision = (typeof LOCATION_PRECISIONS)[number];

/** Measured quantities of a village, with the unit in the name. */
export const MEASURE_KINDS = ['ELEVATION_M', 'AREA_DUNUM'] as const;
export type MeasureKind = (typeof MEASURE_KINDS)[number];

/** How one village relates to another. */
export const RELATION_TYPES = ['ADJACENT', 'MERGED_INTO', 'SPLIT_FROM'] as const;
export type RelationType = (typeof RELATION_TYPES)[number];

/**
 * A short BCP 47 tag: a 2–3 letter language, optionally a 4-letter script and
 * a 2-letter or 3-digit region (`ar`, `en`, `he`, `ar-Latn`, `en-GB`).
 */
export const LANGUAGE_TAG = /^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|\d{3}))?$/;

const has =
  <T extends string>(values: readonly T[]) =>
  (value: unknown): value is T =>
    typeof value === 'string' && (values as readonly string[]).includes(value);

/** Exact, case-sensitive membership checks. */
export const isNameType = has(NAME_TYPES);
export const isLocationPrecision = has(LOCATION_PRECISIONS);
export const isMeasureKind = has(MEASURE_KINDS);
export const isRelationType = has(RELATION_TYPES);

/** Whether `value` is a short BCP 47 language tag. */
export function isLanguageTag(value: unknown): value is string {
  return typeof value === 'string' && LANGUAGE_TAG.test(value);
}
