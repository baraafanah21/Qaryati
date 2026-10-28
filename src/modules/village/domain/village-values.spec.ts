import { ValidationError } from '../../../shared/kernel';
import { SETTLEMENT_STATUSES, PUBLICATION_STATUSES, validateSlug } from './village-values';
import {
  ADMIN_UNIT_TYPES,
  AUTHORITY_TYPES,
  ADMIN_ERAS,
  validateAdminUnit,
} from './admin-unit-values';

describe('village value lists and validators', () => {
  it('exports the expected settlement statuses', () => {
    expect(SETTLEMENT_STATUSES).toEqual(['INHABITED', 'DEPOPULATED', 'MERGED']);
  });

  it('exports the expected publication statuses', () => {
    expect(PUBLICATION_STATUSES).toEqual(['DRAFT', 'PUBLISHED', 'ARCHIVED']);
  });

  it('exports the expected administrative unit values', () => {
    expect(ADMIN_UNIT_TYPES).toEqual(['GOVERNORATE', 'SUB_DISTRICT', 'LOCAL_AUTHORITY']);
    expect(AUTHORITY_TYPES).toEqual([
      'MUNICIPALITY',
      'VILLAGE_COUNCIL',
      'LOCAL_COUNCIL',
      'PROJECT_COMMITTEE',
    ]);
    expect(ADMIN_ERAS).toEqual(['CURRENT', 'BRITISH_MANDATE', 'OTTOMAN']);
  });

  it('accepts a valid slug', () => {
    expect(validateSlug('beit-furik')).toBe('beit-furik');
  });

  it.each(['Beit Furik', 'beit--furik', '-beit', '', 'a'.repeat(121)])(
    'rejects invalid slug %p',
    (slug) => {
      expect(() => validateSlug(slug)).toThrow(ValidationError);
    },
  );

  it('rejects an authority type on a governorate', () => {
    expect(() =>
      validateAdminUnit({
        id: 'a',
        unitType: 'GOVERNORATE',
        authorityType: 'MUNICIPALITY',
        era: 'CURRENT',
        parentId: null,
        parentEra: null,
      }),
    ).toThrow(ValidationError);
  });

  it('rejects a missing authority type on a local authority', () => {
    expect(() =>
      validateAdminUnit({
        id: 'a',
        unitType: 'LOCAL_AUTHORITY',
        authorityType: null,
        era: 'CURRENT',
        parentId: null,
        parentEra: null,
      }),
    ).toThrow(ValidationError);
  });

  it('rejects a unit as its own parent', () => {
    expect(() =>
      validateAdminUnit({
        id: 'a',
        unitType: 'GOVERNORATE',
        authorityType: null,
        era: 'CURRENT',
        parentId: 'a',
        parentEra: 'CURRENT',
      }),
    ).toThrow(ValidationError);
  });

  it('rejects a parent from another era', () => {
    expect(() =>
      validateAdminUnit({
        id: 'a',
        unitType: 'GOVERNORATE',
        authorityType: null,
        era: 'CURRENT',
        parentId: 'b',
        parentEra: 'OTTOMAN',
      }),
    ).toThrow(ValidationError);
  });
});
