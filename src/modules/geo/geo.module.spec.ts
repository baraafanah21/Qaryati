import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { GEOCODING_PORT } from './application/geocoding.port';
import { GeoModule } from './geo.module';
import { NominatimAdapter } from './infrastructure/nominatim.adapter';
import { StubGeocodingAdapter } from './infrastructure/stub-geocoding.adapter';

describe('GeoModule provider selection', () => {
  const originalProvider = process.env.GEO_PROVIDER;
  const originalUserAgent = process.env.NOMINATIM_USER_AGENT;

  afterEach(() => {
    if (originalProvider === undefined) {
      delete process.env.GEO_PROVIDER;
    } else {
      process.env.GEO_PROVIDER = originalProvider;
    }

    if (originalUserAgent === undefined) {
      delete process.env.NOMINATIM_USER_AGENT;
    } else {
      process.env.NOMINATIM_USER_AGENT = originalUserAgent;
    }
  });

  async function createModule() {
    return Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
        }),
        GeoModule,
      ],
    }).compile();
  }

  it('uses Stub when GEO_PROVIDER=stub', async () => {
    process.env.GEO_PROVIDER = 'stub';

    const module = await createModule();

    expect(module.get(GEOCODING_PORT)).toBeInstanceOf(StubGeocodingAdapter);

    await module.close();
  });

  it('uses Nominatim when GEO_PROVIDER=nominatim', async () => {
    process.env.GEO_PROVIDER = 'nominatim';
    process.env.NOMINATIM_USER_AGENT = 'QaryatiTests/1.0 (test@example.com)';

    const module = await createModule();

    expect(module.get(GEOCODING_PORT)).toBeInstanceOf(NominatimAdapter);

    await module.close();
  });

  it('rejects Nominatim without User-Agent', async () => {
    process.env.GEO_PROVIDER = 'nominatim';
    delete process.env.NOMINATIM_USER_AGENT;

    await expect(createModule()).rejects.toThrow('Nominatim User-Agent is required');
  });
});
