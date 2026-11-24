import type { ClaimView } from '../../curation';
import type { EconomyFactType, EconomyFactValues } from '../domain/economy-facts';
import type { Product } from '../domain/product';

/**
 * One fact as the API returns it: the claim's provenance and review state, the
 * value, and for a village product the product it names (reference data).
 */
export interface EconomyFact<T extends EconomyFactType> {
  claim: ClaimView;
  value: EconomyFactValues[T];
  product?: Product;
}
