/** Languages of the two display-name projections on `village`. */
export const DISPLAY_NAME_LANGS = ['ar', 'en'] as const;
export type DisplayNameLang = (typeof DISPLAY_NAME_LANGS)[number];

/**
 * Whether a display name may still be edited directly.
 *
 * `display_name_ar` / `display_name_en` are projections of the preferred
 * `CURRENT` name claim in the same language. Until such a claim is
 * published, the name typed at creation is all there is, so it stays
 * editable. Once it is published, the name comes from claims only: a change
 * is a new claim, reviewed like any other fact. Historical names and
 * alternative spellings never lock it, and each language is decided on its
 * own (`en` stays editable until an English `CURRENT` name is published).
 */
export function canEditDisplayName(
  _lang: DisplayNameLang,
  hasPreferredCurrentName: boolean,
): boolean {
  return !hasPreferredCurrentName;
}
