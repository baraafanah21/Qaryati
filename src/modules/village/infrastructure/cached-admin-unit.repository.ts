import { LRUCache } from 'lru-cache';
import type { Clock, Id } from '../../../shared/kernel';
import type { AdminUnit, AdminUnitFilter, AdminUnitRepository } from '../domain/admin-unit';

/** Upper bound on cached entries; the whole reference set is a few hundred units. */
const MAX_ENTRIES = 500;

type CachedValue = AdminUnit | AdminUnit[];

/**
 * In-process cache in front of an {@link AdminUnitRepository}.
 *
 * Administrative units are reference data that change almost never (only by
 * migration today), and every village page and filter reads them, so each
 * API process keeps them for `ttlSeconds`. A changed unit shows up at the
 * latest after one TTL; that delay is accepted. Misses (unknown id or code)
 * are not cached, so a unit added by a migration is found at once.
 *
 * Time comes from the injected `Clock` (lru-cache's `perf` option), so tests
 * move past the TTL without sleeping.
 */
export class CachedAdminUnitRepository implements AdminUnitRepository {
  private readonly cache: LRUCache<string, CachedValue>;

  constructor(
    private readonly inner: AdminUnitRepository,
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

  list(filter: AdminUnitFilter): Promise<AdminUnit[]> {
    const key = `list:${filter.type ?? ''}|${filter.era ?? ''}|${filter.parentId ?? ''}`;
    return this.cached(key, () => this.inner.list(filter)) as Promise<AdminUnit[]>;
  }

  findById(id: Id<'AdminUnit'>): Promise<AdminUnit | undefined> {
    return this.cached(`id:${id}`, () => this.inner.findById(id)) as Promise<AdminUnit | undefined>;
  }

  findByCode(code: string): Promise<AdminUnit | undefined> {
    return this.cached(`code:${code}`, () => this.inner.findByCode(code)) as Promise<
      AdminUnit | undefined
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
