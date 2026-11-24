import { SOURCE_REQUIRED_ON_SUBMIT, valueHash } from '../../curation';
import { populationClaim } from './population-claim';

const VILLAGE = '00000000-0000-7000-8000-000000000001';

describe('rule 1', () => {
  it('a population claim needs a source: curation enforces it for POPULATION', () => {
    expect(SOURCE_REQUIRED_ON_SUBMIT).toContain('POPULATION');
  });
});

describe('populationClaim', () => {
  it('asks population|v|year|count_type and hashes the population only', () => {
    const claim = populationClaim(VILLAGE, {
      population: 1200,
      referenceYear: 1945,
      countType: 'CENSUS',
    });
    expect(claim).toEqual({
      claimType: 'POPULATION',
      groupKey: `population|${VILLAGE}|1945|CENSUS`,
      valueHash: valueHash({ population: 1200 }),
    });
  });

  it('rule 4: a different number for the same question keeps the question, changes the hash', () => {
    const a = populationClaim(VILLAGE, {
      population: 1200,
      referenceYear: 1945,
      countType: 'CENSUS',
    });
    const b = populationClaim(VILLAGE, {
      population: 1300,
      referenceYear: 1945,
      countType: 'CENSUS',
    });
    expect(b.groupKey).toBe(a.groupKey);
    expect(b.valueHash).not.toBe(a.valueHash);
  });

  it('makes another year or count type another question', () => {
    const base = { population: 1200, referenceYear: 1945, countType: 'CENSUS' } as const;
    const keys = new Set([
      populationClaim(VILLAGE, base).groupKey,
      populationClaim(VILLAGE, { ...base, referenceYear: 1946 }).groupKey,
      populationClaim(VILLAGE, { ...base, countType: 'ESTIMATE' }).groupKey,
    ]);
    expect(keys.size).toBe(3);
  });
});
