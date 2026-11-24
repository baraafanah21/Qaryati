import { ValidationError } from '../../../shared/kernel';
import {
  matchesPrecision,
  validateCulturalItem,
  validateHistoricalEvent,
  validateHistoryOverview,
  validateLandmark,
} from './heritage-facts';

const TODAY = '2026-11-24';

/** `field:CODE` of every error `run` throws, or `[]` when it passes. */
function codes(run: () => unknown): string[] {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    return (error as ValidationError).errors.map((e) => `${e.field}:${e.code}`);
  }
  return [];
}

describe('validateHistoryOverview', () => {
  it('normalizes the summary', () => {
    expect(
      validateHistoryOverview({ summary: '  Founded   in\n\n\n\nthe 16th century. ' }),
    ).toEqual({ summary: 'Founded in\n\nthe 16th century.' });
  });

  it('accepts 10 000 characters, rejects 10 001 and a blank summary', () => {
    expect(codes(() => validateHistoryOverview({ summary: 'a'.repeat(10_000) }))).toEqual([]);
    expect(codes(() => validateHistoryOverview({ summary: 'a'.repeat(10_001) }))).toEqual([
      'summary:TOO_LONG',
    ]);
    expect(codes(() => validateHistoryOverview({ summary: '   ' }))).toEqual(['summary:REQUIRED']);
  });

  it('counts the length after normalization', () => {
    expect(codes(() => validateHistoryOverview({ summary: `${'a'.repeat(10_000)}    ` }))).toEqual(
      [],
    );
  });
});

describe('matchesPrecision', () => {
  it.each([
    ['DAY', [1948, 5, 15], true],
    ['MONTH', [1948, 5, 1], true],
    ['MONTH', [1948, 5, 15], false],
    ['YEAR', [1948, 1, 1], true],
    ['YEAR', [1948, 5, 1], false],
    ['DECADE', [1930, 1, 1], true],
    ['DECADE', [1935, 1, 1], false],
    ['CENTURY', [1800, 1, 1], true],
    ['CENTURY', [1810, 1, 1], false],
  ] as const)('%s %j is %s', (precision, date, expected) => {
    expect(matchesPrecision([...date], precision)).toBe(expected);
  });
});

describe('validateHistoricalEvent', () => {
  const event = {
    title: ' The  great flood ',
    description: 'The wadi flooded the lower quarter.',
    startDate: '1948-05-15',
    endDate: '1948-05-20' as string | null,
    datePrecision: 'DAY',
  };
  const run = (changes: Partial<typeof event> & Record<string, unknown>) => () =>
    validateHistoricalEvent({ ...event, ...changes }, TODAY);

  it('returns the normalized value', () => {
    expect(run({})()).toEqual({ ...event, title: 'The great flood' });
    expect(run({ endDate: undefined })()).toMatchObject({ endDate: null });
  });

  it('checks title (1–200) and description (≤ 5 000) lengths', () => {
    expect(codes(run({ title: 'a'.repeat(200) }))).toEqual([]);
    expect(codes(run({ title: 'a'.repeat(201), description: 'a'.repeat(5_001) }))).toEqual([
      'title:TOO_LONG',
      'description:TOO_LONG',
    ]);
    expect(codes(run({ title: ' ', description: '' }))).toEqual([
      'title:REQUIRED',
      'description:REQUIRED',
    ]);
    expect(codes(run({ title: '- _ .' }))).toEqual(['title:INVALID_VALUE']);
  });

  it('rejects an end before the start, accepts the same day', () => {
    expect(codes(run({ endDate: '1948-05-14' }))).toEqual(['endDate:TOO_SMALL']);
    expect(codes(run({ endDate: '1948-05-15' }))).toEqual([]);
  });

  it('rejects a start in the future, accepts today', () => {
    expect(codes(run({ startDate: '2026-11-25', endDate: null }))).toEqual([
      'startDate:MUST_NOT_BE_FUTURE',
    ]);
    expect(codes(run({ startDate: TODAY, endDate: null }))).toEqual([]);
  });

  it('requires both dates to match the precision', () => {
    expect(
      codes(run({ datePrecision: 'YEAR', startDate: '1948-01-01', endDate: '1949-01-01' })),
    ).toEqual([]);
    expect(
      codes(run({ datePrecision: 'YEAR', startDate: '1948-05-01', endDate: '1949-02-01' })),
    ).toEqual(['startDate:INVALID_VALUE', 'endDate:INVALID_VALUE']);
    expect(codes(run({ datePrecision: 'MONTH', startDate: '1948-05-01', endDate: null }))).toEqual(
      [],
    );
    expect(codes(run({ datePrecision: 'DECADE', startDate: '1935-01-01', endDate: null }))).toEqual(
      ['startDate:INVALID_VALUE'],
    );
    expect(
      codes(run({ datePrecision: 'CENTURY', startDate: '1800-01-01', endDate: '1900-01-01' })),
    ).toEqual([]);
  });

  it('rejects an impossible date and an unknown precision', () => {
    expect(codes(run({ startDate: '1948-02-30', endDate: null }))).toEqual([
      'startDate:INVALID_FORMAT',
    ]);
    expect(codes(run({ endDate: '1948-13-01' }))).toEqual(['endDate:INVALID_FORMAT']);
    expect(codes(run({ datePrecision: 'WEEK' }))).toEqual(['datePrecision:INVALID_VALUE']);
  });
});

describe('validateLandmark', () => {
  const landmark = { name: 'Old Mosque', landmarkType: 'MOSQUE' };

  it('rounds the point to 5 decimals and defaults optional fields to null', () => {
    expect(
      validateLandmark({
        ...landmark,
        description: '  Built   in 1890 ',
        location: { latitude: 32.123456789, longitude: 35.987654321 },
        era: 'OTTOMAN',
      }),
    ).toEqual({
      name: 'Old Mosque',
      landmarkType: 'MOSQUE',
      description: 'Built in 1890',
      location: { latitude: 32.12346, longitude: 35.98765 },
      era: 'OTTOMAN',
    });
    expect(validateLandmark(landmark)).toEqual({
      ...landmark,
      description: null,
      location: null,
      era: null,
    });
  });

  it('accepts the coordinate bounds and rejects anything beyond', () => {
    expect(
      codes(() => validateLandmark({ ...landmark, location: { latitude: 90, longitude: -180 } })),
    ).toEqual([]);
    expect(
      codes(() =>
        validateLandmark({ ...landmark, location: { latitude: 90.1, longitude: -180.1 } }),
      ),
    ).toEqual(['location.latitude:INVALID_VALUE', 'location.longitude:INVALID_VALUE']);
  });

  it('rejects an unknown type or era, a long name or description', () => {
    expect(
      codes(() =>
        validateLandmark({
          name: 'a'.repeat(201),
          landmarkType: 'CASTLE',
          era: 'STONE_AGE',
          description: 'a'.repeat(5_001),
        }),
      ),
    ).toEqual([
      'name:TOO_LONG',
      'landmarkType:INVALID_VALUE',
      'era:INVALID_VALUE',
      'description:TOO_LONG',
    ]);
  });
});

describe('validateCulturalItem', () => {
  it('returns the normalized value', () => {
    expect(
      validateCulturalItem({
        category: 'DISH',
        name: ' Musakhan ',
        description: 'Bread  and onions',
      }),
    ).toEqual({ category: 'DISH', name: 'Musakhan', description: 'Bread and onions' });
  });

  it('rejects an unknown category, a blank name and a long description', () => {
    expect(
      codes(() =>
        validateCulturalItem({ category: 'GAME', name: ' ', description: 'a'.repeat(5_001) }),
      ),
    ).toEqual(['category:INVALID_VALUE', 'name:REQUIRED', 'description:TOO_LONG']);
  });
});
