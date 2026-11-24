import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import nock from 'nock';
import { GeocodingBadResponseError, GeocodingUnavailableError } from '../domain/geocoding-errors';
import { NominatimGeocodingAdapter } from './nominatim-geocoding.adapter';

const BASE_URL = 'https://nominatim.test';
const USER_AGENT = 'Qaryati/1.0 (university project)';

/** The query string the adapter must send for `q`. */
const searchQuery = (q: string, limit = '5') => ({
  q,
  format: 'jsonv2',
  limit,
  countrycodes: 'ps,il',
  'accept-language': 'ar,en',
});

const mockSearch = (q: string, limit?: string) =>
  nock(BASE_URL).get('/search').query(searchQuery(q, limit)).matchHeader('user-agent', USER_AGENT);

describe('NominatimGeocodingAdapter', () => {
  const adapter = new NominatimGeocodingAdapter({
    baseUrl: BASE_URL,
    userAgent: USER_AGENT,
    timeoutMs: 200,
  });

  beforeAll(() => nock.disableNetConnect());
  afterEach(() => nock.cleanAll());
  afterAll(() => nock.enableNetConnect());

  it('maps results to candidates, with numbers and the OSM reference', async () => {
    const scope = mockSearch('لفتا').reply(200, [
      {
        display_name: 'لفتا، القدس',
        lat: '31.7958300',
        lon: '35.1986100',
        osm_type: 'node',
        osm_id: 123,
        importance: 0.4,
      },
    ]);

    await expect(adapter.search({ name: 'لفتا' })).resolves.toEqual([
      {
        displayName: 'لفتا، القدس',
        latitude: 31.79583,
        longitude: 35.19861,
        provider: 'nominatim',
        providerRef: 'node/123',
      },
    ]);
    scope.done();
  });

  it('returns an empty list when nothing is found', async () => {
    const scope = mockSearch('Nowhere').reply(200, []);
    await expect(adapter.search({ name: 'Nowhere' })).resolves.toEqual([]);
    scope.done();
  });

  it('tries nameAlt only when name finds nothing', async () => {
    const scope = mockSearch('لفتا', '3')
      .reply(200, [])
      .get('/search')
      .query(searchQuery('Lifta', '3'))
      .reply(200, [{ display_name: 'Lifta', lat: '31.79', lon: '35.19' }]);

    const results = await adapter.search({ name: 'لفتا', nameAlt: 'Lifta', limit: 3 });

    expect(results).toEqual([expect.objectContaining({ displayName: 'Lifta', providerRef: null })]);
    scope.done();
  });

  it('rejects malformed JSON as a bad response', async () => {
    const scope = mockSearch('Lifta').reply(200, '{not json');
    await expect(adapter.search({ name: 'Lifta' })).rejects.toBeInstanceOf(
      GeocodingBadResponseError,
    );
    scope.done();
  });

  it.each([
    ['an object instead of a list', { error: 'nope' }],
    ['a missing field', [{ display_name: 'Lifta', lat: '31.79' }]],
    ['a latitude out of range', [{ display_name: 'Lifta', lat: '999', lon: '35.19' }]],
    ['a coordinate that is not a number', [{ display_name: 'Lifta', lat: '1e3', lon: '35.19' }]],
  ])('rejects %s as a bad response', async (_case, body) => {
    const scope = mockSearch('Lifta').reply(200, body);
    await expect(adapter.search({ name: 'Lifta' })).rejects.toBeInstanceOf(
      GeocodingBadResponseError,
    );
    scope.done();
  });

  it('turns a 503 into a transient unavailable error without the provider body', async () => {
    const scope = mockSearch('Lifta').reply(503, '<html>secret upstream page</html>');

    const error = await adapter.search({ name: 'Lifta' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(GeocodingUnavailableError);
    expect(error).toMatchObject({ failure: 'http', transient: true, httpStatus: 503 });
    expect((error as Error).message).not.toContain('secret');
    scope.done();
  });

  it.each([
    [429, 'rate-limited'],
    [500, 'http'],
    [400, 'http'],
  ])('turns a %i into a non-transient unavailable error', async (status, failure) => {
    const scope = mockSearch('Lifta').reply(status);
    await expect(adapter.search({ name: 'Lifta' })).rejects.toMatchObject({
      failure,
      transient: false,
      httpStatus: status,
    });
    scope.done();
  });

  it('times out a slow provider as a transient unavailable error', async () => {
    // A real local server that never answers: nock's delayed mock sockets trip an
    // internal assertion of undici when fetch aborts them.
    const hanging = createServer(() => undefined);
    await new Promise<void>((done) => hanging.listen(0, '127.0.0.1', done));
    nock.enableNetConnect('127.0.0.1');
    const { port } = hanging.address() as AddressInfo;
    const slow = new NominatimGeocodingAdapter({
      baseUrl: `http://127.0.0.1:${port}`,
      userAgent: USER_AGENT,
      timeoutMs: 100,
    });
    try {
      await expect(slow.search({ name: 'Lifta' })).rejects.toMatchObject({
        failure: 'timeout',
        transient: true,
      });
    } finally {
      nock.disableNetConnect();
      hanging.closeAllConnections();
      await new Promise((done) => hanging.close(done));
    }
  });

  it('turns a network failure into a transient unavailable error', async () => {
    const scope = mockSearch('Lifta').replyWithError('connection reset');
    await expect(adapter.search({ name: 'Lifta' })).rejects.toMatchObject({
      failure: 'network',
      transient: true,
    });
    scope.done();
  });

  it('refuses to start without a User-Agent', () => {
    expect(
      () => new NominatimGeocodingAdapter({ baseUrl: BASE_URL, userAgent: ' ', timeoutMs: 1 }),
    ).toThrow('GEO_USER_AGENT');
  });
});
