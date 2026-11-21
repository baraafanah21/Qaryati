import type { GeocodingCandidate, GeocodingPort } from '../application/geocoding.port';

export class StubGeocodingAdapter implements GeocodingPort {
  constructor(
    private readonly fixtures: readonly GeocodingCandidate[] = [
      {
        displayName: 'Test Village, Palestine',
        latitude: 31.9,
        longitude: 35.2,
      },
    ],
  ) {}

  search(query: string): Promise<GeocodingCandidate[]> {
    const normalized = query.trim().toLowerCase();

    if (!normalized) {
      return Promise.resolve([]);
    }

    return Promise.resolve(
      this.fixtures
        .filter((item) => item.displayName.toLowerCase().includes(normalized))
        .map((item) => ({ ...item })),
    );
  }
}
