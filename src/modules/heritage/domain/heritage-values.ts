/**
 * Allowed values and limits of the heritage facts (docs/data-model.md, "Claim
 * types"). The columns are plain `text`; these constants are the only guard,
 * and the API schemas read the same arrays.
 */

/** What kind of place a landmark is. */
export const LANDMARK_TYPES = [
  'MOSQUE',
  'CHURCH',
  'MAQAM',
  'CEMETERY',
  'SPRING',
  'WELL',
  'SCHOOL',
  'KHAN',
  'MILL',
  'OLIVE_PRESS',
  'FORTRESS',
  'HOUSE',
  'ARCHAEOLOGICAL_SITE',
  'VIEWPOINT',
  'OTHER',
] as const;
export type LandmarkType = (typeof LANDMARK_TYPES)[number];

/** The period a landmark dates from, oldest first. */
export const LANDMARK_ERAS = [
  'ROMAN',
  'BYZANTINE',
  'EARLY_ISLAMIC',
  'CRUSADER',
  'AYYUBID',
  'MAMLUK',
  'OTTOMAN',
  'BRITISH_MANDATE',
  'MODERN',
] as const;
export type LandmarkEra = (typeof LANDMARK_ERAS)[number];

/** What kind of intangible heritage a cultural item is. */
export const CULTURAL_CATEGORIES = [
  'FOLK_SONG',
  'DANCE',
  'DISH',
  'CRAFT',
  'COSTUME',
  'EMBROIDERY',
  'AGRICULTURAL_PRACTICE',
  'PROVERB',
  'STORY',
  'FESTIVAL',
  'CUSTOM',
  'OTHER',
] as const;
export type CulturalCategory = (typeof CULTURAL_CATEGORIES)[number];

/**
 * How precisely an event's dates are known. A date is stored as the first day
 * of its period: `YEAR` 1948-01-01, `MONTH` 1948-05-01, `DECADE` 1930-01-01,
 * `CENTURY` 1800-01-01.
 */
export const DATE_PRECISIONS = ['DAY', 'MONTH', 'YEAR', 'DECADE', 'CENTURY'] as const;
export type DatePrecision = (typeof DATE_PRECISIONS)[number];

const member =
  <T extends string>(values: readonly T[]) =>
  (value: unknown): value is T =>
    typeof value === 'string' && (values as readonly string[]).includes(value);

/** Exact, case-sensitive membership checks. */
export const isLandmarkType = member(LANDMARK_TYPES);
export const isLandmarkEra = member(LANDMARK_ERAS);
export const isCulturalCategory = member(CULTURAL_CATEGORIES);
export const isDatePrecision = member(DATE_PRECISIONS);

/** Text limits in characters, after normalization. */
export const HERITAGE_TEXT_LIMITS = {
  summary: 10_000,
  name: 200,
  description: 5_000,
} as const;
