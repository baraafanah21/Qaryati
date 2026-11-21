import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnv } from '../../config/app-env';
import { GEOCODING_PORT, type GeocodingPort } from './application/geocoding.port';
import { NominatimAdapter } from './infrastructure/nominatim.adapter';
import { StubGeocodingAdapter } from './infrastructure/stub-geocoding.adapter';

@Module({
  providers: [
    {
      provide: GEOCODING_PORT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppEnv, true>): GeocodingPort => {
        const provider = config.get('GEO_PROVIDER', { infer: true }) ?? 'stub';

        if (provider === 'nominatim') {
          const userAgent =
            config.get('NOMINATIM_USER_AGENT', {
              infer: true,
            }) ?? '';

          return new NominatimAdapter(userAgent);
        }

        return new StubGeocodingAdapter();
      },
    },
  ],
})
export class GeoModule {}
