import { LRUCache } from 'lru-cache';
import type { Clock } from '../../../shared/kernel';
import type { ProductCategory } from '../domain/economy-values';
import type { Product, ProductRepository } from '../domain/product';

/** Upper bound on cached entries; the whole reference set is a few dozen products. */
const MAX_ENTRIES = 200;

type CachedValue = Product | Product[];

/**
 * In-process cache in front of a {@link ProductRepository}, like the
 * administrative units cache of the village module.
 *
 * Products are reference data that change only by migration, and every
 * village product list and product filter reads them, so each API process
 * keeps them for `ttlSeconds`. Misses (unknown id or code) are not cached, so
 * a product added by a migration is found at once. Time comes from the
 * injected `Clock`, so tests move past the TTL without sleeping.
 */
export class CachedProductRepository implements ProductRepository {
  private readonly cache: LRUCache<string, CachedValue>;

  constructor(
    private readonly inner: ProductRepository,
    ttlSeconds: number,
    clock: Clock,
  ) {
    this.cache = new LRUCache<string, CachedValue>({
      max: MAX_ENTRIES,
      ttl: ttlSeconds * 1000,
      // 0: read the clock on every check instead of caching "now" for a timer tick.
      ttlResolution: 0,
      perf: { now: () => clock.now().getTime() },
    });
  }

  list(category?: ProductCategory): Promise<Product[]> {
    return this.cached(`list:${category ?? ''}`, () => this.inner.list(category)) as Promise<
      Product[]
    >;
  }

  findById(id: string): Promise<Product | undefined> {
    return this.cached(`id:${id}`, () => this.inner.findById(id)) as Promise<Product | undefined>;
  }

  findByCode(code: string): Promise<Product | undefined> {
    return this.cached(`code:${code}`, () => this.inner.findByCode(code)) as Promise<
      Product | undefined
    >;
  }

  private async cached(
    key: string,
    load: () => Promise<CachedValue | undefined>,
  ): Promise<CachedValue | undefined> {
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const value = await load();
    if (value !== undefined) this.cache.set(key, value);
    return value;
  }
}
