import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import type { AppEnv } from '../../config/app-env';
import { REDIS } from '../../platform/redis/redis.module';
import { CLOCK, type Clock } from '../../shared/kernel';
import { AcceptGeocodeSuggestion } from './application/accept-geocode-suggestion.use-case';
import { GEOCODING_PORT, type GeocodingPort } from './application/geocoding.port';
import { GEOCODING_SOURCES, type GeocodingSources } from './application/geocoding-sources';
import { SuggestVillageLocations } from './application/suggest-village-locations.use-case';
import { CachedGeocoder } from './infrastructure/cached-geocoder';
import { NominatimGeocodingAdapter } from './infrastructure/nominatim-geocoding.adapter';
import { RateLimitedGeocoder } from './infrastructure/rate-limited-geocoder';
import { ResilientGeocoder } from './infrastructure/resilient-geocoder';
import { StubGeocodingAdapter } from './infrastructure/stub-geocoding.adapter';
import { GeocodeController } from './web/geocode.controller';

/** The bare provider adapter, before any decorator; tests replace it with a failing double. */
export const GEOCODING_ADAPTER = Symbol('GEOCODING_ADAPTER');

/** Retries after the first attempt: three attempts in all, well inside a 30 s request. */
const MAX_RETRIES = 2;

/** Builds the adapter that `GEO_PROVIDER` names. */
export function createGeocoder(config: ConfigService<AppEnv, true>): GeocodingPort {
  if (config.get('GEO_PROVIDER', { infer: true }) === 'nominatim') {
    return new NominatimGeocodingAdapter({
      baseUrl: config.get('GEO_NOMINATIM_URL', { infer: true }),
      userAgent: config.get('GEO_USER_AGENT', { infer: true }) ?? '',
      timeoutMs: config.get('GEO_TIMEOUT_MS', { infer: true }),
    });
  }
  return new StubGeocodingAdapter();
}

/**
 * The port the use cases see: `Cached( Resilient( RateLimited( adapter ) ) )`.
 * The rate limiter is Nominatim's usage policy, so the stub skips it (k6 and
 * the e2e tests are not throttled to one request per second); retry, breaker
 * and cache wrap every provider.
 */
export function decorateGeocoder(
  adapter: GeocodingPort,
  config: ConfigService<AppEnv, true>,
  redis: Redis,
  clock: Clock,
): GeocodingPort {
  const provider = config.get('GEO_PROVIDER', { infer: true });
  const limited =
    provider === 'nominatim'
      ? new RateLimitedGeocoder(
          adapter,
          {
            minIntervalMs: config.get('GEO_MIN_INTERVAL_MS', { infer: true }),
            queueTimeoutMs: config.get('GEO_QUEUE_TIMEOUT_MS', { infer: true }),
          },
          clock,
        )
      : adapter;
  const resilient = new ResilientGeocoder(limited, {
    timeoutMs: config.get('GEO_TIMEOUT_MS', { infer: true }),
    maxRetries: MAX_RETRIES,
    retryBaseMs: config.get('GEO_RETRY_BASE_MS', { infer: true }),
    breakerThreshold: config.get('GEO_BREAKER_THRESHOLD', { infer: true }),
    halfOpenAfterMs: config.get('GEO_BREAKER_HALF_OPEN_MS', { infer: true }),
  });
  return new CachedGeocoder(resilient, redis, provider, {
    resultsSeconds: config.get('GEO_CACHE_TTL_SECONDS', { infer: true }),
    emptySeconds: config.get('GEO_CACHE_EMPTY_TTL_SECONDS', { infer: true }),
  });
}

/** Placeholder URL of the stub's source: `.invalid` never resolves (RFC 2606). */
const STUB_SOURCE_URL = 'https://geocoding-stub.qaryati.invalid/';

/** The `EXTERNAL_API` source each provider's accepted candidates cite. */
export function geocodingSources(config: ConfigService<AppEnv, true>): GeocodingSources {
  return {
    nominatim: {
      title: 'OpenStreetMap Nominatim',
      url: config.get('GEO_NOMINATIM_URL', { infer: true }),
    },
    stub: { title: 'Qaryati geocoding stub (test fixtures)', url: STUB_SOURCE_URL },
  };
}

/**
 * Nest module of geo: the geocoding port with its decorators, the suggestion
 * and accept endpoints. Imported only by AppModule, the composition root.
 */
@Module({
  controllers: [GeocodeController],
  providers: [
    { provide: GEOCODING_ADAPTER, inject: [ConfigService], useFactory: createGeocoder },
    {
      provide: GEOCODING_PORT,
      inject: [GEOCODING_ADAPTER, ConfigService, REDIS, CLOCK],
      useFactory: decorateGeocoder,
    },
    { provide: GEOCODING_SOURCES, inject: [ConfigService], useFactory: geocodingSources },
    SuggestVillageLocations,
    AcceptGeocodeSuggestion,
  ],
})
export class GeoModule {}
