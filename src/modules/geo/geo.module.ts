import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnv } from '../../config/app-env';
import { GEOCODING_PORT, type GeocodingPort } from './application/geocoding.port';
import { NominatimGeocodingAdapter } from './infrastructure/nominatim-geocoding.adapter';
import { StubGeocodingAdapter } from './infrastructure/stub-geocoding.adapter';

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
 * Nest module of geo. It wires the geocoding port to the adapter chosen by
 * `GEO_PROVIDER` and is imported only by AppModule, the composition root.
 */
@Module({
  providers: [{ provide: GEOCODING_PORT, inject: [ConfigService], useFactory: createGeocoder }],
})
export class GeoModule {}
