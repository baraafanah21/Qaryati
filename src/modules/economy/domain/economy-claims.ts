import { buildGroupKey, valueHash } from '../../curation';
import { normalizeName } from '../../village';
import {
  validateFacility,
  validateVillageProduct,
  type EconomyFactInputs,
  type EconomyFactType,
  type EconomyFactValues,
  type FacilityValue,
  type VillageProductValue,
} from './economy-facts';

/** The question an economy fact answers and the fingerprint of its value. */
export interface EconomyClaim<T extends EconomyFactType = EconomyFactType> {
  claimType: T;
  groupKey: string;
  valueHash: string;
}

/**
 * `product|v|product_id`: does the village produce this product, and how much
 * does it matter. Hash: the significance, so `PRIMARY` from one source and
 * `SECONDARY` from another are a conflict on the same question.
 */
export function villageProductClaim(
  villageId: string,
  value: VillageProductValue,
): EconomyClaim<'VILLAGE_PRODUCT'> {
  return {
    claimType: 'VILLAGE_PRODUCT',
    groupKey: buildGroupKey('VILLAGE_PRODUCT', villageId, value.productId),
    valueHash: valueHash({ significance: value.significance }),
  };
}

/**
 * `facility|v|type|normalized name`: each facility of a village is its own
 * question; `normalizeName` makes spacing, tashkeel and letter variants the
 * same facility, and a `|` (the key separator) becomes `/`. Hash: the rounded
 * point and the established year.
 */
export function facilityClaim(villageId: string, value: FacilityValue): EconomyClaim<'FACILITY'> {
  return {
    claimType: 'FACILITY',
    groupKey: buildGroupKey(
      'FACILITY',
      villageId,
      value.facilityType,
      normalizeName(value.name).replaceAll('|', '/'),
    ),
    valueHash: valueHash({
      location: value.location && {
        latitude: value.location.latitude,
        longitude: value.location.longitude,
      },
      establishedYear: value.establishedYear,
    }),
  };
}

/** A validated value and the claim it answers. */
export interface PreparedEconomyFact<T extends EconomyFactType> {
  value: EconomyFactValues[T];
  claim: EconomyClaim<T>;
}

/**
 * Validates the value of `type` (422 naming every broken field) and builds its
 * question and hash. `currentYear` comes from the `Clock`.
 */
export function prepareEconomyFact<T extends EconomyFactType>(
  type: T,
  villageId: string,
  raw: EconomyFactInputs[T],
  currentYear: number,
): PreparedEconomyFact<T> {
  if (type === 'VILLAGE_PRODUCT') {
    const value = validateVillageProduct(raw as EconomyFactInputs['VILLAGE_PRODUCT']);
    return { value, claim: villageProductClaim(villageId, value) } as PreparedEconomyFact<T>;
  }
  const value = validateFacility(raw as EconomyFactInputs['FACILITY'], currentYear);
  return { value, claim: facilityClaim(villageId, value) } as PreparedEconomyFact<T>;
}
