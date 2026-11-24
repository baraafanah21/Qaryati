import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import nock from 'nock';
import { GeocodingBadResponseError, GeocodingUnavailableError } from '../domain/geocoding-errors';
import { NominatimGeocodingAdapter } from './nominatim-geocoding.adapter';
import { ResilientGeocoder, type ResiliencePolicy } from './resilient-geocoder';

// Real time with tiny delays instead of fake timers: fetch, nock and cockatiel all
// schedule their own timers, and faking them makes these tests hang, not faster.
const BASE_URL = 'https://nominatim.test';
const USER_AGENT = 'Qaryati/1.0 (university project)';
const POLICY: ResiliencePolicy = {
  timeoutMs: 100,
  maxRetries: 2,
  retryBaseMs: 1,
  breakerThreshold: 5,
  halfOpenAfterMs: 50,
};
const LIFTA = [{ display_name: 'Lifta', lat: '31.79', lon: '35.19' }];

const adapterFor = (baseUrl: string) =>
  new NominatimGeocodingAdapter({ baseUrl, userAgent: USER_AGENT, timeoutMs: 5000 });
const resilient = (policy: Partial<ResiliencePolicy> = {}) =>
  new ResilientGeocoder(adapterFor(BASE_URL), { ...POLICY, ...policy });
const search = () => nock(BASE_URL).get('/search').query(true);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('ResilientGeocoder', () => {
  beforeAll(() => nock.disableNetConnect());
  afterEach(() => nock.cleanAll());
  afterAll(() => nock.enableNetConnect());

  it('retries a 503 once and returns the next answer', async () => {
    const scope = search().reply(503).get('/search').query(true).reply(200, LIFTA);

    await expect(resilient().search({ name: 'Lifta' })).resolves.toHaveLength(1);
    scope.done();
  });

  it.each([
    ['429 (retrying a rate limit makes it worse)', 429, 'rate-limited'],
    ['400', 400, 'http'],
    ['500 (a server bug, not a blip)', 500, 'http'],
  ])('does not retry a %s', async (_case, status, failure) => {
    const scope = search().reply(status);
    // A retry would find no interceptor and end with a network error, not this status.
    await expect(resilient().search({ name: 'Lifta' })).rejects.toMatchObject({
      failure,
      httpStatus: status,
      transient: false,
    });
    scope.done();
  });

  it('does not retry a bad response', async () => {
    const scope = search().reply(200, { not: 'a list' });
    await expect(resilient().search({ name: 'Lifta' })).rejects.toBeInstanceOf(
      GeocodingBadResponseError,
    );
    scope.done();
  });

  it('retries a timeout twice, then fails as unavailable', async () => {
    // A real server that never answers: nock's delayed sockets trip undici on abort.
    let requests = 0;
    const hanging = createServer(() => {
      requests += 1;
    });
    await new Promise<void>((done) => hanging.listen(0, '127.0.0.1', done));
    nock.enableNetConnect('127.0.0.1');
    const { port } = hanging.address() as AddressInfo;
    const geocoder = new ResilientGeocoder(adapterFor(`http://127.0.0.1:${port}`), POLICY);
    try {
      await expect(geocoder.search({ name: 'Lifta' })).rejects.toMatchObject({
        failure: 'timeout',
      });
      expect(requests).toBe(3);
    } finally {
      nock.disableNetConnect();
      hanging.closeAllConnections();
      await new Promise((done) => hanging.close(done));
    }
  });

  it('opens after 5 failed calls and then fails without calling the provider', async () => {
    const geocoder = resilient();
    const scope = search().times(5).reply(500);
    for (let call = 0; call < 5; call += 1) {
      await expect(geocoder.search({ name: 'Lifta' })).rejects.toMatchObject({ failure: 'http' });
    }
    scope.done();

    // No interceptor left: reaching the provider would be a network error, not this.
    const error = await geocoder.search({ name: 'Lifta' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GeocodingUnavailableError);
    expect(error).toMatchObject({ failure: 'circuit-open', transient: false });
    expect((error as Error).message).toContain('temporarily disabled');
  });

  it('lets one trial call through after the half-open delay and closes on success', async () => {
    const geocoder = resilient({ breakerThreshold: 1 });
    const failing = search().reply(500);
    await expect(geocoder.search({ name: 'Lifta' })).rejects.toMatchObject({ failure: 'http' });
    failing.done();
    await expect(geocoder.search({ name: 'Lifta' })).rejects.toMatchObject({
      failure: 'circuit-open',
    });

    await sleep(POLICY.halfOpenAfterMs + 20);
    const recovered = search().twice().reply(200, LIFTA);
    await expect(geocoder.search({ name: 'Lifta' })).resolves.toHaveLength(1);
    // Closed again: the next call reaches the provider too.
    await expect(geocoder.search({ name: 'Lifta' })).resolves.toHaveLength(1);
    recovered.done();
  });

  it('fails at once while isolated by hand', async () => {
    const geocoder = resilient();
    const handle = geocoder.isolate();
    await expect(geocoder.search({ name: 'Lifta' })).rejects.toMatchObject({
      failure: 'circuit-open',
    });
    handle.dispose();
  });
});
