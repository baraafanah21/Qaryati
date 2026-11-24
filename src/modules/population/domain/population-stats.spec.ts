import { summarizePopulation, type PopulationChange } from './population-stats';

const change = (claimId: string, referenceYear: number, population: number): PopulationChange => ({
  claimId,
  referenceYear,
  countType: 'CENSUS',
  population,
  previousYear: null,
  previousPopulation: null,
  absoluteChange: null,
  percentChange: null,
  averageYearlyGrowthPercent: null,
});

describe('summarizePopulation', () => {
  it('names the ends of the series and its smallest and largest record', () => {
    const series = [change('a', 1922, 800), change('b', 1945, 600), change('c', 1997, 1500)];
    const summary = summarizePopulation(series);
    expect(summary?.first.claimId).toBe('a');
    expect(summary?.latest.claimId).toBe('c');
    expect(summary?.min.claimId).toBe('b');
    expect(summary?.max.claimId).toBe('c');
    expect(summary?.min).toEqual({
      claimId: 'b',
      referenceYear: 1945,
      countType: 'CENSUS',
      population: 600,
    });
  });

  it('keeps the earliest record on equal counts, and is undefined for no records', () => {
    const summary = summarizePopulation([change('a', 1922, 500), change('b', 1945, 500)]);
    expect(summary?.min.claimId).toBe('a');
    expect(summary?.max.claimId).toBe('a');
    expect(summarizePopulation([])).toBeUndefined();
  });
});
