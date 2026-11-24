import type { ClaimView } from '../../curation';
import type { VillageFactType, VillageFactValues } from '../domain/village-fact.repository';
import type {
  validateAffiliation,
  validateLocation,
  validateMeasure,
  validateNameOrigin,
  validateVillageName,
} from '../domain/village-facts';

/** What a client sends for each fact type, before the domain validates it. */
export interface VillageFactInputs {
  VILLAGE_NAME: Parameters<typeof validateVillageName>[0];
  NAME_ORIGIN: Parameters<typeof validateNameOrigin>[0];
  AFFILIATION: Parameters<typeof validateAffiliation>[0];
  LOCATION: Parameters<typeof validateLocation>[0];
  MEASURE: Parameters<typeof validateMeasure>[0];
  RELATION: { relatedVillageId: string; relationType: string };
}

/** One fact as the API returns it: the claim's provenance and review state, and the value. */
export interface VillageFact<T extends VillageFactType = VillageFactType> {
  claim: ClaimView;
  value: VillageFactValues[T];
}
