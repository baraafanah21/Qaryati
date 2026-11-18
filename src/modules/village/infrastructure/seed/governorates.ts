/**
 * The 16 current Palestinian governorates: the single source of the list.
 *
 * The data migration `0013_seed_current_governorates.sql` inserts exactly
 * these rows (fixed ids, `ON CONFLICT (code) DO NOTHING`), and
 * `test/village/governorates-seed.int-spec.ts` checks that the migrated
 * database matches this file. Change both together, in a new migration.
 */
export const CURRENT_GOVERNORATES = [
  { id: '01a1ef5b-4742-704c-8b62-1016335f1730', code: 'jenin', nameAr: 'جنين', nameEn: 'Jenin' },
  {
    id: '01a1ef5b-4743-7675-af03-024a12726662',
    code: 'tubas',
    nameAr: 'طوباس والأغوار الشمالية',
    nameEn: 'Tubas and Northern Valleys',
  },
  {
    id: '01a1ef5b-4743-7675-af03-05cf78865fdc',
    code: 'tulkarm',
    nameAr: 'طولكرم',
    nameEn: 'Tulkarm',
  },
  { id: '01a1ef5b-4743-7675-af03-0a3e8e12309a', code: 'nablus', nameAr: 'نابلس', nameEn: 'Nablus' },
  {
    id: '01a1ef5b-4743-7675-af03-0e49e3c8dac5',
    code: 'qalqilya',
    nameAr: 'قلقيلية',
    nameEn: 'Qalqilya',
  },
  { id: '01a1ef5b-4743-7675-af03-1165709e8437', code: 'salfit', nameAr: 'سلفيت', nameEn: 'Salfit' },
  {
    id: '01a1ef5b-4743-7675-af03-1666d136e57c',
    code: 'ramallah-al-bireh',
    nameAr: 'رام الله والبيرة',
    nameEn: 'Ramallah and Al-Bireh',
  },
  {
    id: '01a1ef5b-4743-7675-af03-19958b060a5e',
    code: 'jericho-al-aghwar',
    nameAr: 'أريحا والأغوار',
    nameEn: 'Jericho and Al-Aghwar',
  },
  {
    id: '01a1ef5b-4743-7675-af03-1c2424b059f8',
    code: 'jerusalem',
    nameAr: 'القدس',
    nameEn: 'Jerusalem',
  },
  {
    id: '01a1ef5b-4743-7675-af03-237679f58681',
    code: 'bethlehem',
    nameAr: 'بيت لحم',
    nameEn: 'Bethlehem',
  },
  {
    id: '01a1ef5b-4743-7675-af03-27504aed438a',
    code: 'hebron',
    nameAr: 'الخليل',
    nameEn: 'Hebron',
  },
  {
    id: '01a1ef5b-4743-7675-af03-29b38c18c151',
    code: 'north-gaza',
    nameAr: 'شمال غزة',
    nameEn: 'North Gaza',
  },
  { id: '01a1ef5b-4743-7675-af03-2e1d62c261c9', code: 'gaza', nameAr: 'غزة', nameEn: 'Gaza' },
  {
    id: '01a1ef5b-4743-7675-af03-33e25d6613a1',
    code: 'deir-al-balah',
    nameAr: 'دير البلح',
    nameEn: 'Deir al-Balah',
  },
  {
    id: '01a1ef5b-4743-7675-af03-35105842b3cf',
    code: 'khan-yunis',
    nameAr: 'خان يونس',
    nameEn: 'Khan Yunis',
  },
  { id: '01a1ef5b-4743-7675-af03-3b7d23dfd1cb', code: 'rafah', nameAr: 'رفح', nameEn: 'Rafah' },
] as const;
