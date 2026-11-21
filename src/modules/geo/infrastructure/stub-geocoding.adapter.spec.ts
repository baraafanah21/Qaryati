import { StubGeocodingAdapter } from './stub-geocoding.adapter';

describe('StubGeocodingAdapter', () => {
  let adapter: StubGeocodingAdapter;

  beforeEach(() => {
    adapter = new StubGeocodingAdapter();
  });

  it('returns matching locations', async () => {
    const results = await adapter.search('Test Village');

    expect(results).toEqual([
      {
        displayName: 'Test Village, Palestine',
        latitude: 31.9,
        longitude: 35.2,
      },
    ]);
  });

  it('returns empty results for unknown locations', async () => {
    const results = await adapter.search('Unknown Location');

    expect(results).toEqual([]);
  });

  it('returns empty results for blank queries', async () => {
    const results = await adapter.search('   ');

    expect(results).toEqual([]);
  });
});
