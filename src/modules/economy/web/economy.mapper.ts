import { mapPage, type Page } from '../../../shared/kernel';
import type { VillageSearchHit } from '../../village';
import type { EconomyFact } from '../application/economy-fact-view';
import type { EconomyFactType, EconomyFactValues } from '../domain/economy-facts';
import type { Product } from '../domain/product';
import type { ProductResponse, ProductVillage } from './economy.schemas';

/** One fact as a flat response body: the claim fields, then the value (and the product). */
export type EconomyFactResponse<T extends EconomyFactType> = EconomyFactValues[T] & {
  claimId: string;
  status: string;
  isPreferred: boolean;
  sourceId: string | null;
  sourceLocator: string | null;
  supersedesId: string | null;
  createdBy: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  product?: Pick<Product, 'code' | 'category' | 'nameAr' | 'nameEn'>;
};

export function toFactResponse<T extends EconomyFactType>(
  fact: EconomyFact<T>,
): EconomyFactResponse<T> {
  const { claim, value, product } = fact;
  return {
    claimId: claim.id,
    status: claim.status,
    isPreferred: claim.isPreferred,
    sourceId: claim.sourceId,
    sourceLocator: claim.sourceLocator,
    supersedesId: claim.supersedesId,
    createdBy: claim.createdBy,
    version: claim.version,
    createdAt: claim.createdAt.toISOString(),
    updatedAt: claim.updatedAt.toISOString(),
    ...value,
    ...(product && {
      product: {
        code: product.code,
        category: product.category,
        nameAr: product.nameAr,
        nameEn: product.nameEn,
      },
    }),
  };
}

export function toFactPage<T extends EconomyFactType>(
  page: Page<EconomyFact<T>>,
): Page<EconomyFactResponse<T>> {
  return mapPage(page, toFactResponse);
}

export function toProductResponse(product: Product): ProductResponse {
  return {
    ...product,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}

export function toProductVillage(hit: VillageSearchHit): ProductVillage {
  return {
    id: hit.id,
    slug: hit.slug,
    settlementStatus: hit.settlementStatus,
    publicationStatus: hit.publicationStatus,
    displayNameAr: hit.displayNameAr,
    displayNameEn: hit.displayNameEn,
    location: hit.location,
    createdAt: hit.createdAt.toISOString(),
  };
}
