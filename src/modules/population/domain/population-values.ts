/**
 * Allowed values and ranges of a population record (docs/data-model.md,
 * "Fact tables"). The columns are plain `integer`, `smallint` and `text`;
 * these constants are the only guard, and the API schemas read the same ones.
 */

/** How a number was obtained: a census, an estimate, or a civil register. */
export const COUNT_TYPES = ['CENSUS', 'ESTIMATE', 'REGISTERED'] as const;
export type CountType = (typeof COUNT_TYPES)[number];

/** Exact, case-sensitive membership check. */
export function isCountType(value: unknown): value is CountType {
  return typeof value === 'string' && (COUNT_TYPES as readonly string[]).includes(value);
}

/**
 * When two preferred records share a year, the one shown as "latest" is the
 * most authoritative: a census beats a register, a register beats an estimate.
 */
export const COUNT_TYPE_PRIORITY = [
  'CENSUS',
  'REGISTERED',
  'ESTIMATE',
] as const satisfies readonly CountType[];

/** A village population: no negative counts, and no village of more than a million. */
export const POPULATION_RANGE = { min: 0, max: 1_000_000 } as const;

/** The oldest year we accept: Ottoman registers start in the 19th century. */
export const MIN_REFERENCE_YEAR = 1800;

/**
 * Rule 5: an average yearly change above this fraction (50%) against the
 * nearest preferred record of the same count type is suspicious.
 */
export const ANOMALY_THRESHOLD = 0.5;

/** Non-blocking remarks returned with a submitted record; the editor decides. */
export const POPULATION_WARNINGS = ['ANOMALY_SUSPECTED'] as const;
export type PopulationWarning = (typeof POPULATION_WARNINGS)[number];

/** The most villages `PopulationQueries.latestFor` takes in one call (one page of a list). */
export const MAX_LATEST_VILLAGE_IDS = 100;
