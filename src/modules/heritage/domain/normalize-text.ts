const HORIZONTAL_SPACE = /[^\S\n]+/gu;
const SPACE_AROUND_NEWLINE = / ?\n ?/gu;
const BLANK_LINES = /\n{3,}/gu;

/**
 * Canonical form of free text (summaries, descriptions): NFC, Windows line
 * ends as `\n`, every run of spaces or tabs as one space, at most one blank
 * line between paragraphs, trimmed. Paragraphs survive, so a long text keeps
 * its layout; two texts that differ only in spacing are the same value.
 * Idempotent, and never throws for a string.
 */
export function normalizeText(input: string): string {
  return input
    .normalize('NFC')
    .replace(/\r\n?/gu, '\n')
    .replace(HORIZONTAL_SPACE, ' ')
    .replace(SPACE_AROUND_NEWLINE, '\n')
    .replace(BLANK_LINES, '\n\n')
    .trim();
}
