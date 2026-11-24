import type { Page, PageRequest } from '../../../shared/kernel';
import type {
  HeritageFactFilters,
  HeritageFactType,
  HeritageFactValues,
} from './heritage-fact-types';

/**
 * Which claims a list shows: the published ones; every one (editors); or the
 * published ones plus the reader's own (authors following their submissions).
 */
export type HeritageClaimScope =
  { kind: 'PREFERRED' } | { kind: 'ALL' } | { kind: 'PREFERRED_OR_OWN'; userId: string };

/** A stored fact: its claim id and its value. */
export type HeritageFactRow<T extends HeritageFactType> = HeritageFactValues[T] & {
  claimId: string;
};

/** One page of one type's facts about one village. */
export type HeritageListQuery<T extends HeritageFactType> = PageRequest & {
  type: T;
  villageId: string;
  scope: HeritageClaimScope;
  filter: HeritageFactFilters[T];
};

/**
 * Persistence port of the heritage fact tables. Writes run in the caller's
 * transaction. Reads that need claim state use curation's SQL fragments, never
 * the `claim` table by name. Points are read and written with native SQL.
 */
export interface HeritageFactRepository {
  /** Stores the fact row of a claim that was just submitted. */
  insert<T extends HeritageFactType>(
    type: T,
    claimId: string,
    value: HeritageFactValues[T],
  ): Promise<void>;

  /** Replaces the value of an unverified fact (its author edited it). */
  update<T extends HeritageFactType>(
    type: T,
    claimId: string,
    value: HeritageFactValues[T],
  ): Promise<void>;

  /** The value of one claim, or `undefined` when it has no row of `type`. */
  findByClaimId<T extends HeritageFactType>(
    type: T,
    claimId: string,
  ): Promise<HeritageFactValues[T] | undefined>;

  /**
   * One page of a village's facts of one type in `scope`: the overview by
   * claim age, events by start date, landmarks by name, cultural items by
   * category then name.
   */
  list<T extends HeritageFactType>(query: HeritageListQuery<T>): Promise<Page<HeritageFactRow<T>>>;

  /** Every preferred fact of one type of a village, in the order of {@link list}. */
  preferred<T extends HeritageFactType>(type: T, villageId: string): Promise<HeritageFactRow<T>[]>;
}

/** Injection token of the {@link HeritageFactRepository}. */
export const HERITAGE_FACT_REPOSITORY = Symbol('HERITAGE_FACT_REPOSITORY');
