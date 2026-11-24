import type { Id, Page } from '../../../shared/kernel';
import type { Village } from './village';
import type { VillageSearchCriteria, VillageSearchHit } from './village-search';

/** Persistence port of the village identity. Writes run in the caller's transaction. */
export interface VillageRepository {
  /** Stores a new village; a taken slug surfaces as the database's unique violation (409). */
  insert(village: Village): Promise<Village>;
  findById(id: Id<'Village'>): Promise<Village | undefined>;
  findBySlug(slug: string): Promise<Village | undefined>;
  /** The villages with these ids, in no particular order; unknown ids are absent. One query. */
  findByIds(ids: readonly Id<'Village'>[]): Promise<Village[]>;
  existsBySlug(slug: string): Promise<boolean>;
  exists(id: Id<'Village'>): Promise<boolean>;
  /** Stores identity fields if still at `expectedVersion`; 404 / 412 otherwise. */
  update(village: Village, expectedVersion: number): Promise<Village>;
  /** Hard delete if still at `expectedVersion`; a village with claims fails with 409. */
  delete(id: Id<'Village'>, expectedVersion: number): Promise<Village>;
  /**
   * One page of villages matching every given criterion, sorted as asked (then
   * by id), with the total from a count query using the same filters.
   */
  search(criteria: VillageSearchCriteria): Promise<Page<VillageSearchHit>>;
}

/** Injection token of the {@link VillageRepository}. */
export const VILLAGE_REPOSITORY = Symbol('VILLAGE_REPOSITORY');
