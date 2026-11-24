import { normalizeText } from './normalize-text';

describe('normalizeText', () => {
  it('trims and collapses runs of spaces and tabs', () => {
    expect(normalizeText('  a \t  b   c  ')).toBe('a b c');
  });

  it('keeps paragraphs, with at most one blank line between them', () => {
    expect(normalizeText('first  \r\n\r\n\r\n\r\n  second\nthird')).toBe('first\n\nsecond\nthird');
  });

  it('composes to NFC, so the same letters are the same text', () => {
    const decomposed = 'e' + String.fromCharCode(0x0301);
    expect(normalizeText(decomposed)).toBe(String.fromCharCode(0x00e9));
  });

  it('is idempotent and gives an empty string for blank input', () => {
    const once = normalizeText('  قرية   قديمة \n\n\n نص ');
    expect(normalizeText(once)).toBe(once);
    expect(normalizeText(' \n\t ')).toBe('');
  });
});
