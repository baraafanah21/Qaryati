import { SystemClock } from '../../../shared/kernel';
import type { GeocodeCandidate, GeocodingPort } from '../application/geocoding.port';
import { GeocodingUnavailableError } from '../domain/geocoding-errors';
import { RateLimitedGeocoder } from './rate-limited-geocoder';

/** Records when each call starts; answers after `durationMs`. */
class RecordingGeocoder implements GeocodingPort {
  readonly starts: number[] = [];
  constructor(private readonly durationMs = 0) {}

  async search(): Promise<GeocodeCandidate[]> {
    this.starts.push(Date.now());
    if (this.durationMs > 0) await new Promise((r) => setTimeout(r, this.durationMs));
    return [];
  }
}

describe('RateLimitedGeocoder', () => {
  const T0 = new Date('2026-11-25T10:00:00Z').getTime();
  // Fake timers also fake Date, so SystemClock follows the fake time.
  const clock = new SystemClock();

  beforeEach(() => {
    jest.useFakeTimers({ now: T0 });
  });
  afterEach(() => jest.useRealTimers());

  it('starts three simultaneous calls at 0, 1000 and 2000 ms', async () => {
    const inner = new RecordingGeocoder();
    const limiter = new RateLimitedGeocoder(
      inner,
      { minIntervalMs: 1000, queueTimeoutMs: 5000 },
      clock,
    );

    const calls = [1, 2, 3].map(() => limiter.search({ name: 'Lifta' }));
    await jest.advanceTimersByTimeAsync(2000);
    await Promise.all(calls);

    expect(inner.starts.map((t) => t - T0)).toEqual([0, 1000, 2000]);
  });

  it('runs one call at a time: a slow call delays the next one', async () => {
    const inner = new RecordingGeocoder(1500);
    const limiter = new RateLimitedGeocoder(
      inner,
      { minIntervalMs: 1000, queueTimeoutMs: 5000 },
      clock,
    );

    const calls = [limiter.search({ name: 'a' }), limiter.search({ name: 'b' })];
    await jest.advanceTimersByTimeAsync(3000);
    await Promise.all(calls);

    expect(inner.starts.map((t) => t - T0)).toEqual([0, 1500]);
  });

  it('fails a call that would wait longer than the queue timeout, without calling the provider', async () => {
    const inner = new RecordingGeocoder();
    const limiter = new RateLimitedGeocoder(
      inner,
      { minIntervalMs: 1000, queueTimeoutMs: 1500 },
      clock,
    );

    const first = limiter.search({ name: 'a' });
    const second = limiter.search({ name: 'b' });
    const third = limiter.search({ name: 'c' }).catch((e: unknown) => e);
    await jest.advanceTimersByTimeAsync(2000);
    await Promise.all([first, second]);

    const error = await third;
    expect(error).toBeInstanceOf(GeocodingUnavailableError);
    expect(error).toMatchObject({ failure: 'queue-timeout', transient: false });
    expect(inner.starts).toHaveLength(2);
  });

  it('keeps the order when a waiting caller gives up', async () => {
    const inner = new RecordingGeocoder(3000);
    const limiter = new RateLimitedGeocoder(
      inner,
      { minIntervalMs: 0, queueTimeoutMs: 1000 },
      clock,
    );

    const slow = limiter.search({ name: 'slow' });
    const gaveUp = limiter.search({ name: 'gives up' }).catch((e: unknown) => e);
    await jest.advanceTimersByTimeAsync(1000);
    await expect(gaveUp).resolves.toBeInstanceOf(GeocodingUnavailableError);

    // Arrives while the slow call still runs; must not start before it ends at 3000 ms.
    const next = limiter.search({ name: 'next' }).catch((e: unknown) => e);
    await jest.advanceTimersByTimeAsync(3000);
    await Promise.all([slow, next]);
    expect(inner.starts.map((t) => t - T0)).toEqual([0]);
  });
});
