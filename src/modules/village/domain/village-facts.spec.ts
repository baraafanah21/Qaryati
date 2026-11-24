import { ValidationError } from '../../../shared/kernel';
import {
  FACT_TEXT_LIMITS,
  validateAffiliation,
  validateLocation,
  validateMeasure,
  validateNameOrigin,
  validateRelation,
  validateVillageName,
} from './village-facts';

const VILLAGE = '019a0000-0000-7000-8000-0000000000a1';
const OTHER = '019a0000-0000-7000-8000-0000000000a2';
const UNIT = '019a0000-0000-7000-8000-0000000000b1';

/** The field codes of the ValidationError `fn` throws. */
function fieldErrors(fn: () => unknown): Record<string, string> {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    return Object.fromEntries(
      (error as ValidationError).errors.map((e) => [e.field, e.code as string]),
    );
  }
  throw new Error('expected a ValidationError');
}

describe('validateVillageName', () => {
  const name = { name: 'بيت فوريك', lang: 'ar', nameType: 'CURRENT' };

  it('trims the name and fills name_normalized with normalizeName', () => {
    expect(validateVillageName({ ...name, name: '  إِذْنا  ' })).toEqual({
      name: 'إِذْنا',
      nameNormalized: 'اذنا',
      lang: 'ar',
      nameType: 'CURRENT',
      periodFromYear: null,
      periodToYear: null,
    });
  });

  it('keeps a historical period with from <= to', () => {
    const value = validateVillageName({
      ...name,
      nameType: 'HISTORICAL',
      periodFromYear: 1596,
      periodToYear: 1596,
    });
    expect([value.periodFromYear, value.periodToYear]).toEqual([1596, 1596]);
  });

  it('rejects a period that ends before it starts', () => {
    expect(
      fieldErrors(() =>
        validateVillageName({
          ...name,
          nameType: 'HISTORICAL',
          periodFromYear: 1900,
          periodToYear: 1800,
        }),
      ),
    ).toEqual({ periodToYear: 'INVALID_VALUE' });
  });

  it('rejects a period on a CURRENT name', () => {
    expect(fieldErrors(() => validateVillageName({ ...name, periodFromYear: 1948 }))).toEqual({
      periodFromYear: 'NOT_ALLOWED',
    });
  });

  it('rejects a non-integer year', () => {
    expect(
      fieldErrors(() =>
        validateVillageName({ ...name, nameType: 'HISTORICAL', periodToYear: 1.5 }),
      ),
    ).toEqual({ periodToYear: 'INVALID_VALUE' });
  });

  it('rejects a blank, too long or letterless name, a bad language and an unknown type at once', () => {
    expect(
      fieldErrors(() => validateVillageName({ name: '   ', lang: 'Arabic', nameType: 'OLD' })),
    ).toEqual({
      name: 'REQUIRED',
      lang: 'INVALID_FORMAT',
      nameType: 'INVALID_VALUE',
    });
    expect(
      fieldErrors(() =>
        validateVillageName({ ...name, name: 'x'.repeat(FACT_TEXT_LIMITS.name + 1) }),
      ),
    ).toEqual({ name: 'TOO_LONG' });
    expect(fieldErrors(() => validateVillageName({ ...name, name: 'ـــ' }))).toEqual({
      name: 'INVALID_VALUE',
    });
  });
});

describe('validateNameOrigin', () => {
  it('trims the fields and turns blank optional ones into null', () => {
    expect(
      validateNameOrigin({ meaning: ' the well ', originLanguage: ' ', explanation: null }),
    ).toEqual({
      meaning: 'the well',
      originLanguage: null,
      explanation: null,
    });
  });

  it('requires a meaning and limits every field', () => {
    expect(
      fieldErrors(() =>
        validateNameOrigin({
          meaning: '',
          originLanguage: 'x'.repeat(FACT_TEXT_LIMITS.originLanguage + 1),
          explanation: 'x'.repeat(FACT_TEXT_LIMITS.explanation + 1),
        }),
      ),
    ).toEqual({ meaning: 'REQUIRED', originLanguage: 'TOO_LONG', explanation: 'TOO_LONG' });
  });
});

describe('validateAffiliation', () => {
  it('accepts open and closed periods', () => {
    expect(validateAffiliation({ adminUnitId: UNIT })).toEqual({
      adminUnitId: UNIT,
      validFrom: null,
      validTo: null,
    });
    expect(
      validateAffiliation({ adminUnitId: UNIT, validFrom: '1922-01-01', validTo: '1948-05-15' }),
    ).toMatchObject({ validFrom: '1922-01-01', validTo: '1948-05-15' });
  });

  it('rejects from > to and malformed dates', () => {
    expect(
      fieldErrors(() =>
        validateAffiliation({ adminUnitId: UNIT, validFrom: '1950-01-01', validTo: '1948-01-01' }),
      ),
    ).toEqual({ validTo: 'INVALID_VALUE' });
    expect(
      fieldErrors(() => validateAffiliation({ adminUnitId: UNIT, validFrom: '1948-13-45' })),
    ).toEqual({
      validFrom: 'INVALID_FORMAT',
    });
  });
});

describe('validateLocation', () => {
  it('rounds the point to 5 decimals through roundCoordinate', () => {
    expect(
      validateLocation({ latitude: 32.1234567, longitude: 35.0000049, precision: 'EXACT' }),
    ).toEqual({ latitude: 32.12346, longitude: 35, precision: 'EXACT', description: null });
  });

  it.each([
    [{ latitude: 90.0001, longitude: 0 }, { latitude: 'INVALID_VALUE' }],
    [{ latitude: -90.5, longitude: 0 }, { latitude: 'INVALID_VALUE' }],
    [{ latitude: 0, longitude: 180.1 }, { longitude: 'INVALID_VALUE' }],
    [
      { latitude: Number.NaN, longitude: -181 },
      { latitude: 'INVALID_VALUE', longitude: 'INVALID_VALUE' },
    ],
  ])('rejects %p out of range', (point, expected) => {
    expect(fieldErrors(() => validateLocation({ ...point, precision: 'EXACT' }))).toEqual(expected);
  });

  it('accepts the edges of the ranges and rejects an unknown precision', () => {
    expect(
      validateLocation({ latitude: -90, longitude: 180, precision: 'APPROXIMATE' }).latitude,
    ).toBe(-90);
    expect(
      fieldErrors(() => validateLocation({ latitude: 0, longitude: 0, precision: 'ROUGH' })),
    ).toEqual({
      precision: 'INVALID_VALUE',
    });
  });
});

describe('validateMeasure', () => {
  it.each([-500, 0, 850, 1500])('accepts an elevation of %d m', (value) => {
    expect(validateMeasure({ kind: 'ELEVATION_M', value })).toEqual({ kind: 'ELEVATION_M', value });
  });

  it.each([-500.5, 1501])('rejects an elevation of %d m', (value) => {
    expect(fieldErrors(() => validateMeasure({ kind: 'ELEVATION_M', value }))).toEqual({
      value: 'INVALID_VALUE',
    });
  });

  it('accepts an area > 0 and rejects 0, a negative area, NaN and an unknown kind', () => {
    expect(validateMeasure({ kind: 'AREA_DUNUM', value: 0.5 }).value).toBe(0.5);
    for (const value of [0, -3, Number.NaN]) {
      expect(fieldErrors(() => validateMeasure({ kind: 'AREA_DUNUM', value }))).toEqual({
        value: 'INVALID_VALUE',
      });
    }
    expect(fieldErrors(() => validateMeasure({ kind: 'HEIGHT', value: 3 }))).toEqual({
      kind: 'INVALID_VALUE',
    });
  });
});

describe('validateRelation', () => {
  it('accepts a relation to another village', () => {
    expect(
      validateRelation(VILLAGE, { relatedVillageId: OTHER, relationType: 'ADJACENT' }),
    ).toEqual({
      relatedVillageId: OTHER,
      relationType: 'ADJACENT',
    });
  });

  it('rejects a relation to itself and an unknown type', () => {
    expect(
      fieldErrors(() =>
        validateRelation(VILLAGE, { relatedVillageId: VILLAGE, relationType: 'TWIN' }),
      ),
    ).toEqual({ relatedVillageId: 'NOT_ALLOWED', relationType: 'INVALID_VALUE' });
  });
});
