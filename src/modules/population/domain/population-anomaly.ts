import type { PopulationValue } from './population-record';
import { ANOMALY_THRESHOLD, type PopulationWarning } from './population-values';

/** A year and a population, the two numbers a growth rate needs. */
export interface PopulationPoint {
  referenceYear: number;
  population: number;
}

/**
 * Average yearly change between two records, as a fraction (0.05 = +5% a
 * year), compounded: `(later / earlier) ^ (1 / years) - 1`. Compounding is how
 * populations grow, so ten years at +10% is +10% a year, not +15.9%.
 *
 * `undefined` when there is no rate: the same year, or an earlier count of 0
 * (any growth from nothing is infinite, which says nothing about the data).
 */
export function averageYearlyChange(a: PopulationPoint, b: PopulationPoint): number | undefined {
  const [earlier, later] = a.referenceYear <= b.referenceYear ? [a, b] : [b, a];
  const years = later.referenceYear - earlier.referenceYear;
  if (years === 0 || earlier.population === 0) return undefined;
  return Math.pow(later.population / earlier.population, 1 / years) - 1;
}

/**
 * The preferred record nearest in time to `value`, of the same count type and
 * another year (the same year is the same question: a conflict, rule 4, not
 * growth). On a tie the earlier record wins, so the answer never depends on
 * the order of `preferred`.
 */
export function nearestRecord<T extends PopulationPoint & { countType: string }>(
  value: PopulationValue,
  preferred: readonly T[],
): T | undefined {
  let best: T | undefined;
  for (const record of preferred) {
    if (record.countType !== value.countType || record.referenceYear === value.referenceYear) {
      continue;
    }
    if (best === undefined) {
      best = record;
      continue;
    }
    const distance = Math.abs(record.referenceYear - value.referenceYear);
    const bestDistance = Math.abs(best.referenceYear - value.referenceYear);
    if (
      distance < bestDistance ||
      (distance === bestDistance && record.referenceYear < best.referenceYear)
    ) {
      best = record;
    }
  }
  return best;
}

/**
 * Rule 5: `ANOMALY_SUSPECTED` when the average yearly change against the
 * nearest preferred record of the same count type is above 50% (up or down).
 * A warning, not an error: the claim is still stored, the editor decides.
 */
export function populationWarnings(
  value: PopulationValue,
  preferred: readonly (PopulationPoint & { countType: string })[],
): PopulationWarning[] {
  const nearest = nearestRecord(value, preferred);
  if (!nearest) return [];
  const change = averageYearlyChange(nearest, value);
  return change !== undefined && Math.abs(change) > ANOMALY_THRESHOLD ? ['ANOMALY_SUSPECTED'] : [];
}
