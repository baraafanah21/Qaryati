import type { PageRequest, Sort } from '../../../shared/kernel';
import type { GeoPoint } from './village';
import type { PublicationStatus, SettlementStatus } from './village-values';

/** Fields `GET /villages` may sort by; each one has an index (or is computed only for `q`). */
export const VILLAGE_SORT_FIELDS = ['nameAr', 'nameEn', 'createdAt', 'relevance'] as const;
export type VillageSortField = (typeof VILLAGE_SORT_FIELDS)[number];

/** Exact, case-sensitive membership check of {@link VILLAGE_SORT_FIELDS}. */
export function isVillageSortField(value: string): value is VillageSortField {
  return (VILLAGE_SORT_FIELDS as readonly string[]).includes(value);
}

/** Most village ids one search may filter by (`?ids=`, or economy's product filter). */
export const MAX_SEARCH_VILLAGE_IDS = 100;

/**
 * What the repository searches for. Every filter is optional and all given
 * filters must match. `q` is already normalized; `publicationStatus` undefined
 * means every status (only editors get that).
 */
export interface VillageSearchCriteria extends PageRequest {
  q?: string;
  governorateId?: string;
  settlementStatus?: SettlementStatus;
  publicationStatus?: PublicationStatus;
  villageIds?: readonly string[];
  sort: Sort<VillageSortField>[];
}

/** One village in a search result. `relevance` is the best trigram similarity, `null` without `q`. */
export interface VillageSearchHit {
  id: string;
  slug: string;
  settlementStatus: SettlementStatus;
  publicationStatus: PublicationStatus;
  displayNameAr: string;
  displayNameEn: string | null;
  location: GeoPoint | null;
  createdAt: Date;
  relevance: number | null;
}

/**
 * The sort a search runs with: the client's when it sent one, otherwise best
 * match first with `q` and the Arabic name without. `relevance` only exists
 * with `q`; the HTTP schema rejects it without, and this drops it for callers
 * that bypass the schema (the facade), so the SQL never orders by a constant.
 */
export function resolveVillageSort(
  requested: readonly Sort<VillageSortField>[],
  hasQuery: boolean,
): Sort<VillageSortField>[] {
  const usable = requested.filter((sort) => hasQuery || sort.field !== 'relevance');
  if (usable.length > 0) return usable;
  return hasQuery
    ? [{ field: 'relevance', direction: 'desc' }]
    : [{ field: 'nameAr', direction: 'asc' }];
}

/**
 * Which publication status a viewer searches in. Readers below editor see
 * published villages only, whatever they asked for; editors see every status
 * unless they filter by one.
 */
export function visiblePublicationStatus(
  isEditor: boolean,
  requested: PublicationStatus | undefined,
): PublicationStatus | undefined {
  return isEditor ? requested : 'PUBLISHED';
}
