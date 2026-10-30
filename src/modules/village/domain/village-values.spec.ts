import { FieldErrorCode, ValidationError } from '../../../shared/kernel';
import {
  isPublicationStatus,
  isSettlementStatus,
  PUBLICATION_STATUSES,
  SETTLEMENT_STATUSES,
  validateSlug,
} from './village-values';
import {
  ADMIN_ERAS,
  ADMIN_UNIT_TYPES,
  AUTHORITY_TYPES,
  isAdminEra,
  isAdminUnitType,
  isAuthorityType,
  validateAdminUnit,
  type AdminUnitValidationInput,
} from './admin-unit-values';

/** Lowercase, padded, empty and unknown values: the database stores text, so each must be refused here. */
const wrongValues = (allowed: readonly string[]) => [
  ...allowed.map((value) => value.toLowerCase()),
  ` ${allowed[0]}`,
  '',
  'UNKNOWN',
];

describe.each([
  ['isSettlementStatus', isSettlementStatus, SETTLEMENT_STATUSES],
  ['isPublicationStatus', isPublicationStatus, PUBLICATION_STATUSES],
  ['isAdminUnitType', isAdminUnitType, ADMIN_UNIT_TYPES],
  ['isAdminEra', isAdminEra, ADMIN_ERAS],
  ['isAuthorityType', isAuthorityType, AUTHORITY_TYPES],
] as const)('%s', (_name, isAllowed, allowed) => {
  it.each(allowed)('accepts %s', (value) => {
    expect(isAllowed(value)).toBe(true);
  });

  it.each(wrongValues(allowed))('rejects %p', (value) => {
    expect(isAllowed(value)).toBe(false);
  });
});

describe('validateSlug', () => {
  it('accepts a valid slug', () => {
    expect(validateSlug('beit-furik')).toBe('beit-furik');
  });

  it.each(['Beit Furik', 'beit--furik', '-beit', '', 'a'.repeat(121)])(
    'rejects invalid slug %p',
    (slug) => {
      expect(() => validateSlug(slug)).toThrow(ValidationError);
    },
  );
});

describe('validateAdminUnit', () => {
  const governorate: AdminUnitValidationInput = {
    id: 'a',
    unitType: 'GOVERNORATE',
    authorityType: null,
    era: 'CURRENT',
    parentId: null,
    parentEra: null,
  };

  function fieldErrorOf(input: AdminUnitValidationInput) {
    try {
      validateAdminUnit(input);
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      return (error as ValidationError).errors[0];
    }
    throw new Error('validateAdminUnit accepted the input');
  }

  it('accepts a governorate and a local authority with an authority type', () => {
    expect(() => validateAdminUnit(governorate)).not.toThrow();
    expect(() =>
      validateAdminUnit({
        ...governorate,
        unitType: 'LOCAL_AUTHORITY',
        authorityType: 'MUNICIPALITY',
        parentId: 'b',
        parentEra: 'CURRENT',
      }),
    ).not.toThrow();
  });

  it.each(['governorate', 'REGION', ''])('rejects the unit type %p', (unitType) => {
    expect(fieldErrorOf({ ...governorate, unitType })).toMatchObject({
      field: 'unitType',
      code: FieldErrorCode.INVALID_VALUE,
    });
  });

  it.each(['current', 'ROMAN', ''])('rejects the era %p', (era) => {
    expect(fieldErrorOf({ ...governorate, era })).toMatchObject({
      field: 'era',
      code: FieldErrorCode.INVALID_VALUE,
    });
  });

  it.each(['municipality', 'CITY'])('rejects the authority type %p', (authorityType) => {
    expect(
      fieldErrorOf({ ...governorate, unitType: 'LOCAL_AUTHORITY', authorityType }),
    ).toMatchObject({ field: 'authorityType', code: FieldErrorCode.INVALID_VALUE });
  });

  it('rejects an authority type on a governorate', () => {
    expect(fieldErrorOf({ ...governorate, authorityType: 'MUNICIPALITY' })).toMatchObject({
      field: 'authorityType',
      code: FieldErrorCode.NOT_ALLOWED,
    });
  });

  it('rejects a missing authority type on a local authority', () => {
    expect(fieldErrorOf({ ...governorate, unitType: 'LOCAL_AUTHORITY' })).toMatchObject({
      field: 'authorityType',
      code: FieldErrorCode.REQUIRED,
    });
  });

  it('rejects a unit as its own parent', () => {
    expect(fieldErrorOf({ ...governorate, parentId: 'a', parentEra: 'CURRENT' })).toMatchObject({
      field: 'parentId',
      code: FieldErrorCode.NOT_ALLOWED,
    });
  });

  it('rejects a parent from another era', () => {
    expect(fieldErrorOf({ ...governorate, parentId: 'b', parentEra: 'OTTOMAN' })).toMatchObject({
      field: 'parentId',
      code: FieldErrorCode.NOT_ALLOWED,
    });
  });
});
