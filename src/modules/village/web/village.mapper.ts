import type { Village } from '../domain/village';
import type { VillageSearchHit } from '../domain/village-search';
import type { VillageResponse, VillageSummary } from './village.schemas';

/** The response body for one village. Dates become ISO strings here. */
export function toVillageResponse(village: Village): VillageResponse {
  return {
    id: village.id,
    slug: village.slug,
    settlementStatus: village.settlementStatus,
    publicationStatus: village.publicationStatus,
    displayNameAr: village.displayNameAr,
    displayNameEn: village.displayNameEn,
    location: village.location,
    createdBy: village.createdBy,
    version: village.version,
    createdAt: village.createdAt.toISOString(),
    updatedAt: village.updatedAt.toISOString(),
  };
}

/** One search hit as the API returns it. */
export function toVillageSummary(hit: VillageSearchHit): VillageSummary {
  return {
    id: hit.id,
    slug: hit.slug,
    settlementStatus: hit.settlementStatus,
    publicationStatus: hit.publicationStatus,
    displayNameAr: hit.displayNameAr,
    displayNameEn: hit.displayNameEn,
    location: hit.location,
    createdAt: hit.createdAt.toISOString(),
    // similarity() is a float4: round away the noise of its binary representation.
    relevance: hit.relevance === null ? null : Math.round(hit.relevance * 1000) / 1000,
  };
}
