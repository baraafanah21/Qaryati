import type { CountType } from './population-values';

/**
 * One preferred record with the change since the previous preferred record of
 * the same count type (SQL `lag()` over `PARTITION BY count_type ORDER BY
 * reference_year`). The `previous*` and change fields are null on the first
 * record of a count type; the percentages are also null when the previous
 * count was 0.
 */
export interface PopulationChange {
  claimId: string;
  referenceYear: number;
  countType: CountType;
  population: number;
  previousYear: number | null;
  previousPopulation: number | null;
  absoluteChange: number | null;
  /** `(population - previous) / previous * 100`, two decimals. */
  percentChange: number | null;
  /** Compounded average yearly growth in percent, two decimals (see `averageYearlyChange`). */
  averageYearlyGrowthPercent: number | null;
}

/** A record named in the summary. */
export interface PopulationMark {
  claimId: string;
  referenceYear: number;
  countType: CountType;
  population: number;
}

/** First and latest record in time, smallest and largest population. */
export interface PopulationSummary {
  first: PopulationMark;
  latest: PopulationMark;
  min: PopulationMark;
  max: PopulationMark;
}

const mark = (change: PopulationChange): PopulationMark => ({
  claimId: change.claimId,
  referenceYear: change.referenceYear,
  countType: change.countType,
  population: change.population,
});

/**
 * The summary of a series ordered by year: `first` and `latest` are its ends,
 * `min` and `max` the earliest record with the smallest and largest count.
 * `undefined` for a village without preferred records.
 */
export function summarizePopulation(
  series: readonly PopulationChange[],
): PopulationSummary | undefined {
  const [head] = series;
  if (!head) return undefined;
  let min = head;
  let max = head;
  for (const change of series) {
    if (change.population < min.population) min = change;
    if (change.population > max.population) max = change;
  }
  return {
    first: mark(head),
    latest: mark(series[series.length - 1]!),
    min: mark(min),
    max: mark(max),
  };
}
