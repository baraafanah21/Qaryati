import type { GeocodingProvider } from './geocoding.port';

/** How an accepted candidate of each provider is cited: the `EXTERNAL_API` source. */
export interface GeocodingSource {
  title: string;
  url: string;
}

/** The source of every provider; the module builds it from configuration. */
export type GeocodingSources = Readonly<Record<GeocodingProvider, GeocodingSource>>;

/** Injection token of {@link GeocodingSources}. */
export const GEOCODING_SOURCES = Symbol('GEOCODING_SOURCES');
