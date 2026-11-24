import type { ClaimView } from '../../curation';
import type { HeritageFactType, HeritageFactValues } from '../domain/heritage-fact-types';

/** One fact as the API returns it: the claim's provenance and review state, and the value. */
export interface HeritageFact<T extends HeritageFactType> {
  claim: ClaimView;
  value: HeritageFactValues[T];
}
