import { Logger } from '@nestjs/common';
import {
  ConsecutiveBreaker,
  ExponentialBackoff,
  TimeoutStrategy,
  circuitBreaker,
  handleWhen,
  isBrokenCircuitError,
  isIsolatedCircuitError,
  isTaskCancelledError,
  retry,
  timeout,
  wrap,
  type CircuitBreakerPolicy,
  type IPolicy,
} from 'cockatiel';
import type {
  GeocodeCandidate,
  GeocodeOptions,
  GeocodeQuery,
  GeocodingPort,
} from '../application/geocoding.port';
import { GeocodingBadResponseError, GeocodingUnavailableError } from '../domain/geocoding-errors';

/** Policy values, from `GEO_*` configuration (geo README explains each one). */
export interface ResiliencePolicy {
  /** Time limit of one attempt (`GEO_TIMEOUT_MS`). */
  timeoutMs: number;
  /** Retries after the first attempt, for transient failures only. */
  maxRetries: number;
  /** First backoff delay (`GEO_RETRY_BASE_MS`); doubles with jitter. */
  retryBaseMs: number;
  /** Consecutive failed calls that open the breaker (`GEO_BREAKER_THRESHOLD`). */
  breakerThreshold: number;
  /** How long the breaker stays open before one trial call (`GEO_BREAKER_HALF_OPEN_MS`). */
  halfOpenAfterMs: number;
}

const isGeocodingFailure = (error: unknown): boolean =>
  error instanceof GeocodingUnavailableError || error instanceof GeocodingBadResponseError;

/** Retry only what may succeed a moment later: timeouts, network errors, 502/503/504. */
const isTransient = (error: unknown): boolean =>
  (error instanceof GeocodingUnavailableError && error.transient) || isTaskCancelledError(error);

/**
 * Timeout, retry and circuit breaker around a geocoder (cockatiel).
 *
 * Order, outside in: breaker → retry → timeout → provider. The breaker sees
 * one result per call (after its retries), so `breakerThreshold` counts
 * failed calls, not attempts. While it is open, calls fail at once with a
 * non-transient {@link GeocodingUnavailableError} and the provider is not called.
 */
export class ResilientGeocoder implements GeocodingPort {
  private readonly logger = new Logger(ResilientGeocoder.name);
  private readonly breaker: CircuitBreakerPolicy;
  private readonly policy: IPolicy<{ signal: AbortSignal }>;

  constructor(
    private readonly inner: GeocodingPort,
    policy: ResiliencePolicy,
  ) {
    this.breaker = circuitBreaker(handleWhen(isGeocodingFailure), {
      halfOpenAfter: policy.halfOpenAfterMs,
      breaker: new ConsecutiveBreaker(policy.breakerThreshold),
    });
    // State changes only, once each; no query or provider data in the log.
    this.breaker.onBreak(() => this.logger.warn('Geocoding circuit breaker opened'));
    this.breaker.onReset(() => this.logger.log('Geocoding circuit breaker closed'));

    const retryTransient = retry(handleWhen(isTransient), {
      maxAttempts: policy.maxRetries,
      backoff: new ExponentialBackoff({
        initialDelay: policy.retryBaseMs,
        maxDelay: policy.retryBaseMs * 8,
      }),
    });
    // Cooperative: the adapter sees the aborted signal and throws its own timeout error.
    const perAttempt = timeout(policy.timeoutMs, TimeoutStrategy.Cooperative);
    this.policy = wrap(this.breaker, retryTransient, perAttempt);
  }

  async search(query: GeocodeQuery, options: GeocodeOptions = {}): Promise<GeocodeCandidate[]> {
    try {
      return await this.policy.execute(
        ({ signal }) => this.inner.search(query, { signal }),
        options.signal,
      );
    } catch (error) {
      throw toGeocodingError(error);
    }
  }

  /** Holds the breaker open until the returned handle is disposed; for tests and incidents. */
  isolate(): { dispose(): void } {
    return this.breaker.isolate();
  }
}

function toGeocodingError(error: unknown): unknown {
  if (isBrokenCircuitError(error) || isIsolatedCircuitError(error)) {
    return new GeocodingUnavailableError('circuit-open', false, {
      message:
        'The geocoding provider is temporarily disabled after repeated failures. Try again later.',
    });
  }
  if (isTaskCancelledError(error)) {
    return new GeocodingUnavailableError('timeout', true, { cause: error });
  }
  return error;
}
