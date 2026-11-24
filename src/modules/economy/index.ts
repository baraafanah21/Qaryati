/**
 * Public API of the economy module.
 *
 * Other modules may import only from this file, and only in the directions
 * listed in docs/architecture.md (enforced by dependency-cruiser). Export
 * facades, DTOs and event types here; never repositories, tables or entities.
 */
export {
  EconomyQueries,
  type EconomySections,
  type PublishedVillageProduct,
} from './application/economy-queries';
export type { EconomyFactRow } from './domain/economy-fact.repository';
export type { EconomyPoint, FacilityValue, VillageProductValue } from './domain/economy-facts';
export type { Product } from './domain/product';
export {
  FACILITY_TYPES,
  PRODUCT_CATEGORIES,
  PRODUCT_SIGNIFICANCES,
  isFacilityType,
  isProductCategory,
  isProductSignificance,
  type FacilityType,
  type ProductCategory,
  type ProductSignificance,
} from './domain/economy-values';
