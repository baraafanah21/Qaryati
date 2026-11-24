/** Providers that can sit behind {@link GeocodingPort}. */
export const GEOCODING_PROVIDERS = ['nominatim', 'stub'] as const;

/** One of {@link GEOCODING_PROVIDERS}. */
export type GeocodingProvider = (typeof GEOCODING_PROVIDERS)[number];

/** Default and maximum number of candidates one search returns. */
export const DEFAULT_GEOCODE_LIMIT = 5;
export const MAX_GEOCODE_LIMIT = 10;

/** What to look up: a place name, and another name to try when the first finds nothing. */
export interface GeocodeQuery {
  /** The main name, usually the preferred Arabic name of the village. */
  name: string;
  /** A second name (usually English), searched only when `name` finds nothing. */
  nameAlt?: string;
  /** At most this many candidates; 1 to {@link MAX_GEOCODE_LIMIT}, default {@link DEFAULT_GEOCODE_LIMIT}. */
  limit?: number;
}

/** A place the provider found: a suggestion, never a verified fact. */
export interface GeocodeCandidate {
  displayName: string;
  latitude: number;
  longitude: number;
  provider: GeocodingProvider;
  /** The provider's own id of the place (for Nominatim `node/123`), when it has one. */
  providerRef: string | null;
}

/** Options for one search. */
export interface GeocodeOptions {
  /** Aborts the provider call; the resilience layer passes its timeout here. */
  signal?: AbortSignal;
}

/**
 * Looks place names up in an external geocoding service. Adapters translate
 * every provider failure into `GeocodingUnavailableError` or
 * `GeocodingBadResponseError` (geo domain), so callers never see a raw HTTP
 * error or the provider's body. An empty array means "nothing found".
 */
export interface GeocodingPort {
  search(query: GeocodeQuery, options?: GeocodeOptions): Promise<GeocodeCandidate[]>;
}

/** Injection token of {@link GeocodingPort}. */
export const GEOCODING_PORT = Symbol('GEOCODING_PORT');

/** The limit an adapter applies: the default when absent, clamped to 1..max. */
export function effectiveLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_GEOCODE_LIMIT;
  return Math.min(MAX_GEOCODE_LIMIT, Math.max(1, Math.trunc(limit)));
}
