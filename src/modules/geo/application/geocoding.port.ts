export interface GeocodingCandidate {
  displayName: string;
  latitude: number;
  longitude: number;
}

export interface GeocodingPort {
  search(query: string): Promise<GeocodingCandidate[]>;
}

export const GEOCODING_PORT = Symbol('GEOCODING_PORT');
