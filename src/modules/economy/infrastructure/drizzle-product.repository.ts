import { Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { InjectModuleDb } from '../../../platform/database/database';
import { isProductCategory, type ProductCategory } from '../domain/economy-values';
import type { Product, ProductRepository } from '../domain/product';
import type { EconomyDb } from './persistence/economy-db';
import { product } from './persistence/schema';

type ProductRow = typeof product.$inferSelect;

function toDomain(row: ProductRow): Product {
  // Plain text column without CHECK: an unknown value is a bad edit, not data to serve.
  if (!isProductCategory(row.category)) {
    throw new Error(`Product ${row.id} has an unknown category "${row.category}".`);
  }
  return { ...row, category: row.category };
}

/** Reads products from PostgreSQL (wrapped by the in-process cache in the app). */
@Injectable()
export class DrizzleProductRepository implements ProductRepository {
  constructor(@InjectModuleDb() private readonly db: EconomyDb) {}

  async list(category?: ProductCategory): Promise<Product[]> {
    const rows = await this.db
      .select()
      .from(product)
      .where(category ? eq(product.category, category) : undefined)
      .orderBy(asc(product.category), asc(product.nameEn), asc(product.id));
    return rows.map(toDomain);
  }

  async findById(id: string): Promise<Product | undefined> {
    const [row] = await this.db.select().from(product).where(eq(product.id, id)).limit(1);
    return row && toDomain(row);
  }

  async findByCode(code: string): Promise<Product | undefined> {
    const [row] = await this.db.select().from(product).where(eq(product.code, code)).limit(1);
    return row && toDomain(row);
  }
}
