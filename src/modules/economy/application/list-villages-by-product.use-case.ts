import { Inject, Injectable } from '@nestjs/common';
import type { Page, PageRequest, Sort } from '../../../shared/kernel';
import type { AuthenticatedUser } from '../../iam';
import { VillageQueries, type VillageSearchHit, type VillageSortField } from '../../village';
import {
  ECONOMY_FACT_REPOSITORY,
  type EconomyFactRepository,
} from '../domain/economy-fact.repository';
import type { Product } from '../domain/product';
import { ProductCatalog } from './product-catalog';

/** `GET /products/{idOrCode}/villages`. */
export interface ListVillagesByProductInput extends PageRequest {
  idOrCode: string;
  sort: Sort<VillageSortField>[];
  viewer: AuthenticatedUser | undefined;
}

/**
 * The villages that produce a product (#36): economy finds the villages with
 * a **preferred** `VILLAGE_PRODUCT` claim for it (one indexed native
 * statement), then hands the ids to village's search facade, which filters by
 * publication status for the viewer, sorts and pages in one statement. Village
 * never imports economy. 404 for an unknown product.
 */
@Injectable()
export class ListVillagesByProduct {
  constructor(
    @Inject(ECONOMY_FACT_REPOSITORY) private readonly facts: EconomyFactRepository,
    private readonly products: ProductCatalog,
    private readonly villages: VillageQueries,
  ) {}

  async execute(
    input: ListVillagesByProductInput,
  ): Promise<{ product: Product; villages: Page<VillageSearchHit> }> {
    const product = await this.products.get(input.idOrCode);
    const villageIds = await this.facts.villageIdsWithProduct(product.id);
    const villages = await this.villages.search({
      villageIds,
      sort: input.sort,
      page: input.page,
      size: input.size,
      viewer: input.viewer,
    });
    return { product, villages };
  }
}
