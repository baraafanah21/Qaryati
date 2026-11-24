import { buildGroupKey, valueHash } from '../../curation';
import type { PopulationValue } from './population-record';

/** The question a population record answers and the fingerprint of its value. */
export interface PopulationClaim {
  claimType: 'POPULATION';
  groupKey: string;
  valueHash: string;
}

/**
 * `population|v|year|count_type` (docs/data-model.md, "Claim types"): one
 * published number per village, year and count type. Hash: the population only,
 * so two sources giving the same number for the same question agree, and a
 * different number is a conflict (rule 4), never an overwrite.
 */
export function populationClaim(villageId: string, value: PopulationValue): PopulationClaim {
  return {
    claimType: 'POPULATION',
    groupKey: buildGroupKey('POPULATION', villageId, String(value.referenceYear), value.countType),
    valueHash: valueHash({ population: value.population }),
  };
}
