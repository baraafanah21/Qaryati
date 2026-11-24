import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type Redis from 'ioredis';
import { z } from 'zod';
import { normalizeName } from '../../village';
import {
  GEOCODING_PROVIDERS,
  effectiveLimit,
  type GeocodeCandidate,
  type GeocodeOptions,
  type GeocodeQuery,
  type GeocodingPort,
  type GeocodingProvider,
} from '../application/geocoding.port';

/** TTLs from `GEO_CACHE_TTL_SECONDS` and `GEO_CACHE_EMPTY_TTL_SECONDS`. */
export interface CacheTtls {
  resultsSeconds: number;
  emptySeconds: number;
}

/** Bump when the stored shape changes, so old entries are never read. */
export const GEO_CACHE_PREFIX = 'geo:v1:';

const cachedCandidates = z.array(
  z.strictObject({
    displayName: z.string(),
    latitude: z.number(),
    longitude: z.number(),
    provider: z.enum(GEOCODING_PROVIDERS),
    providerRef: z.string().nullable(),
  }),
);

/**
 * Cache key of a query: the same question in different spelling (`Beit Furik`,
 * ` beit  furik `) shares one key. Hashed, so names never appear in Redis keys.
 */
export function geocodeCacheKey(provider: GeocodingProvider, query: GeocodeQuery): string {
  const canonical = JSON.stringify({
    provider,
    name: normalizeName(query.name),
    nameAlt: normalizeName(query.nameAlt ?? ''),
    limit: effectiveLimit(query.limit),
  });
  return GEO_CACHE_PREFIX + createHash('sha256').update(canonical).digest('hex');
}

/**
 * Cache-aside in front of the geocoder, on the shared Redis client.
 *
 * Results live 30 days and empty results 24 hours by default: a place does not
 * move, while an empty answer may change when OpenStreetMap is edited.
 * Provider errors are never cached. Redis is optional: a failed read falls
 * through to the provider and a failed write is logged and ignored, so a Redis
 * outage costs speed and rate limit, never a request.
 */
export class CachedGeocoder implements GeocodingPort {
  private readonly logger = new Logger(CachedGeocoder.name);

  constructor(
    private readonly inner: GeocodingPort,
    private readonly redis: Redis,
    private readonly provider: GeocodingProvider,
    private readonly ttls: CacheTtls,
  ) {}

  async search(query: GeocodeQuery, options?: GeocodeOptions): Promise<GeocodeCandidate[]> {
    const key = geocodeCacheKey(this.provider, query);
    const cached = await this.read(key);
    if (cached) return cached;

    const results = await this.inner.search(query, options);
    await this.write(key, results);
    return results;
  }

  private async read(key: string): Promise<GeocodeCandidate[] | undefined> {
    let raw: string | null;
    try {
      raw = await this.redis.get(key);
    } catch (error) {
      this.logger.warn({ err: errorMessage(error) }, 'Geocoding cache read failed');
      return undefined;
    }
    if (raw === null) return undefined;
    try {
      const parsed = cachedCandidates.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }

  private async write(key: string, results: GeocodeCandidate[]): Promise<void> {
    const ttl = results.length > 0 ? this.ttls.resultsSeconds : this.ttls.emptySeconds;
    try {
      await this.redis.set(key, JSON.stringify(results), 'EX', ttl);
    } catch (error) {
      this.logger.warn({ err: errorMessage(error) }, 'Geocoding cache write failed');
    }
  }
}

function errorMessage(error: unknown): { message: string } {
  return { message: error instanceof Error ? error.message : String(error) };
}
