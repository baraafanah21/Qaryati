import type { Clock } from '../../../shared/kernel';
import type {
  GeocodeCandidate,
  GeocodeOptions,
  GeocodeQuery,
  GeocodingPort,
} from '../application/geocoding.port';
import { GeocodingUnavailableError } from '../domain/geocoding-errors';

/** Limits from `GEO_MIN_INTERVAL_MS` and `GEO_QUEUE_TIMEOUT_MS`. */
export interface RateLimit {
  /** Least time between the starts of two provider calls. */
  minIntervalMs: number;
  /** Longest a caller waits for its turn before it gets a 502. */
  queueTimeoutMs: number;
}

const sleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One provider call at a time, at least `minIntervalMs` apart (Nominatim
 * allows one request per second). Callers queue in arrival order; one that
 * would wait longer than `queueTimeoutMs` fails at once with a non-transient
 * {@link GeocodingUnavailableError}, so the retry layer does not requeue it.
 *
 * In process: right for one API instance. Several instances would each allow
 * one request per second; they would need a shared limiter in Redis (geo README).
 */
export class RateLimitedGeocoder implements GeocodingPort {
  /** Settles when the last queued call has finished. */
  private tail: Promise<void> = Promise.resolve();
  private lastStartMs = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly inner: GeocodingPort,
    private readonly limit: RateLimit,
    private readonly clock: Clock,
  ) {}

  async search(query: GeocodeQuery, options?: GeocodeOptions): Promise<GeocodeCandidate[]> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => (release = resolve));
    const deadline = this.now() + this.limit.queueTimeoutMs;
    let gaveUp = false;

    try {
      if (!(await this.settlesBefore(previous, deadline))) {
        gaveUp = true;
        throw busy();
      }
      const startAt = Math.max(this.now(), this.lastStartMs + this.limit.minIntervalMs);
      if (startAt > deadline) throw busy();
      await sleep(startAt - this.now());
      this.lastStartMs = this.now();
      return await this.inner.search(query, options);
    } finally {
      // A caller that gave up must not let the next one overtake the call it was waiting for.
      if (gaveUp) void previous.then(release);
      else release();
    }
  }

  private now(): number {
    return this.clock.now().getTime();
  }

  /** Whether `previous` settles before `deadline`. */
  private async settlesBefore(previous: Promise<void>, deadline: number): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), Math.max(0, deadline - this.now()));
    });
    try {
      return await Promise.race([previous.then(() => true as const), timedOut]);
    } finally {
      clearTimeout(timer);
    }
  }
}

function busy(): GeocodingUnavailableError {
  return new GeocodingUnavailableError('queue-timeout', false, {
    message: 'The geocoding provider is busy. Try again in a few seconds.',
  });
}
