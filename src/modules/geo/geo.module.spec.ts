import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import type { AppEnv } from '../../config/app-env';
import { FixedClock } from '../../shared/kernel';
import { createGeocoder, decorateGeocoder, geocodingSources } from './geo.module';
import { CachedGeocoder } from './infrastructure/cached-geocoder';
import { NominatimGeocodingAdapter } from './infrastructure/nominatim-geocoding.adapter';
import { StubGeocodingAdapter } from './infrastructure/stub-geocoding.adapter';

const config = (env: Record<string, unknown>) =>
  new ConfigService<AppEnv, true>({
    GEO_NOMINATIM_URL: 'https://nominatim.test',
    GEO_TIMEOUT_MS: 5000,
    GEO_RETRY_BASE_MS: 200,
    GEO_BREAKER_THRESHOLD: 5,
    GEO_BREAKER_HALF_OPEN_MS: 30000,
    GEO_MIN_INTERVAL_MS: 1000,
    GEO_QUEUE_TIMEOUT_MS: 5000,
    GEO_CACHE_TTL_SECONDS: 2592000,
    GEO_CACHE_EMPTY_TTL_SECONDS: 86400,
    ...env,
  });

describe('geo module wiring', () => {
  it('builds the stub with GEO_PROVIDER=stub', () => {
    expect(createGeocoder(config({ GEO_PROVIDER: 'stub' }))).toBeInstanceOf(StubGeocodingAdapter);
  });

  it('builds Nominatim with GEO_PROVIDER=nominatim', () => {
    expect(
      createGeocoder(config({ GEO_PROVIDER: 'nominatim', GEO_USER_AGENT: 'Qaryati/1.0 (tests)' })),
    ).toBeInstanceOf(NominatimGeocodingAdapter);
  });

  it('puts the cache outermost, whatever the provider', () => {
    const env = config({ GEO_PROVIDER: 'stub' });
    const port = decorateGeocoder(
      createGeocoder(env),
      env,
      {} as Redis,
      new FixedClock('2026-11-25T00:00:00Z'),
    );
    expect(port).toBeInstanceOf(CachedGeocoder);
  });

  it('cites Nominatim by its configured URL', () => {
    expect(geocodingSources(config({})).nominatim).toEqual({
      title: 'OpenStreetMap Nominatim',
      url: 'https://nominatim.test',
    });
  });
});
