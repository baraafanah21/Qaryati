import type { Village } from '../domain/village';
import type { VillageResponse } from './village.schemas';

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
