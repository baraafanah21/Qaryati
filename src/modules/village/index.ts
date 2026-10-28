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
  type SettlementStatus,
  type PublicationStatus,
} from './domain/village-values';
export {
  ADMIN_UNIT_TYPES,
  AUTHORITY_TYPES,
  ADMIN_ERAS,
  type AdminUnitType,
  type AuthorityType,
  type AdminEra,
} from './domain/admin-unit-values';
