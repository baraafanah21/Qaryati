import { averageYearlyChange, nearestRecord, populationWarnings } from './population-anomaly';
import type { CountType } from './population-values';

const record = (referenceYear: number, population: number, countType: CountType = 'CENSUS') => ({
  referenceYear,
  population,
  countType,
});

describe('averageYearlyChange', () => {
  it('compounds the change over the years between the records, in either order', () => {
    expect(averageYearlyChange(record(2000, 1000), record(2001, 1100))).toBeCloseTo(0.1);
    expect(averageYearlyChange(record(2000, 1000), record(2002, 1210))).toBeCloseTo(0.1);
    expect(averageYearlyChange(record(2002, 1210), record(2000, 1000))).toBeCloseTo(0.1);
    expect(averageYearlyChange(record(2000, 1000), record(2001, 500))).toBeCloseTo(-0.5);
  });

  it('has no rate for the same year or from a count of 0', () => {
    expect(averageYearlyChange(record(2000, 1000), record(2000, 1500))).toBeUndefined();
    expect(averageYearlyChange(record(2000, 0), record(2001, 50))).toBeUndefined();
    expect(averageYearlyChange(record(2000, 50), record(2001, 0))).toBe(-1);
  });
});

describe('nearestRecord', () => {
  it('picks the nearest year of the same count type, never the same year', () => {
    const preferred = [
      record(1922, 500),
      record(1945, 700),
      record(1961, 900, 'ESTIMATE'),
      record(1950, 800),
    ];
    expect(nearestRecord(record(1960, 0), preferred)).toEqual(record(1950, 800));
    expect(nearestRecord(record(1945, 0), preferred)).toEqual(record(1950, 800));
    expect(nearestRecord(record(1960, 0, 'REGISTERED'), preferred)).toBeUndefined();
  });

  it('breaks a tie with the earlier record, whatever the input order', () => {
    const later = record(1950, 1);
    const earlier = record(1940, 2);
    expect(nearestRecord(record(1945, 0), [later, earlier])).toBe(earlier);
    expect(nearestRecord(record(1945, 0), [earlier, later])).toBe(earlier);
  });
});

describe('populationWarnings (rule 5)', () => {
  const preferred = [record(2000, 1000)];

  it('warns above 50% a year (51%), not at 49%', () => {
    expect(populationWarnings(record(2001, 1510), preferred)).toEqual(['ANOMALY_SUSPECTED']);
    expect(populationWarnings(record(2001, 1490), preferred)).toEqual([]);
  });

  it('averages over the years: +125% in two years is exactly 50% a year, not above', () => {
    expect(populationWarnings(record(2002, 2250), preferred)).toEqual([]);
    expect(populationWarnings(record(2002, 2300), preferred)).toEqual(['ANOMALY_SUSPECTED']);
  });

  it('warns for a steep decline too', () => {
    expect(populationWarnings(record(2001, 400), preferred)).toEqual(['ANOMALY_SUSPECTED']);
    expect(populationWarnings(record(2001, 600), preferred)).toEqual([]);
  });

  it('compares only with the same count type, and says nothing without a neighbour', () => {
    expect(populationWarnings(record(2001, 5000, 'ESTIMATE'), preferred)).toEqual([]);
    expect(populationWarnings(record(2001, 5000), [])).toEqual([]);
  });
});
