/** First version of a newly created aggregate. */
export const INITIAL_VERSION = 1;

/**
 * An aggregate protected by optimistic locking. `version` starts at
 * {@link INITIAL_VERSION} and the database increments it on every write, so a
 * client that read version 3 can only change the aggregate while it is still
 * at version 3 (docs/kernel.md, "Optimistic locking").
 */
export interface Versioned {
  readonly version: number;
}
