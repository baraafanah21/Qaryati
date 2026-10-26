const ARABIC_MARKS = /[\u064B-\u065F\u0670\u06D6-\u06ED]/gu;
const TATWEEL = /\u0640/gu;
const ALEF_VARIANTS = /[أإآٱ]/gu;
const TA_MARBUTA = /ة/gu;
const ALEF_MAQSURA = /ى/gu;
const PERSIAN_KAF = /ک/gu;
const PERSIAN_YEH = /ی/gu;
const ARABIC_INDIC_DIGITS = /[\u0660-\u0669]/gu;
const PERSIAN_DIGITS = /[\u06F0-\u06F9]/gu;
const LATIN_TEXT = /[\p{Script=Latin}\u0300-\u036F]+/gu;
const LATIN_ACCENTS = /[\u0300-\u036F]/gu;
const TRANSLITERATION_MARKS = /[\u02BF\u02BE'’‘`]/gu;
const NAME_SEPARATORS = /[-_.]/gu;
const WHITESPACE = /\s+/gu;

/**
 * Normalizes Arabic and Latin names for consistent comparison and search.
 *
 * It applies NFKC, removes Arabic marks and Latin accents, unifies common
 * Arabic letter and digit variants, normalizes separators and whitespace,
 * and lowercases Latin text. It preserves the Arabic article and word
 * boundaries, and is idempotent. For string input, this function never throws.
 *
 * @param input - The original Arabic, Latin, or mixed-script name.
 * @returns A normalized name, or an empty string for empty or whitespace-only input.
 */
export function normalizeName(input: string): string {
  return input
    .normalize('NFKC')
    .replace(ARABIC_MARKS, '')
    .replace(TATWEEL, '')
    .replace(ALEF_VARIANTS, 'ا')
    .replace(TA_MARBUTA, 'ه')
    .replace(ALEF_MAQSURA, 'ي')
    .replace(PERSIAN_KAF, 'ك')
    .replace(PERSIAN_YEH, 'ي')
    .replace(ARABIC_INDIC_DIGITS, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(PERSIAN_DIGITS, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(LATIN_TEXT, (text) => text.normalize('NFD').replace(LATIN_ACCENTS, ''))
    .replace(TRANSLITERATION_MARKS, '')
    .replace(NAME_SEPARATORS, ' ')
    .toLowerCase()
    .replace(WHITESPACE, ' ')
    .trim();
}
