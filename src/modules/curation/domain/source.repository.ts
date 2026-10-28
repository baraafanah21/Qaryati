import type { Id, Page, PageRequest, Sort } from '../../../shared/kernel';
import type { Source, SourceType } from './source';

/** Fields supported for sorting source records. */
export type SourceSortField = 'title' | 'publishedYear' | 'reliability' | 'createdAt';

/** Validated search, filtering, pagination and sorting options. */
export interface SourceListQuery extends PageRequest {
  q?: string;
  type?: SourceType;
  sort: Sort<SourceSortField>[];
}

/**
 * Persistence port for information sources.
 * Soft-deleted sources are excluded from all reads.
 * Writes participate in the caller's transaction.
 */
export interface SourceRepository {
  /** Inserts a new source. */
  insert(source: Source): Promise<Source>;

  /** Finds an active source by its identifier. */
  findById(id: Id<'Source'>): Promise<Source | undefined>;

  /** Lists sources with filtering, searching and pagination. */
  list(query: SourceListQuery): Promise<Page<Source>>;

  /**
   * Updates a source using optimistic locking.
   * Throws NotFoundError or PreconditionFailedError when appropriate.
   */
  update(source: Source, expectedVersion: number): Promise<Source>;

  /** Checks whether a non-deleted source exists. */
  exists(id: Id<'Source'>): Promise<boolean>;
}

/** Injection token for SourceRepository. */
export const SOURCE_REPOSITORY = Symbol('SOURCE_REPOSITORY');
