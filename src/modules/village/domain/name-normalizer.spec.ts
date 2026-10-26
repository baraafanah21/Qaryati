import { normalizeName } from './name-normalizer';

const normalizationCases = [
  { name: 'removes tashkeel from Beit Furik', input: 'بيتُ فوريك', expected: 'بيت فوريك' },
  { name: 'preserves the plain Beit Furik spelling', input: 'بيت فوريك', expected: 'بيت فوريك' },
  { name: 'unifies alef with hamza below in Idhna', input: 'إذنا', expected: 'اذنا' },
  { name: 'preserves plain alef in Idhna', input: 'اذنا', expected: 'اذنا' },
  { name: 'normalizes Abu Dis', input: 'أبو ديس', expected: 'ابو ديس' },
  { name: 'normalizes alef madda and alef wasla', input: 'آرابة ٱذنا', expected: 'ارابه اذنا' },
  { name: 'removes tashkeel from Saffuriyya', input: 'صَفُّورِيَّة', expected: 'صفوريه' },
  { name: 'removes tashkeel from Yatta', input: 'يَطّا', expected: 'يطا' },
  { name: 'normalizes ta marbuta in Qalqilya', input: 'قلقيلية', expected: 'قلقيليه' },
  { name: 'normalizes alef maqsura', input: 'مصلى', expected: 'مصلي' },
  { name: 'removes tatweel', input: 'قريــة', expected: 'قريه' },
  { name: 'normalizes Arabic presentation forms', input: 'ﺑﻴﺖ', expected: 'بيت' },
  {
    name: 'normalizes full-width Latin forms with NFKC',
    input: 'Ｂｅｉｔ－Ｆｕｒｉｋ',
    expected: 'beit furik',
  },
  { name: 'removes Quranic marks', input: 'الْقُدْسۖ', expected: 'القدس' },
  { name: 'normalizes Arabic-Indic and Persian digits', input: '٤٥ ۱۲۳', expected: '45 123' },
  { name: 'removes Latin accents from Beit Furik', input: 'Beit Fūrīk', expected: 'beit furik' },
  { name: 'keeps Bayt distinct from Beit', input: 'Bayt Furik', expected: 'bayt furik' },
  {
    name: 'normalizes uppercase hyphenated Beit Furik',
    input: 'BEIT-FURIK',
    expected: 'beit furik',
  },
  {
    name: 'removes the ayn transliteration mark from Anabta',
    input: 'ʿAnabta',
    expected: 'anabta',
  },
  {
    name: 'removes all hamza and apostrophe transliteration marks',
    input: "ʾAnabta 'Anabta ’Anabta ‘Anabta `Anabta",
    expected: 'anabta anabta anabta anabta anabta',
  },
  { name: 'removes Latin diacritics from Ṣaffūriyya', input: 'Ṣaffūriyya', expected: 'saffuriyya' },
  { name: 'removes Latin diacritics from Yaṭṭa', input: 'Yaṭṭa', expected: 'yatta' },
  { name: 'normalizes Persian kaf and yeh', input: 'کفر یاسيف', expected: 'كفر ياسيف' },
  {
    name: 'replaces underscores and dots with spaces',
    input: 'beit_furik.village',
    expected: 'beit furik village',
  },
  { name: 'removes a right-to-left mark', input: 'بيت‏فوريك', expected: 'بيتفوريك' },
  {
    name: 'removes a right-to-left mark next to a space',
    input: 'بيت‏ فوريك',
    expected: 'بيت فوريك',
  },
  {
    name: 'removes a zero-width non-joiner',
    input: 'بيت‌ فوريك',
    expected: 'بيت فوريك',
  },
  { name: 'removes an Arabic letter mark', input: 'بيت؜ فوريك', expected: 'بيت فوريك' },
  { name: 'removes a soft hyphen', input: 'Beit Fu­rik', expected: 'beit furik' },
  { name: 'replaces an en dash with a space', input: 'Beit–Furik', expected: 'beit furik' },
  { name: 'replaces an em dash with a space', input: 'Beit—Furik', expected: 'beit furik' },
  {
    name: 'removes the modifier turned comma mark',
    input: 'Bayt ʻAnan',
    expected: 'bayt anan',
  },
  {
    name: 'removes the modifier apostrophe mark',
    input: 'Bayt ʼAnan',
    expected: 'bayt anan',
  },
  { name: 'preserves the Arabic definite article', input: 'القرية', expected: 'القريه' },
  { name: 'preserves word boundaries', input: 'بيرزيت', expected: 'بيرزيت' },
  { name: 'does not merge separated words', input: 'بير زيت', expected: 'بير زيت' },
  { name: 'preserves waw with hamza and normalizes ta marbuta', input: 'مؤتة', expected: 'مؤته' },
  { name: 'preserves yeh with hamza', input: 'مسئول', expected: 'مسئول' },
  { name: 'collapses and trims whitespace', input: '  بيت   فوريك \t', expected: 'بيت فوريك' },
  {
    name: 'preserves mixed Arabic and Latin text',
    input: 'بيت Fūrīk ٤٥',
    expected: 'بيت furik 45',
  },
  { name: 'returns an empty string for empty input', input: '', expected: '' },
  { name: 'returns an empty string for whitespace-only input', input: ' \t\n ', expected: '' },
  { name: 'does not throw for an unmatched surrogate', input: '\uD800', expected: '\uD800' },
] as const;

describe('normalizeName', () => {
  it.each(normalizationCases)('$name', ({ input, expected }) => {
    expect(normalizeName(input)).toBe(expected);
  });

  it.each(normalizationCases)('is idempotent for $name', ({ input }) => {
    const normalized = normalizeName(input);

    expect(normalizeName(normalized)).toBe(normalized);
  });
});
