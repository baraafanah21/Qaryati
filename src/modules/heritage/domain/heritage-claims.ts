import { buildGroupKey, valueHash } from '../../curation';
import { normalizeName } from '../../village';
import type {
  CulturalItemValue,
  HistoricalEventValue,
  HistoryOverviewValue,
  LandmarkValue,
} from './heritage-facts';
import type { HeritageFactType } from './heritage-fact-types';

/** The question a heritage fact answers and the fingerprint of its value. */
export interface HeritageClaim<T extends HeritageFactType = HeritageFactType> {
  claimType: T;
  groupKey: string;
  valueHash: string;
}

/**
 * A name as a group-key part: {@link normalizeName} (spacing, tashkeel and
 * letter variants do not make another question), and `|`, the key separator,
 * as `/`. Validation guarantees at least one letter or digit.
 */
const nameKey = (name: string): string => normalizeName(name).replaceAll('|', '/');

/** `history|v`: one published overview per village. Hash: the normalized text. */
export function historyOverviewClaim(
  villageId: string,
  value: HistoryOverviewValue,
): HeritageClaim<'HISTORY_OVERVIEW'> {
  return {
    claimType: 'HISTORY_OVERVIEW',
    groupKey: buildGroupKey('HISTORY_OVERVIEW', villageId),
    valueHash: valueHash({ summary: value.summary }),
  };
}

/**
 * `event|v|normalized title`: each event of a village is its own question.
 * Hash: the dates, their precision and the description, so two sources giving
 * another date for the same event are a conflict.
 */
export function historicalEventClaim(
  villageId: string,
  value: HistoricalEventValue,
): HeritageClaim<'HISTORICAL_EVENT'> {
  return {
    claimType: 'HISTORICAL_EVENT',
    groupKey: buildGroupKey('HISTORICAL_EVENT', villageId, nameKey(value.title)),
    valueHash: valueHash({
      startDate: value.startDate,
      endDate: value.endDate,
      datePrecision: value.datePrecision,
      description: value.description,
    }),
  };
}

/**
 * `landmark|v|normalized name`. Hash: the type, the point (already rounded to
 * 5 decimals) and the description.
 */
export function landmarkClaim(villageId: string, value: LandmarkValue): HeritageClaim<'LANDMARK'> {
  return {
    claimType: 'LANDMARK',
    groupKey: buildGroupKey('LANDMARK', villageId, nameKey(value.name)),
    valueHash: valueHash({
      landmarkType: value.landmarkType,
      location: value.location && {
        latitude: value.location.latitude,
        longitude: value.location.longitude,
      },
      description: value.description,
    }),
  };
}

/** `culture|v|category|normalized name`. Hash: the description. */
export function culturalItemClaim(
  villageId: string,
  value: CulturalItemValue,
): HeritageClaim<'CULTURAL_ITEM'> {
  return {
    claimType: 'CULTURAL_ITEM',
    groupKey: buildGroupKey('CULTURAL_ITEM', villageId, value.category, nameKey(value.name)),
    valueHash: valueHash({ description: value.description }),
  };
}
