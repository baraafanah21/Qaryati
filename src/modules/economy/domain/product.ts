import type { ProductCategory } from './economy-values';

/** A product (reference data): seeded by migration, not a claim. */
export interface Product {
  id: string;
  /** Stable kebab-case English key, e.g. `olive-oil`. */
  code: string;
  category: ProductCategory;
  nameAr: string;
  nameEn: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Read port of the `product` table. */
export interface ProductRepository {
  /** Every product, or those of one category, by category then English name. */
  list(category?: ProductCategory): Promise<Product[]>;
  findById(id: string): Promise<Product | undefined>;
  findByCode(code: string): Promise<Product | undefined>;
}

/** Injection token of the {@link ProductRepository}. */
export const PRODUCT_REPOSITORY = Symbol('PRODUCT_REPOSITORY');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/** Whether a `{idOrCode}` path value is an id (a UUID) rather than a code. */
export const isUuid = (value: string): boolean => UUID.test(value);
