import { ValidationError } from '../../../shared/kernel';
import { cleanName, validateFacility, validateVillageProduct } from './economy-facts';

const PRODUCT = '01a20db1-12b4-7421-9ec7-12d928a79af1';
const YEAR = 2026;

/** The field codes of the 422 a call throws. */
function fieldErrors(call: () => unknown): Record<string, string> {
  try {
    call();
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    return Object.fromEntries(
      (error as ValidationError).errors.map((e) => [e.field, e.code] as const),
    );
  }
  throw new Error('Expected a ValidationError.');
}

describe('validateVillageProduct', () => {
  it('accepts a known significance and lowercases the product id', () => {
    expect(
      validateVillageProduct({ productId: PRODUCT.toUpperCase(), significance: 'PRIMARY' }),
    ).toEqual({ productId: PRODUCT, significance: 'PRIMARY' });
  });

  it('rejects an unknown significance', () => {
    expect(
      fieldErrors(() => validateVillageProduct({ productId: PRODUCT, significance: 'MAIN' })),
    ).toEqual({ significance: 'INVALID_VALUE' });
  });
});

describe('validateFacility', () => {
  const valid = {
    facilityType: 'SCHOOL',
    name: '  Boys   School ',
    location: { latitude: 32.123456, longitude: 35.234567 },
    establishedYear: 1950,
  };

  it('cleans the name, rounds the point to 5 decimals and keeps the year', () => {
    expect(validateFacility(valid, YEAR)).toEqual({
      facilityType: 'SCHOOL',
      name: 'Boys School',
      location: { latitude: 32.12346, longitude: 35.23457 },
      establishedYear: 1950,
    });
  });

  it('treats an absent location and year as null', () => {
    expect(validateFacility({ facilityType: 'PARK', name: 'حديقة' }, YEAR)).toEqual({
      facilityType: 'PARK',
      name: 'حديقة',
      location: null,
      establishedYear: null,
    });
  });

  it.each([
    [1800, true],
    [YEAR, true],
    [1799, 'TOO_SMALL'],
    [YEAR + 1, 'MUST_NOT_BE_FUTURE'],
    [1950.5, 'NOT_INTEGER'],
  ] as const)('established year %d: %p', (establishedYear, expected) => {
    const call = () => validateFacility({ ...valid, establishedYear }, YEAR);
    if (expected === true) expect(call().establishedYear).toBe(establishedYear);
    else expect(fieldErrors(call)).toEqual({ establishedYear: expected });
  });

  it('names every broken field in one 422', () => {
    expect(
      fieldErrors(() =>
        validateFacility(
          {
            facilityType: 'FACTORY',
            name: '   ',
            location: { latitude: 91, longitude: -181 },
            establishedYear: 1700,
          },
          YEAR,
        ),
      ),
    ).toEqual({
      facilityType: 'INVALID_VALUE',
      name: 'REQUIRED',
      'location.latitude': 'INVALID_VALUE',
      'location.longitude': 'INVALID_VALUE',
      establishedYear: 'TOO_SMALL',
    });
  });

  it('rejects a name over 200 characters and one without letters or digits', () => {
    expect(fieldErrors(() => validateFacility({ ...valid, name: 'a'.repeat(201) }, YEAR))).toEqual({
      name: 'TOO_LONG',
    });
    expect(validateFacility({ ...valid, name: 'a'.repeat(200) }, YEAR).name).toHaveLength(200);
    expect(fieldErrors(() => validateFacility({ ...valid, name: '---' }, YEAR))).toEqual({
      name: 'INVALID_VALUE',
    });
  });
});

describe('cleanName', () => {
  it('collapses white space, trims and applies NFC', () => {
    expect(cleanName(' a \t b\n c ')).toBe('a b c');
    expect(cleanName('é')).toBe('é');
  });
});
