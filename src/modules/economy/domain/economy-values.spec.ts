import { CLAIM_TYPES, SOURCE_REQUIRED_ON_SUBMIT } from '../../curation';
import {
  FACILITY_TYPES,
  isFacilityType,
  isProductCategory,
  isProductSignificance,
  PRODUCT_CATEGORIES,
  PRODUCT_SIGNIFICANCES,
} from './economy-values';

describe('economy value lists', () => {
  it('holds the values of docs/data-model.md', () => {
    expect(PRODUCT_CATEGORIES).toEqual(['CROP', 'LIVESTOCK', 'CRAFT', 'INDUSTRY', 'SERVICE']);
    expect(PRODUCT_SIGNIFICANCES).toEqual(['PRIMARY', 'SECONDARY', 'HISTORICAL']);
    expect(FACILITY_TYPES).toEqual([
      'SCHOOL',
      'CLINIC',
      'HOSPITAL',
      'LIBRARY',
      'COMMUNITY_CENTER',
      'PARK',
      'SPORTS',
      'MOSQUE',
      'CHURCH',
      'MUNICIPALITY',
      'OTHER',
    ]);
  });

  it.each([
    [isProductCategory, PRODUCT_CATEGORIES],
    [isProductSignificance, PRODUCT_SIGNIFICANCES],
    [isFacilityType, FACILITY_TYPES],
  ] as const)('%p accepts every listed value, exactly', (guard, values) => {
    for (const value of values) expect(guard(value)).toBe(true);
    expect(guard(values[0].toLowerCase())).toBe(false);
    expect(guard(` ${values[0]}`)).toBe(false);
    expect(guard('UNKNOWN')).toBe(false);
    expect(guard(undefined)).toBe(false);
    expect(guard(1)).toBe(false);
  });

  it('both claim types exist in curation and need no source on submit', () => {
    expect(CLAIM_TYPES).toEqual(expect.arrayContaining(['VILLAGE_PRODUCT', 'FACILITY']));
    expect(SOURCE_REQUIRED_ON_SUBMIT).not.toContain('VILLAGE_PRODUCT');
    expect(SOURCE_REQUIRED_ON_SUBMIT).not.toContain('FACILITY');
  });
});
