import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError } from '../../../shared/kernel';
import type { ProductCategory } from '../domain/economy-values';
import {
  isUuid,
  PRODUCT_REPOSITORY,
  type Product,
  type ProductRepository,
} from '../domain/product';

/**
 * Reads the product reference data through the in-process cache. Used by the
 * products endpoints and by the use cases that name a product.
 */
@Injectable()
export class ProductCatalog {
  constructor(@Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository) {}

  /** Every product, or one category's, by category then English name. */
  list(category?: ProductCategory): Promise<Product[]> {
    return this.products.list(category);
  }

  /** The product with this id or code; 404 when there is none. */
  async get(idOrCode: string): Promise<Product> {
    const product = isUuid(idOrCode)
      ? await this.products.findById(idOrCode.toLowerCase())
      : await this.products.findByCode(idOrCode);
    if (!product) throw new NotFoundError(`Product ${idOrCode} does not exist.`);
    return product;
  }

  /**
   * Every product by id: one cached list, not one lookup per row. The whole
   * reference set is a few dozen rows, so this is cheaper than a query per page.
   */
  async byId(): Promise<Map<string, Product>> {
    return new Map((await this.products.list()).map((p) => [p.id, p]));
  }
}
