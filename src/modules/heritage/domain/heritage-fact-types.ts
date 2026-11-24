import type {
  CulturalItemValue,
  HistoricalEventValue,
  HistoryOverviewValue,
  LandmarkValue,
} from './heritage-facts';
import type { CulturalCategory, LandmarkType } from './heritage-values';

/** The value of each heritage fact, by claim type. */
export interface HeritageFactValues {
  HISTORY_OVERVIEW: HistoryOverviewValue;
  HISTORICAL_EVENT: HistoricalEventValue;
  LANDMARK: LandmarkValue;
  CULTURAL_ITEM: CulturalItemValue;
}

/** A claim type whose value the heritage module stores. */
export type HeritageFactType = keyof HeritageFactValues;

/** The claim types of the heritage module, in the order of docs/data-model.md. */
export const HERITAGE_FACT_TYPES = [
  'HISTORY_OVERVIEW',
  'HISTORICAL_EVENT',
  'LANDMARK',
  'CULTURAL_ITEM',
] as const satisfies readonly HeritageFactType[];

/** The list filter each type accepts (`?type=` for landmarks, `?category=` for cultural items). */
export interface HeritageFactFilters {
  HISTORY_OVERVIEW: Record<string, never>;
  HISTORICAL_EVENT: Record<string, never>;
  LANDMARK: { landmarkType?: LandmarkType };
  CULTURAL_ITEM: { category?: CulturalCategory };
}
