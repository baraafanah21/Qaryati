/**
 * The synthetic villages of `npm run db:seed:perf`, generated from a fixed
 * random seed: the same `count` always gives the same villages, names, points
 * and numbers, so two baselines measured on two machines read the same data.
 * Pure: no database, no clock.
 */

/** The fixed seed of the generator. Changing it changes every perf dataset. */
export const PERF_RANDOM_SEED = 20261201;

/** mulberry32: a tiny, fast, well-distributed 32-bit PRNG; deterministic for a seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Common first words of Palestinian village names, with a usual transliteration. */
const PREFIXES: readonly [string, string][] = [
  ['بيت', 'Beit'],
  ['كفر', 'Kafr'],
  ['دير', 'Deir'],
  ['عين', 'Ein'],
  ['خربة', 'Khirbet'],
  ['تل', 'Tell'],
  ['برج', 'Burj'],
  ['', ''],
  ['', ''],
];

/** Second words and single-word names. */
const ROOTS: readonly [string, string][] = [
  ['الرمانة', 'al-Rummana'],
  ['صفا', 'Safa'],
  ['نبالا', 'Naballa'],
  ['سوريك', 'Surik'],
  ['جمال', 'Jamal'],
  ['الغصون', 'al-Ghusun'],
  ['عنان', 'Anan'],
  ['زيتا', 'Zeita'],
  ['قاسم', 'Qasim'],
  ['ثلث', 'Thulth'],
  ['البرك', 'al-Burak'],
  ['الماء', 'al-Ma'],
  ['حجلة', 'Hajla'],
  ['رافات', 'Rafat'],
  ['عطارة', 'Attara'],
  ['دقو', 'Daqqu'],
  ['السهل', 'al-Sahl'],
  ['جبع', 'Jaba'],
  ['ماما', 'Mama'],
  ['اللوز', 'al-Luz'],
  ['التين', 'al-Tin'],
  ['الخضر', 'al-Khader'],
  ['سيرا', 'Sira'],
  ['عوا', 'Awwa'],
  ['ليد', 'Lid'],
  ['ناعم', 'Naim'],
  ['الشيخ', 'al-Sheikh'],
  ['ريما', 'Rima'],
  ['قليل', 'Qalil'],
  ['الحمرا', 'al-Hamra'],
  ['ساريس', 'Saris'],
  ['زكريا', 'Zakariya'],
  ['عمر', 'Umar'],
  ['الغزال', 'al-Ghazal'],
  ['دجن', 'Dajan'],
  ['عجول', 'Ajjul'],
  ['الواد', 'al-Wad'],
  ['حنينا', 'Hanina'],
  ['سالم', 'Salem'],
  ['الطور', 'al-Tur'],
];

/** Rough centres of the current governorates (approximate, for plausible points). */
export const GOVERNORATE_CENTRES: Readonly<Record<string, [number, number]>> = {
  jenin: [32.42, 35.28],
  tubas: [32.33, 35.4],
  tulkarm: [32.31, 35.08],
  nablus: [32.2, 35.27],
  qalqilya: [32.17, 35.03],
  salfit: [32.08, 35.17],
  'ramallah-al-bireh': [31.93, 35.2],
  'jericho-al-aghwar': [31.86, 35.43],
  jerusalem: [31.8, 35.22],
  bethlehem: [31.68, 35.2],
  hebron: [31.5, 35.08],
  'north-gaza': [31.54, 34.5],
  gaza: [31.5, 34.45],
  'deir-al-balah': [31.42, 34.35],
  'khan-yunis': [31.34, 34.3],
  rafah: [31.29, 34.25],
};

/** Landmarks a village commonly has; at most one of each per village. */
const LANDMARKS: readonly { name: string; type: string; era: string | null }[] = [
  { name: 'المسجد القديم', type: 'MOSQUE', era: 'OTTOMAN' },
  { name: 'عين البلد', type: 'SPRING', era: null },
  { name: 'مقام الشيخ', type: 'MAQAM', era: 'MAMLUK' },
  { name: 'المقبرة القديمة', type: 'CEMETERY', era: null },
  { name: 'معصرة الزيت', type: 'OLIVE_PRESS', era: 'OTTOMAN' },
  { name: 'البئر الرومانية', type: 'WELL', era: 'ROMAN' },
  { name: 'الخان', type: 'KHAN', era: 'MAMLUK' },
  { name: 'الطاحونة', type: 'MILL', era: 'OTTOMAN' },
  { name: 'الكنيسة البيزنطية', type: 'CHURCH', era: 'BYZANTINE' },
  { name: 'المدرسة القديمة', type: 'SCHOOL', era: 'BRITISH_MANDATE' },
];

/** Product codes seeded by migration 0023 that villages commonly produce. */
const PRODUCTS = [
  'olives',
  'olive-oil',
  'figs',
  'grapes',
  'wheat',
  'barley',
  'almonds',
  'vegetables',
  'citrus',
  'sheep-and-goats',
  'honey',
  'embroidery',
  'soap',
] as const;

const MODERN_YEARS = [1922, 1931, 1945, 1961, 1997, 2007, 2017] as const;
const MANDATE_YEARS = [1922, 1931, 1945] as const;

export interface PerfPopulation {
  referenceYear: number;
  population: number;
  countType: 'CENSUS' | 'ESTIMATE';
}

export interface PerfLandmark {
  name: string;
  landmarkType: string;
  era: string | null;
  description: string;
  latitude: number;
  longitude: number;
}

export interface PerfVillage {
  index: number;
  slug: string;
  settlementStatus: 'INHABITED' | 'DEPOPULATED';
  nameAr: string;
  nameEn: string;
  governorate: string;
  latitude: number;
  longitude: number;
  population: PerfPopulation[];
  landmarks: PerfLandmark[];
  products: { code: string; significance: 'PRIMARY' | 'SECONDARY' }[];
}

const round5 = (value: number) => Math.round(value * 100_000) / 100_000;

/** `count` synthetic villages, always the same ones for the same `count`. */
export function generatePerfVillages(count: number, seed = PERF_RANDOM_SEED): PerfVillage[] {
  const random = mulberry32(seed);
  const int = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  const sample = <T>(items: readonly T[], n: number): T[] => {
    const pool = [...items];
    const out: T[] = [];
    while (out.length < n && pool.length > 0) out.push(pool.splice(int(0, pool.length - 1), 1)[0]!);
    return out;
  };
  const governorates = Object.keys(GOVERNORATE_CENTRES);

  return Array.from({ length: count }, (_, index) => {
    const [prefixAr, prefixEn] = pick(PREFIXES);
    const [rootAr, rootEn] = pick(ROOTS);
    const nameAr = `${prefixAr} ${rootAr}`.trim();
    const nameEn = `${prefixEn} ${rootEn}`.trim();
    const governorate = pick(governorates);
    const [lat, lng] = GOVERNORATE_CENTRES[governorate]!;
    const latitude = round5(lat + (random() - 0.5) * 0.2);
    const longitude = round5(lng + (random() - 0.5) * 0.2);
    const settlementStatus = random() < 0.15 ? 'DEPOPULATED' : 'INHABITED';

    const years =
      settlementStatus === 'DEPOPULATED'
        ? [...MANDATE_YEARS]
        : sample(MODERN_YEARS, int(3, 5)).sort((a, b) => a - b);
    let population = int(300, 4000);
    let previousYear = years[0]!;
    const records = years.map((referenceYear) => {
      population = Math.round(population * (1 + 0.025) ** (referenceYear - previousYear));
      previousYear = referenceYear;
      return {
        referenceYear,
        population: Math.min(population, 1_000_000),
        countType: referenceYear === 1945 ? ('ESTIMATE' as const) : ('CENSUS' as const),
      };
    });

    const landmarks = sample(LANDMARKS, int(2, 4)).map((l) => ({
      name: l.name,
      landmarkType: l.type,
      era: l.era,
      description: `${l.name} في ${nameAr} (بيانات اصطناعية لاختبار الأداء)`,
      latitude: round5(latitude + (random() - 0.5) * 0.01),
      longitude: round5(longitude + (random() - 0.5) * 0.01),
    }));
    const products = sample(PRODUCTS, int(1, 2)).map((code, i) => ({
      code,
      significance: i === 0 ? ('PRIMARY' as const) : ('SECONDARY' as const),
    }));

    const slugName = nameEn
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    return {
      index,
      slug: `perf-${String(index + 1).padStart(5, '0')}-${slugName}`,
      settlementStatus,
      nameAr,
      nameEn,
      governorate,
      latitude,
      longitude,
      population: records,
      landmarks,
      products,
    };
  });
}
