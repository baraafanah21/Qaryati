import nock from 'nock';
import { NominatimAdapter } from './nominatim.adapter';

describe('NominatimAdapter', () => {
  const baseUrl = 'https://nominatim.openstreetmap.org';
  const userAgent = 'QaryatiTests/1.0 (test@example.com)';
  let adapter: NominatimAdapter;

  beforeEach(() => {
    nock.disableNetConnect();
    adapter = new NominatimAdapter(userAgent);
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  function mockSearch(query: string) {
    return nock(baseUrl)
      .get('/search')
      .query({ q: query, format: 'jsonv2', limit: '5' })
      .matchHeader('user-agent', userAgent);
  }

  it('returns coordinates for a successful search', async () => {
    const scope = mockSearch('Nablus').reply(200, [
      {
        display_name: 'Nablus, Palestine',
        lat: '32.2211',
        lon: '35.2544',
      },
    ]);

    const results = await adapter.search('Nablus');

    expect(results).toEqual([
      {
        displayName: 'Nablus, Palestine',
        latitude: 32.2211,
        longitude: 35.2544,
      },
    ]);

    scope.done();
  });

  it('returns an empty array when no results exist', async () => {
    const scope = mockSearch('Unknown Village').reply(200, []);

    const results = await adapter.search('Unknown Village');

    expect(results).toEqual([]);
    scope.done();
  });

  it('rejects malformed JSON responses', async () => {
    const scope = mockSearch('Nablus').reply(200, '{invalid-json');

    await expect(adapter.search('Nablus')).rejects.toThrow(SyntaxError);

    scope.done();
  });

  it('rejects invalid coordinate values', async () => {
    const scope = mockSearch('Nablus').reply(200, [
      {
        display_name: 'Nablus',
        lat: '999',
        lon: '35.2544',
      },
    ]);

    await expect(adapter.search('Nablus')).rejects.toThrow();

    scope.done();
  });
});
