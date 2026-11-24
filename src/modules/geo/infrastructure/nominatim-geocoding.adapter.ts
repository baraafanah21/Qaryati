import { z } from 'zod';
import {
  effectiveLimit,
  type GeocodeCandidate,
  type GeocodeOptions,
  type GeocodeQuery,
  type GeocodingPort,
} from '../application/geocoding.port';
import { GeocodingBadResponseError, GeocodingUnavailableError } from '../domain/geocoding-errors';

/** Settings of {@link NominatimGeocodingAdapter}, from `GEO_*` configuration. */
export interface NominatimSettings {
  /** `GEO_NOMINATIM_URL`, without the `/search` path. */
  baseUrl: string;
  /** `GEO_USER_AGENT`: required by the Nominatim usage policy. */
  userAgent: string;
  /** `GEO_TIMEOUT_MS`: used when the caller passes no abort signal of its own. */
  timeoutMs: number;
}

/**
 * Runs before every HTTP request; the resilience layer passes a spacer that
 * keeps requests at least one second apart (Nominatim's usage policy).
 */
export type BeforeRequest = (signal: AbortSignal) => Promise<void>;

/** Statuses that usually mean "try again in a moment" (gateway and overload errors). */
const TRANSIENT_STATUSES = new Set([502, 503, 504]);

/** A search answer is a few kilobytes; anything far larger is not what we asked for. */
const MAX_BODY_CHARS = 1_000_000;

const coordinate = (min: number, max: number) =>
  z
    .string()
    .regex(/^-?\d+(\.\d+)?$/)
    .transform(Number)
    .pipe(z.number().min(min).max(max));

/** The fields of a `format=jsonv2` search result we use; others are ignored. */
const searchResponse = z.array(
  z.object({
    display_name: z.string().min(1).max(1000),
    lat: coordinate(-90, 90),
    lon: coordinate(-180, 180),
    osm_type: z.string().max(20).optional(),
    osm_id: z.number().int().optional(),
  }),
);

/**
 * Geocoding through the Nominatim search API with Node's `fetch`.
 *
 * Searches are limited to `countrycodes=ps,il`: many depopulated villages lie
 * inside today's Israel, so `ps` alone would miss them (geo README). Every
 * failure becomes a {@link GeocodingUnavailableError} or a
 * {@link GeocodingBadResponseError}; the provider's body never leaves here.
 */
export class NominatimGeocodingAdapter implements GeocodingPort {
  constructor(
    private readonly settings: NominatimSettings,
    private readonly beforeRequest: BeforeRequest = () => Promise.resolve(),
  ) {
    if (!settings.userAgent.trim()) {
      throw new Error('GEO_USER_AGENT is required for the Nominatim provider.');
    }
  }

  async search(query: GeocodeQuery, options: GeocodeOptions = {}): Promise<GeocodeCandidate[]> {
    const signal = options.signal ?? AbortSignal.timeout(this.settings.timeoutMs);
    const limit = effectiveLimit(query.limit);
    const name = query.name.trim();
    const results = name ? await this.request(name, limit, signal) : [];
    const alt = query.nameAlt?.trim();
    if (results.length > 0 || !alt || alt === name) return results;
    return this.request(alt, limit, signal);
  }

  private async request(
    q: string,
    limit: number,
    signal: AbortSignal,
  ): Promise<GeocodeCandidate[]> {
    const url = new URL(
      'search',
      this.settings.baseUrl.endsWith('/') ? this.settings.baseUrl : `${this.settings.baseUrl}/`,
    );
    url.search = new URLSearchParams({
      q,
      format: 'jsonv2',
      limit: String(limit),
      countrycodes: 'ps,il',
      'accept-language': 'ar,en',
    }).toString();

    let body: string;
    try {
      await this.beforeRequest(signal);
      const response = await fetch(url, {
        headers: { 'User-Agent': this.settings.userAgent, Accept: 'application/json' },
        signal,
        redirect: 'error',
      });
      if (!response.ok) {
        // Drop the body unread: it may be an HTML error page we must not pass on.
        await response.body?.cancel().catch(() => undefined);
        throw httpFailure(response.status);
      }
      body = await response.text();
    } catch (error) {
      throw toUnavailable(error, signal);
    }

    if (body.length > MAX_BODY_CHARS) throw new GeocodingBadResponseError();
    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      // No cause: a JSON syntax error quotes part of the provider's body.
      throw new GeocodingBadResponseError();
    }
    const parsed = searchResponse.safeParse(payload);
    if (!parsed.success) throw new GeocodingBadResponseError(z.flattenError(parsed.error));

    return parsed.data.map((place) => ({
      displayName: place.display_name,
      latitude: place.lat,
      longitude: place.lon,
      provider: 'nominatim',
      providerRef:
        place.osm_type !== undefined && place.osm_id !== undefined
          ? `${place.osm_type}/${place.osm_id}`
          : null,
    }));
  }
}

function httpFailure(status: number): GeocodingUnavailableError {
  if (status === 429)
    return new GeocodingUnavailableError('rate-limited', false, { httpStatus: status });
  return new GeocodingUnavailableError('http', TRANSIENT_STATUSES.has(status), {
    httpStatus: status,
  });
}

/** Maps what `fetch` threw: our own HTTP failure, a timeout or abort, or a network error. */
function toUnavailable(error: unknown, signal: AbortSignal): GeocodingUnavailableError {
  if (error instanceof GeocodingUnavailableError) return error;
  if (signal.aborted) return new GeocodingUnavailableError('timeout', true, { cause: error });
  return new GeocodingUnavailableError('network', true, { cause: error });
}
