import {
  culturalItemClaim,
  historicalEventClaim,
  historyOverviewClaim,
  landmarkClaim,
  type HeritageClaim,
} from './heritage-claims';
import type { HeritageFactType, HeritageFactValues } from './heritage-fact-types';
import {
  validateCulturalItem,
  validateHistoricalEvent,
  validateHistoryOverview,
  validateLandmark,
} from './heritage-facts';

/** The raw (unvalidated) input of each type, as the API accepts it. */
export interface HeritageFactInputs {
  HISTORY_OVERVIEW: Parameters<typeof validateHistoryOverview>[0];
  HISTORICAL_EVENT: Parameters<typeof validateHistoricalEvent>[0];
  LANDMARK: Parameters<typeof validateLandmark>[0];
  CULTURAL_ITEM: Parameters<typeof validateCulturalItem>[0];
}

/** A validated value and the claim it answers. */
export interface PreparedHeritageFact<T extends HeritageFactType> {
  value: HeritageFactValues[T];
  claim: HeritageClaim<T>;
}

type AnyInput = {
  [T in HeritageFactType]: { type: T; raw: HeritageFactInputs[T] };
}[HeritageFactType];

/**
 * Validates the value of `type` (422 naming every broken field) and builds its
 * question and hash. `today` is `YYYY-MM-DD` from the `Clock` (events cannot
 * start in the future).
 */
export function prepareHeritageFact<T extends HeritageFactType>(
  type: T,
  villageId: string,
  raw: HeritageFactInputs[T],
  today: string,
): PreparedHeritageFact<T> {
  return prepareAny(villageId, { type, raw } as AnyInput, today) as PreparedHeritageFact<T>;
}

function prepareAny(
  villageId: string,
  input: AnyInput,
  today: string,
): PreparedHeritageFact<HeritageFactType> {
  switch (input.type) {
    case 'HISTORY_OVERVIEW': {
      const value = validateHistoryOverview(input.raw);
      return { value, claim: historyOverviewClaim(villageId, value) };
    }
    case 'HISTORICAL_EVENT': {
      const value = validateHistoricalEvent(input.raw, today);
      return { value, claim: historicalEventClaim(villageId, value) };
    }
    case 'LANDMARK': {
      const value = validateLandmark(input.raw);
      return { value, claim: landmarkClaim(villageId, value) };
    }
    case 'CULTURAL_ITEM': {
      const value = validateCulturalItem(input.raw);
      return { value, claim: culturalItemClaim(villageId, value) };
    }
  }
}
