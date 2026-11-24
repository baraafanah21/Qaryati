import { Inject, Injectable } from '@nestjs/common';
import {
  ECONOMY_FACT_REPOSITORY,
  type EconomyFactRepository,
  type EconomyFactRow,
} from '../domain/economy-fact.repository';
import type { Product } from '../domain/product';
import { ProductCatalog } from './product-catalog';

/** A published village product, with the product it names. */
export type PublishedVillageProduct = EconomyFactRow<'VILLAGE_PRODUCT'> & { product: Product };

/** The published economy of one village, as other modules see it. */
export interface EconomySections {
  /** By the product's English name. */
  products: PublishedVillageProduct[];
  /** By type, then name. Supporting context only. */
  facilities: EconomyFactRow<'FACILITY'>[];
}

/**
 * Public read facade of the economy module (profile, #39). Only preferred
 * (published) claims, so callers never filter by review state. It does not
 * check the village's publication status: the caller decides who sees which
 * village.
 */
@Injectable()
export class EconomyQueries {
  constructor(
    @Inject(ECONOMY_FACT_REPOSITORY) private readonly facts: EconomyFactRepository,
    private readonly catalog: ProductCatalog,
  ) {}

  /** The published products and facilities of one village: two indexed statements and the cached catalog. */
  async sectionsFor(villageId: string): Promise<EconomySections> {
    const [products, facilities, catalog] = await Promise.all([
      this.facts.preferred('VILLAGE_PRODUCT', villageId),
      this.facts.preferred('FACILITY', villageId),
      this.catalog.byId(),
    ]);
    return {
      // The product foreign key is RESTRICT, so every row's product is in the catalog.
      products: products.flatMap((row) => {
        const product = catalog.get(row.productId);
        return product ? [{ ...row, product }] : [];
      }),
      facilities,
    };
  }
}
