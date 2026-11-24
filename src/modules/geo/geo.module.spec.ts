import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { GEOCODING_PORT } from './application/geocoding.port';
import { GeoModule } from './geo.module';
import { NominatimGeocodingAdapter } from './infrastructure/nominatim-geocoding.adapter';
import { StubGeocodingAdapter } from './infrastructure/stub-geocoding.adapter';

describe('GeoModule provider selection', () => {
  async function geocoderFor(env: Record<string, unknown>): Promise<unknown> {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          ignoreEnvVars: true,
          load: [
            () => ({ GEO_NOMINATIM_URL: 'https://nominatim.test', GEO_TIMEOUT_MS: 5000, ...env }),
          ],
        }),
        GeoModule,
      ],
    }).compile();
    const geocoder = module.get<unknown>(GEOCODING_PORT);
    await module.close();
    return geocoder;
  }

  it('uses the stub with GEO_PROVIDER=stub', async () => {
    await expect(geocoderFor({ GEO_PROVIDER: 'stub' })).resolves.toBeInstanceOf(
      StubGeocodingAdapter,
    );
  });

  it('uses Nominatim with GEO_PROVIDER=nominatim', async () => {
    await expect(
      geocoderFor({ GEO_PROVIDER: 'nominatim', GEO_USER_AGENT: 'Qaryati/1.0 (tests)' }),
    ).resolves.toBeInstanceOf(NominatimGeocodingAdapter);
  });
});
