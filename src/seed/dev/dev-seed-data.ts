/**
 * The sample villages of `npm run db:seed`: well-known villages, with values
 * that are **illustrative** (see src/seed/README.md). Names and places are the
 * real ones; coordinates are approximate (`APPROXIMATE`); every number
 * (population, years of facilities) is a plausible sample, not a cited figure,
 * and the two seed sources say so in their titles and notes.
 */

/** Which of the two seed sources a fact cites. */
export type SeedSourceKey = 'facts' | 'population';

/** The two sources every seeded claim cites; titles are unique, which makes them idempotent. */
export const DEV_SEED_SOURCES: Record<
  SeedSourceKey,
  { sourceType: string; title: string; notes: string }
> = {
  facts: {
    sourceType: 'ARCHIVE',
    title: 'Qaryati development seed: village facts (illustrative)',
    notes:
      'Sample data for local development. Names and places are real; coordinates are ' +
      'approximate and the other values are illustrative, not taken from a cited source.',
  },
  population: {
    sourceType: 'CENSUS',
    title: 'Qaryati development seed: population series (illustrative)',
    notes:
      'Sample population numbers for local development. Plausible magnitudes only: not ' +
      'figures from a census or a cited source.',
  },
};

export interface SeedPopulation {
  referenceYear: number;
  population: number;
  countType: 'CENSUS' | 'ESTIMATE' | 'REGISTERED';
}

export interface SeedLandmark {
  name: string;
  landmarkType: string;
  era: string | null;
  description: string;
}

export interface SeedProduct {
  code: string;
  significance: 'PRIMARY' | 'SECONDARY' | 'HISTORICAL';
}

export interface SeedFacility {
  facilityType: string;
  name: string;
  establishedYear: number | null;
}

export interface SeedVillage {
  slug: string;
  settlementStatus: 'INHABITED' | 'DEPOPULATED';
  nameAr: string;
  nameEn: string;
  governorate: string;
  latitude: number;
  longitude: number;
  origin: { meaning: string; originLanguage: string };
  population: SeedPopulation[];
  landmarks: SeedLandmark[];
  products: SeedProduct[];
  facilities: SeedFacility[];
}

const modern = (p1997: number, p2007: number, p2017: number): SeedPopulation[] => [
  { referenceYear: 1997, population: p1997, countType: 'CENSUS' },
  { referenceYear: 2007, population: p2007, countType: 'CENSUS' },
  { referenceYear: 2017, population: p2017, countType: 'CENSUS' },
];

const mandate = (p1922: number, p1931: number, p1945: number): SeedPopulation[] => [
  { referenceYear: 1922, population: p1922, countType: 'CENSUS' },
  { referenceYear: 1931, population: p1931, countType: 'CENSUS' },
  { referenceYear: 1945, population: p1945, countType: 'ESTIMATE' },
];

const olives: SeedProduct[] = [
  { code: 'olives', significance: 'PRIMARY' },
  { code: 'olive-oil', significance: 'SECONDARY' },
];

export const DEV_SEED_VILLAGES: readonly SeedVillage[] = [
  {
    slug: 'beit-furik',
    settlementStatus: 'INHABITED',
    nameAr: 'بيت فوريك',
    nameEn: 'Beit Furik',
    governorate: 'nablus',
    latitude: 32.1786,
    longitude: 35.3372,
    origin: { meaning: 'House of Furik', originLanguage: 'Aramaic' },
    population: [
      { referenceYear: 1945, population: 1900, countType: 'ESTIMATE' },
      ...modern(8000, 11000, 14000),
    ],
    landmarks: [],
    products: olives,
    facilities: [
      { facilityType: 'SCHOOL', name: 'مدرسة بيت فوريك الثانوية', establishedYear: 1950 },
    ],
  },
  {
    slug: 'sebastia',
    settlementStatus: 'INHABITED',
    nameAr: 'سبسطية',
    nameEn: 'Sebastia',
    governorate: 'nablus',
    latitude: 32.2764,
    longitude: 35.1925,
    origin: { meaning: 'Venerable (Sebaste)', originLanguage: 'Greek' },
    population: modern(2600, 3000, 3200),
    landmarks: [
      {
        name: 'Roman theatre of Sebastia',
        landmarkType: 'ARCHAEOLOGICAL_SITE',
        era: 'ROMAN',
        description: 'Remains of the Roman theatre on the hill of ancient Samaria-Sebaste.',
      },
    ],
    products: olives,
    facilities: [],
  },
  {
    slug: 'burqin',
    settlementStatus: 'INHABITED',
    nameAr: 'برقين',
    nameEn: 'Burqin',
    governorate: 'jenin',
    latitude: 32.4575,
    longitude: 35.2603,
    origin: { meaning: 'Lightning', originLanguage: 'Aramaic' },
    population: modern(4500, 6000, 7200),
    landmarks: [
      {
        name: 'Church of Saint George, Burqin',
        landmarkType: 'CHURCH',
        era: 'BYZANTINE',
        description: 'An old church in the village centre, linked by tradition to the ten lepers.',
      },
    ],
    products: [...olives, { code: 'wheat', significance: 'SECONDARY' }],
    facilities: [],
  },
  {
    slug: 'arraba',
    settlementStatus: 'INHABITED',
    nameAr: 'عرابة',
    nameEn: 'Arraba',
    governorate: 'jenin',
    latitude: 32.4069,
    longitude: 35.2006,
    origin: { meaning: 'Plain, open land', originLanguage: 'Arabic' },
    population: modern(7000, 9000, 10500),
    landmarks: [
      {
        name: 'Abd al-Hadi palace',
        landmarkType: 'HOUSE',
        era: 'OTTOMAN',
        description: 'Fortified residence of the Abd al-Hadi family.',
      },
    ],
    products: olives,
    facilities: [{ facilityType: 'CLINIC', name: 'عيادة عرابة', establishedYear: 1990 }],
  },
  {
    slug: 'zababdeh',
    settlementStatus: 'INHABITED',
    nameAr: 'الزبابدة',
    nameEn: 'Zababdeh',
    governorate: 'jenin',
    latitude: 32.3842,
    longitude: 35.3253,
    origin: { meaning: 'Makers of butter', originLanguage: 'Arabic' },
    population: modern(3000, 3600, 4000),
    landmarks: [],
    products: [{ code: 'olives', significance: 'PRIMARY' }],
    facilities: [],
  },
  {
    slug: 'battir',
    settlementStatus: 'INHABITED',
    nameAr: 'بتير',
    nameEn: 'Battir',
    governorate: 'bethlehem',
    latitude: 31.7275,
    longitude: 35.1364,
    origin: { meaning: 'Place of the terraces', originLanguage: 'Aramaic' },
    population: modern(3000, 3800, 4500),
    landmarks: [
      {
        name: 'Ein Battir',
        landmarkType: 'SPRING',
        era: null,
        description: 'The spring that waters the terraced gardens of the village.',
      },
    ],
    products: [
      { code: 'vegetables', significance: 'PRIMARY' },
      { code: 'olives', significance: 'SECONDARY' },
    ],
    facilities: [],
  },
  {
    slug: 'al-walaja',
    settlementStatus: 'INHABITED',
    nameAr: 'الولجة',
    nameEn: 'Al-Walaja',
    governorate: 'bethlehem',
    latitude: 31.734,
    longitude: 35.16,
    origin: { meaning: 'Entrance of the valley', originLanguage: 'Arabic' },
    population: modern(1500, 2000, 2600),
    landmarks: [],
    products: [{ code: 'olives', significance: 'PRIMARY' }],
    facilities: [],
  },
  {
    slug: 'beit-ummar',
    settlementStatus: 'INHABITED',
    nameAr: 'بيت أمر',
    nameEn: 'Beit Ummar',
    governorate: 'hebron',
    latitude: 31.62,
    longitude: 35.1036,
    origin: { meaning: 'House of Ummar', originLanguage: 'Aramaic' },
    population: modern(10000, 13500, 17000),
    landmarks: [],
    products: [
      { code: 'grapes', significance: 'PRIMARY' },
      { code: 'vegetables', significance: 'SECONDARY' },
    ],
    facilities: [{ facilityType: 'SCHOOL', name: 'مدرسة بيت أمر الأساسية', establishedYear: 1960 }],
  },
  {
    slug: 'taybeh',
    settlementStatus: 'INHABITED',
    nameAr: 'الطيبة',
    nameEn: 'Taybeh',
    governorate: 'ramallah-al-bireh',
    latitude: 31.9547,
    longitude: 35.3003,
    origin: { meaning: 'The good one', originLanguage: 'Arabic' },
    population: modern(1400, 1500, 1400),
    landmarks: [
      {
        name: 'Church of Saint George ruins, Taybeh',
        landmarkType: 'CHURCH',
        era: 'BYZANTINE',
        description: 'Ruins of a Byzantine church on the edge of the village.',
      },
    ],
    products: [
      { code: 'olives', significance: 'PRIMARY' },
      { code: 'figs', significance: 'SECONDARY' },
    ],
    facilities: [],
  },
  {
    slug: 'jifna',
    settlementStatus: 'INHABITED',
    nameAr: 'جفنا',
    nameEn: 'Jifna',
    governorate: 'ramallah-al-bireh',
    latitude: 31.9644,
    longitude: 35.2142,
    origin: { meaning: 'Vine', originLanguage: 'Aramaic' },
    population: modern(1200, 1500, 1800),
    landmarks: [],
    products: [
      { code: 'figs', significance: 'PRIMARY' },
      { code: 'olives', significance: 'SECONDARY' },
    ],
    facilities: [],
  },
  {
    slug: 'aboud',
    settlementStatus: 'INHABITED',
    nameAr: 'عابود',
    nameEn: 'Aboud',
    governorate: 'ramallah-al-bireh',
    latitude: 32.03,
    longitude: 35.07,
    origin: { meaning: 'Place of worship', originLanguage: 'Aramaic' },
    population: modern(1800, 2100, 2300),
    landmarks: [
      {
        name: 'Church of Saint Barbara, Aboud',
        landmarkType: 'CHURCH',
        era: 'BYZANTINE',
        description: 'A small church on a hill west of the village.',
      },
    ],
    products: olives,
    facilities: [],
  },
  {
    slug: 'bilin',
    settlementStatus: 'INHABITED',
    nameAr: 'بلعين',
    nameEn: "Bil'in",
    governorate: 'ramallah-al-bireh',
    latitude: 31.9292,
    longitude: 35.0731,
    origin: { meaning: 'Spring of Bel', originLanguage: 'Canaanite' },
    population: modern(1500, 1800, 2100),
    landmarks: [],
    products: [{ code: 'olives', significance: 'PRIMARY' }],
    facilities: [
      { facilityType: 'COMMUNITY_CENTER', name: 'مركز بلعين الثقافي', establishedYear: 2005 },
    ],
  },
  {
    slug: 'kafr-qaddum',
    settlementStatus: 'INHABITED',
    nameAr: 'كفر قدوم',
    nameEn: 'Kafr Qaddum',
    governorate: 'qalqilya',
    latitude: 32.2167,
    longitude: 35.15,
    origin: { meaning: 'Village of Qaddum', originLanguage: 'Aramaic' },
    population: modern(2500, 3000, 3600),
    landmarks: [],
    products: [
      { code: 'olives', significance: 'PRIMARY' },
      { code: 'almonds', significance: 'SECONDARY' },
    ],
    facilities: [],
  },
  {
    slug: 'lifta',
    settlementStatus: 'DEPOPULATED',
    nameAr: 'لفتا',
    nameEn: 'Lifta',
    governorate: 'jerusalem',
    latitude: 31.7956,
    longitude: 35.1972,
    origin: { meaning: 'Turnip', originLanguage: 'Aramaic' },
    population: mandate(1450, 1900, 2550),
    landmarks: [
      {
        name: 'Lifta spring',
        landmarkType: 'SPRING',
        era: null,
        description: 'The spring below the old stone houses of the village.',
      },
    ],
    products: [{ code: 'olives', significance: 'HISTORICAL' }],
    facilities: [],
  },
  {
    slug: 'deir-yassin',
    settlementStatus: 'DEPOPULATED',
    nameAr: 'دير ياسين',
    nameEn: 'Deir Yassin',
    governorate: 'jerusalem',
    latitude: 31.7867,
    longitude: 35.1786,
    origin: { meaning: 'Monastery of Yassin', originLanguage: 'Arabic' },
    population: mandate(250, 430, 610),
    landmarks: [],
    products: [{ code: 'stone-quarrying', significance: 'HISTORICAL' }],
    facilities: [],
  },
];
