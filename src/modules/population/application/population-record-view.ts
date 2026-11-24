import type { ClaimView } from '../../curation';
import type { PopulationValue } from '../domain/population-record';
import type { PopulationWarning } from '../domain/population-values';

/** One record as the API returns it: the claim's provenance and review state, and the value. */
export interface PopulationRecord {
  claim: ClaimView;
  value: PopulationValue;
}

/** A record just submitted or edited, with the non-blocking warnings of rule 5. */
export interface WrittenPopulationRecord extends PopulationRecord {
  warnings: PopulationWarning[];
}
