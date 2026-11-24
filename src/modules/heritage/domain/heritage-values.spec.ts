import {
  CULTURAL_CATEGORIES,
  DATE_PRECISIONS,
  isCulturalCategory,
  isDatePrecision,
  isLandmarkEra,
  isLandmarkType,
  LANDMARK_ERAS,
  LANDMARK_TYPES,
} from './heritage-values';

describe('heritage value lists', () => {
  it('lists exactly the landmark types of the data model', () => {
    expect(LANDMARK_TYPES).toEqual([
      'MOSQUE',
      'CHURCH',
      'MAQAM',
      'CEMETERY',
      'SPRING',
      'WELL',
      'SCHOOL',
      'KHAN',
      'MILL',
      'OLIVE_PRESS',
      'FORTRESS',
      'HOUSE',
      'ARCHAEOLOGICAL_SITE',
      'VIEWPOINT',
      'OTHER',
    ]);
  });

  it('lists the eras oldest first', () => {
    expect(LANDMARK_ERAS).toEqual([
      'ROMAN',
      'BYZANTINE',
      'EARLY_ISLAMIC',
      'CRUSADER',
      'AYYUBID',
      'MAMLUK',
      'OTTOMAN',
      'BRITISH_MANDATE',
      'MODERN',
    ]);
  });

  it('lists exactly the cultural categories and date precisions', () => {
    expect(CULTURAL_CATEGORIES).toEqual([
      'FOLK_SONG',
      'DANCE',
      'DISH',
      'CRAFT',
      'COSTUME',
      'EMBROIDERY',
      'AGRICULTURAL_PRACTICE',
      'PROVERB',
      'STORY',
      'FESTIVAL',
      'CUSTOM',
      'OTHER',
    ]);
    expect(DATE_PRECISIONS).toEqual(['DAY', 'MONTH', 'YEAR', 'DECADE', 'CENTURY']);
  });

  it.each([
    ['isLandmarkType', isLandmarkType, LANDMARK_TYPES],
    ['isLandmarkEra', isLandmarkEra, LANDMARK_ERAS],
    ['isCulturalCategory', isCulturalCategory, CULTURAL_CATEGORIES],
    ['isDatePrecision', isDatePrecision, DATE_PRECISIONS],
  ] as const)('%s accepts its list only, case-sensitive', (_, guard, values) => {
    for (const value of values) expect(guard(value)).toBe(true);
    for (const other of [values[0].toLowerCase(), 'UNKNOWN', '', 1, null, undefined]) {
      expect(guard(other)).toBe(false);
    }
  });
});
