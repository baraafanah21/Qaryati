import { ErrorCode, UpstreamError } from '../../../shared/kernel';

/** Why the provider could not answer. */
export type GeocodingFailure = 'timeout' | 'network' | 'http' | 'rate-limited' | 'circuit-open';

/**
 * The geocoding provider could not answer (502 `GEOCODING_UNAVAILABLE`).
 * `transient` marks failures worth retrying at once: timeouts, network errors
 * and 502/503/504. A 429 or another HTTP error is not transient: retrying a
 * rate limit makes it worse, and a 500 or 4xx will most likely repeat.
 */
export class GeocodingUnavailableError extends UpstreamError {
  constructor(
    readonly failure: GeocodingFailure,
    readonly transient: boolean,
    readonly httpStatus?: number,
    cause?: unknown,
  ) {
    super('The geocoding provider is unavailable. Try again later.', {
      code: ErrorCode.GEOCODING_UNAVAILABLE,
      details: httpStatus === undefined ? { failure } : { failure, httpStatus },
      cause,
    });
  }
}

/**
 * The provider answered with something unusable: malformed JSON, the wrong
 * shape or coordinates out of range (502 `GEOCODING_BAD_RESPONSE`). The
 * provider's body is never put into the message.
 */
export class GeocodingBadResponseError extends UpstreamError {
  constructor(cause?: unknown) {
    super('The geocoding provider returned an invalid response.', {
      code: ErrorCode.GEOCODING_BAD_RESPONSE,
      cause,
    });
  }
}
