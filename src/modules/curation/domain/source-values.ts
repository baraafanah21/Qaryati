/** Supported categories of cited information sources. */
export const SOURCE_TYPES = [
  'BOOK',
  'ARTICLE',
  'CENSUS',
  'GOV_DATASET',
  'ARCHIVE',
  'ORAL_HISTORY',
  'WEBSITE',
  'EXTERNAL_API',
] as const;

/** A supported source category. */
export type SourceType = (typeof SOURCE_TYPES)[number];
