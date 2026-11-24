/**
 * Public API of the village module.
 *
 * Other modules may import only from this file, and only in the directions
 * listed in docs/architecture.md (enforced by dependency-cruiser). Export
 * facades, DTOs and event types here; never repositories, tables or entities.
 */
export { normalizeName } from './domain/name-normalizer';
export {
  SETTLEMENT_STATUSES,
  PUBLICATION_STATUSES,
  isSettlementStatus,
  isPublicationStatus,
  type SettlementStatus,
  type PublicationStatus,
} from './domain/village-values';
export {
  ADMIN_UNIT_TYPES,
  AUTHORITY_TYPES,
  ADMIN_ERAS,
  isAdminUnitType,
  isAuthorityType,
  isAdminEra,
  type AdminUnitType,
  type AuthorityType,
  type AdminEra,
} from './domain/admin-unit-values';
export { VillageQueries, type VillageView } from './application/village-queries';
export { AdminUnitQueries } from './application/admin-unit-queries';
export type { SearchVillagesInput } from './application/search-villages.use-case';
export {
  VILLAGE_SORT_FIELDS,
  MAX_SEARCH_VILLAGE_IDS,
  type VillageSortField,
  type VillageSearchHit,
} from './domain/village-search';
export type { AdminUnit, AdminUnitFilter } from './domain/admin-unit';
export type { GeoPoint } from './domain/village';
export {
  NAME_TYPES,
  LOCATION_PRECISIONS,
  MEASURE_KINDS,
  RELATION_TYPES,
  isNameType,
  isLocationPrecision,
  isMeasureKind,
  isRelationType,
  type NameType,
  type LocationPrecision,
  type MeasureKind,
  type RelationType,
} from './domain/fact-values';
export { VILLAGE_LOCATION_CHANGED, type VillageLocationChanged } from './domain/village-events';
