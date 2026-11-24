import type { Page, PageRequest } from '../../../shared/kernel';
import type { EconomyFactFilters, EconomyFactType, EconomyFactValues } from './economy-facts';

/**
 * Which claims a list shows: the published ones; every one (editors); or the
 * published ones plus the reader's own (authors following their submissions).
 */
export type EconomyClaimScope =
  { kind: 'PREFERRED' } | { kind: 'ALL' } | { kind: 'PREFERRED_OR_OWN'; userId: string };

/** A stored fact: its claim id and its value. */
export type EconomyFactRow<T extends EconomyFactType> = EconomyFactValues[T] & { claimId: string };

/** One page of one type's facts about one village. */
export type EconomyListQuery<T extends EconomyFactType> = PageRequest & {
  type: T;
  villageId: string;
  scope: EconomyClaimScope;
  filter: EconomyFactFilters[T];
};

/**
 * Persistence port of the economy fact tables. Writes run in the caller's
 * transaction. Reads that need claim state use curation's SQL fragments, never
 * the `claim` table by name.
 */
export interface EconomyFactRepository {
  /** Stores the fact row of a claim that was just submitted. */
  insert<T extends EconomyFactType>(
    type: T,
    claimId: string,
    value: EconomyFactValues[T],
  ): Promise<void>;

  /** Replaces the value of an unverified fact (its author edited it). */
  update<T extends EconomyFactType>(
    type: T,
    claimId: string,
    value: EconomyFactValues[T],
  ): Promise<void>;

  /** The value of one claim, or `undefined` when it has no row of `type`. */
  findByClaimId<T extends EconomyFactType>(
    type: T,
    claimId: string,
  ): Promise<EconomyFactValues[T] | undefined>;

  /** One page of a village's facts of one type in `scope`: products by code, facilities by type then name. */
  list<T extends EconomyFactType>(query: EconomyListQuery<T>): Promise<Page<EconomyFactRow<T>>>;

  /** Every preferred fact of one type of a village, in the order of {@link list}. */
  preferred<T extends EconomyFactType>(type: T, villageId: string): Promise<EconomyFactRow<T>[]>;

  /** Ids of the villages with a preferred `VILLAGE_PRODUCT` claim for this product. */
  villageIdsWithProduct(productId: string): Promise<string[]>;
}

/** Injection token of the {@link EconomyFactRepository}. */
export const ECONOMY_FACT_REPOSITORY = Symbol('ECONOMY_FACT_REPOSITORY');
