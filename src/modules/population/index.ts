/**
 * Public API of the population module.
 *
 * Other modules may import only from this file, and only in the directions
 * listed in docs/architecture.md (enforced by dependency-cruiser). Export
 * facades, DTOs and event types here; never repositories, tables or entities.
 */
export { PopulationQueries, type PopulationRecordView } from './application/population-queries';
export {
  COUNT_TYPES,
  isCountType,
  MAX_LATEST_VILLAGE_IDS,
  type CountType,
} from './domain/population-values';
