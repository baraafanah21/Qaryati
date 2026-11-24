/**
 * Public API of the heritage module.
 *
 * Other modules may import only from this file, and only in the directions
 * listed in docs/architecture.md (enforced by dependency-cruiser). Export
 * facades, DTOs and event types here; never repositories, tables or entities.
 */
export { HeritageQueries, type HeritageSections } from './application/heritage-queries';
export type { HeritageFactRow } from './domain/heritage-fact.repository';
export type {
  CulturalItemValue,
  HeritagePoint,
  HistoricalEventValue,
  HistoryOverviewValue,
  LandmarkValue,
} from './domain/heritage-facts';
export {
  CULTURAL_CATEGORIES,
  DATE_PRECISIONS,
  LANDMARK_ERAS,
  LANDMARK_TYPES,
  isCulturalCategory,
  isDatePrecision,
  isLandmarkEra,
  isLandmarkType,
  type CulturalCategory,
  type DatePrecision,
  type LandmarkEra,
  type LandmarkType,
} from './domain/heritage-values';
