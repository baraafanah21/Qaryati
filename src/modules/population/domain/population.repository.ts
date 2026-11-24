import type { Page, PageRequest } from '../../../shared/kernel';
import type { PopulationValue } from './population-record';
import type { PopulationChange } from './population-stats';

/** A stored record: its claim id and its value. */
export interface PopulationRecordRow extends PopulationValue {
  claimId: string;
}

/**
 * Which claims a list shows: the published ones; every one (editors); or the
 * published ones plus the reader's own (authors following their submissions).
 */
export type PopulationClaimScope =
  { kind: 'PREFERRED' } | { kind: 'ALL' } | { kind: 'PREFERRED_OR_OWN'; userId: string };

/**
 * Persistence port of `population_record`. Writes run in the caller's
 * transaction. Reads that need claim state use curation's SQL fragments, never
 * the `claim` table by name.
 */
export interface PopulationRepository {
  /** Stores the fact row of a claim that was just submitted. */
  insert(claimId: string, value: PopulationValue): Promise<void>;

  /** Replaces the value of an unverified record (its author edited it). */
  update(claimId: string, value: PopulationValue): Promise<void>;

  /** The value of one claim, or `undefined` when it has no population row. */
  findByClaimId(claimId: string): Promise<PopulationValue | undefined>;

  /** One page of a village's records in `scope`, ordered by year, then count type. */
  listForVillage(
    query: PageRequest & { villageId: string; scope: PopulationClaimScope },
  ): Promise<Page<PopulationRecordRow>>;

  /** Every preferred record of a village, ordered by year, then count type. */
  preferredHistory(villageId: string): Promise<PopulationRecordRow[]>;

  /** The most recent preferred record of each village that has one (`DISTINCT ON`). */
  latestPreferred(villageIds: readonly string[]): Promise<Map<string, PopulationRecordRow>>;

  /** The preferred records of a village with their change since the previous one (`lag()`). */
  changes(villageId: string): Promise<PopulationChange[]>;
}

/** Injection token of the {@link PopulationRepository}. */
export const POPULATION_REPOSITORY = Symbol('POPULATION_REPOSITORY');
