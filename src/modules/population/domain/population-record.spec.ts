import { ValidationError } from '../../../shared/kernel';
import { validatePopulation } from './population-record';
import { COUNT_TYPES, isCountType } from './population-values';

const THIS_YEAR = 2026;
const valid = { population: 1200, referenceYear: 1945, countType: 'CENSUS' };

function fieldCodes(input: Partial<typeof valid> & Record<string, unknown>): string[] {
  try {
    validatePopulation({ ...valid, ...input }, THIS_YEAR);
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    return (error as ValidationError).errors.map((e) => `${e.field}:${e.code}`);
  }
  return [];
}

describe('population values', () => {
  it('accepts exactly CENSUS, ESTIMATE and REGISTERED', () => {
    expect(COUNT_TYPES).toEqual(['CENSUS', 'ESTIMATE', 'REGISTERED']);
    for (const type of COUNT_TYPES) expect(isCountType(type)).toBe(true);
    for (const other of ['census', 'GUESS', '', 1, null]) expect(isCountType(other)).toBe(false);
  });
});

describe('validatePopulation', () => {
  it('returns a valid value unchanged', () => {
    expect(validatePopulation(valid, THIS_YEAR)).toEqual(valid);
  });

  it('accepts the bounds: 0 and 1 000 000 people, 1800 and the current year', () => {
    expect(fieldCodes({ population: 0 })).toEqual([]);
    expect(fieldCodes({ population: 1_000_000 })).toEqual([]);
    expect(fieldCodes({ referenceYear: 1800 })).toEqual([]);
    expect(fieldCodes({ referenceYear: THIS_YEAR })).toEqual([]);
  });

  it('rejects a population outside 0 … 1 000 000 or with a fraction', () => {
    expect(fieldCodes({ population: -1 })).toEqual(['population:TOO_SMALL']);
    expect(fieldCodes({ population: 1_000_001 })).toEqual(['population:TOO_LARGE']);
    expect(fieldCodes({ population: 10.5 })).toEqual(['population:NOT_INTEGER']);
  });

  it('rule 3: rejects a year in the future, judged by the clock year', () => {
    expect(fieldCodes({ referenceYear: THIS_YEAR + 1 })).toEqual([
      'referenceYear:MUST_NOT_BE_FUTURE',
    ]);
  });

  it('rejects a year before 1800 and an unknown count type, all in one error', () => {
    expect(fieldCodes({ referenceYear: 1799, countType: 'GUESS' })).toEqual([
      'referenceYear:TOO_SMALL',
      'countType:INVALID_VALUE',
    ]);
  });
});
