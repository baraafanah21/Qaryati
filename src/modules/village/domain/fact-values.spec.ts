import {
  isLanguageTag,
  isLocationPrecision,
  isMeasureKind,
  isNameType,
  isRelationType,
  LOCATION_PRECISIONS,
  MEASURE_KINDS,
  NAME_TYPES,
  RELATION_TYPES,
} from './fact-values';

describe('village fact values', () => {
  it.each([
    [
      'NAME_TYPES',
      NAME_TYPES,
      ['CURRENT', 'HISTORICAL', 'ALTERNATIVE_SPELLING', 'TRANSLITERATION'],
    ],
    ['LOCATION_PRECISIONS', LOCATION_PRECISIONS, ['EXACT', 'APPROXIMATE']],
    ['MEASURE_KINDS', MEASURE_KINDS, ['ELEVATION_M', 'AREA_DUNUM']],
    ['RELATION_TYPES', RELATION_TYPES, ['ADJACENT', 'MERGED_INTO', 'SPLIT_FROM']],
  ] as const)('%s lists exactly the documented values', (_name, values, expected) => {
    expect([...values]).toEqual(expected);
  });

  it.each([
    [isNameType, NAME_TYPES],
    [isLocationPrecision, LOCATION_PRECISIONS],
    [isMeasureKind, MEASURE_KINDS],
    [isRelationType, RELATION_TYPES],
  ] as const)('accepts every listed value and nothing else', (guard, values) => {
    for (const value of values) expect(guard(value)).toBe(true);
    for (const value of [values[0].toLowerCase(), ` ${values[0]}`, '', null, 1, undefined]) {
      expect(guard(value)).toBe(false);
    }
  });

  it.each(['ar', 'en', 'he', 'tr', 'ota', 'ar-Latn', 'en-GB', 'es-419', 'ar-Latn-PS'])(
    'accepts the short BCP 47 tag %s',
    (tag) => expect(isLanguageTag(tag)).toBe(true),
  );

  it.each(['', 'AR', 'arabic', 'a', 'ar_PS', 'ar-ps', 'en-', 'ar-latn', 42, null])(
    'rejects %p as a language tag',
    (tag) => expect(isLanguageTag(tag)).toBe(false),
  );
});
