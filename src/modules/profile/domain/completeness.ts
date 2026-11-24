/** How much of a village's knowledge is published, by claim type. */
export interface Completeness<T extends string> {
  /** 0–100: the share of claim types with a published (preferred) claim, rounded down. */
  score: number;
  /** Claim types with at least one published claim, in the order of the full list. */
  present: T[];
  /** Claim types with no published claim, in the order of the full list. */
  missing: T[];
}

/**
 * The completeness of a village (#39): every claim type counts the same, and
 * a type is complete as soon as one claim of it is published. Rounded down,
 * so 100 means nothing is missing. Types in `published` outside `allTypes`
 * are ignored; an empty `allTypes` is complete.
 */
export function completenessOf<T extends string>(
  allTypes: readonly T[],
  published: Iterable<string>,
): Completeness<T> {
  const have = new Set(published);
  const present = allTypes.filter((type) => have.has(type));
  const missing = allTypes.filter((type) => !have.has(type));
  const score = allTypes.length === 0 ? 100 : Math.floor((present.length * 100) / allTypes.length);
  return { score, present, missing };
}
