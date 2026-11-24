import Redis from 'ioredis';
import nock from 'nock';
import {
  CachedGeocoder,
  geocodeCacheKey,
} from '../../src/modules/geo/infrastructure/cached-geocoder';
import { NominatimGeocodingAdapter } from '../../src/modules/geo/infrastructure/nominatim-geocoding.adapter';
import { GeocodingUnavailableError } from '../../src/modules/geo/domain/geocoding-errors';
import { startTestRedis, type TestRedis } from '../support/test-redis';

const BASE_URL = 'https://nominatim.test';
const TTLS = { resultsSeconds: 2_592_000, emptySeconds: 86_400 };
const BEIT_FURIK = [{ display_name: 'Beit Furik', lat: '32.17', lon: '35.33556' }];

/** Same options as the shared client in src/platform/redis/redis.module.ts. */
const connect = (url: string) =>
  new Redis(url, { enableOfflineQueue: false, maxRetriesPerRequest: 1, lazyConnect: true });

describe('CachedGeocoder against Redis', () => {
  let redisServer: TestRedis;
  let redis: Redis;
  let geocoder: CachedGeocoder;

  beforeAll(async () => {
    redisServer = await startTestRedis();
    // nock 15 intercepts sockets too; let Redis through, nothing else.
    const redisHost = new URL(redisServer.url).hostname;
    nock.disableNetConnect();
    nock.enableNetConnect(redisHost);
  }, 120_000);

  beforeEach(async () => {
    redis = connect(redisServer.url);
    redis.on('error', () => undefined);
    await redis.connect();
    await redis.flushall();
    const adapter = new NominatimGeocodingAdapter({
      baseUrl: BASE_URL,
      userAgent: 'Qaryati/1.0 (tests)',
      timeoutMs: 2000,
    });
    geocoder = new CachedGeocoder(adapter, redis, 'nominatim', TTLS);
  });

  afterEach(() => {
    nock.cleanAll();
    redis.disconnect();
  });

  afterAll(async () => {
    nock.enableNetConnect();
    await redisServer?.stop();
  });

  const provider = () => nock(BASE_URL).get('/search').query(true);

  it('serves the second identical call from Redis', async () => {
    const scope = provider().once().reply(200, BEIT_FURIK);

    const first = await geocoder.search({ name: 'Beit Furik' });
    const second = await geocoder.search({ name: 'Beit Furik' });

    expect(second).toEqual(first);
    scope.done(); // one provider call; a second would find no interceptor
  });

  it('shares one key between spellings of the same name', async () => {
    expect(geocodeCacheKey('nominatim', { name: ' beit  furik ' })).toBe(
      geocodeCacheKey('nominatim', { name: 'Beit Furik' }),
    );
    const scope = provider().once().reply(200, BEIT_FURIK);
    await geocoder.search({ name: 'Beit Furik' });
    await expect(geocoder.search({ name: ' beit  furik ' })).resolves.toHaveLength(1);
    scope.done();
  });

  it('caches a result for 30 days and an empty result for 24 hours', async () => {
    provider().reply(200, BEIT_FURIK);
    provider().reply(200, []);

    await geocoder.search({ name: 'Beit Furik' });
    await geocoder.search({ name: 'Nowhere' });

    const full = await redis.ttl(geocodeCacheKey('nominatim', { name: 'Beit Furik' }));
    const empty = await redis.ttl(geocodeCacheKey('nominatim', { name: 'Nowhere' }));
    expect(full).toBeGreaterThan(TTLS.emptySeconds);
    expect(full).toBeLessThanOrEqual(TTLS.resultsSeconds);
    expect(empty).toBeGreaterThan(TTLS.emptySeconds - 60);
    expect(empty).toBeLessThanOrEqual(TTLS.emptySeconds);
  });

  it('does not cache a provider error', async () => {
    provider().reply(500);
    await expect(geocoder.search({ name: 'Beit Furik' })).rejects.toBeInstanceOf(
      GeocodingUnavailableError,
    );
    expect(await redis.exists(geocodeCacheKey('nominatim', { name: 'Beit Furik' }))).toBe(0);

    const scope = provider().reply(200, BEIT_FURIK);
    await expect(geocoder.search({ name: 'Beit Furik' })).resolves.toHaveLength(1);
    scope.done();
  });

  it('keys by name, nameAlt, limit and provider', () => {
    const base = geocodeCacheKey('nominatim', { name: 'لفتا' });
    expect(base).toMatch(/^geo:v1:[0-9a-f]{64}$/);
    expect(geocodeCacheKey('nominatim', { name: 'لفتا', nameAlt: 'Lifta' })).not.toBe(base);
    expect(geocodeCacheKey('nominatim', { name: 'لفتا', limit: 3 })).not.toBe(base);
    expect(geocodeCacheKey('stub', { name: 'لفتا' })).not.toBe(base);
  });

  it('still answers from the provider when Redis is gone', async () => {
    redis.disconnect();
    const scope = provider().twice().reply(200, BEIT_FURIK);

    await expect(geocoder.search({ name: 'Beit Furik' })).resolves.toHaveLength(1);
    await expect(geocoder.search({ name: 'Beit Furik' })).resolves.toHaveLength(1);
    scope.done(); // nothing cached: both calls reached the provider
  });
});
