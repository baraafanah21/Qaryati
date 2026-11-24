import { StubGeocodingAdapter } from './stub-geocoding.adapter';

describe('StubGeocodingAdapter', () => {
  const adapter = new StubGeocodingAdapter();

  it('finds a fixture by its Arabic name, ignoring letter variants', async () => {
    const results = await adapter.search({ name: 'سبسطيّة' });
    expect(results).toEqual([
      {
        displayName: 'Sebastia, Nablus',
        latitude: 32.27639,
        longitude: 35.19722,
        provider: 'stub',
        providerRef: 'stub/4',
      },
    ]);
  });

  it('falls back to nameAlt when name finds nothing', async () => {
    const results = await adapter.search({ name: 'غير معروف', nameAlt: 'Battir' });
    expect(results.map((r) => r.displayName)).toEqual(['Battir, Bethlehem']);
  });

  it('returns nothing for unknown and blank names', async () => {
    await expect(adapter.search({ name: 'Unknown' })).resolves.toEqual([]);
    await expect(adapter.search({ name: '   ' })).resolves.toEqual([]);
  });

  it('returns copies, so callers cannot change the fixtures', async () => {
    const [first] = await adapter.search({ name: 'Lifta' });
    first!.latitude = 0;
    const [again] = await adapter.search({ name: 'Lifta' });
    expect(again!.latitude).toBe(31.79583);
  });
});
