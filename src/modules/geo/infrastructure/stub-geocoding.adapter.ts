import { normalizeName } from '../../village';
import {
  effectiveLimit,
  type GeocodeCandidate,
  type GeocodeQuery,
  type GeocodingPort,
} from '../application/geocoding.port';

/** One fixture place and the names that find it. */
interface StubPlace {
  names: readonly string[];
  candidate: GeocodeCandidate;
}

const place = (
  names: readonly string[],
  displayName: string,
  latitude: number,
  longitude: number,
  osmId: number,
): StubPlace => ({
  names,
  candidate: {
    displayName,
    latitude,
    longitude,
    provider: 'stub',
    providerRef: `stub/${osmId}`,
  },
});

/** A handful of villages with approximate coordinates; enough for tests, k6 and demos. */
export const STUB_PLACES: readonly StubPlace[] = [
  place(['لفتا', 'Lifta'], 'Lifta, Jerusalem', 31.79583, 35.19861, 1),
  place(['دير ياسين', 'Deir Yassin'], 'Deir Yassin, Jerusalem', 31.78639, 35.17889, 2),
  place(['بتير', 'Battir'], 'Battir, Bethlehem', 31.72528, 35.13583, 3),
  place(['سبسطية', 'Sebastia'], 'Sebastia, Nablus', 32.27639, 35.19722, 4),
  place(['بيت فوريك', 'Beit Furik'], 'Beit Furik, Nablus', 32.17, 35.33556, 5),
  place(['عين كارم', 'Ein Karem'], 'Ein Karem, Jerusalem', 31.76861, 35.16111, 6),
];

/**
 * Deterministic geocoder without network, the default (`GEO_PROVIDER=stub`)
 * for development, tests, CI and k6. A query matches a fixture when its
 * normalized name equals one of the fixture's names.
 */
export class StubGeocodingAdapter implements GeocodingPort {
  constructor(private readonly places: readonly StubPlace[] = STUB_PLACES) {}

  search(query: GeocodeQuery): Promise<GeocodeCandidate[]> {
    const limit = effectiveLimit(query.limit);
    const found = this.find(query.name);
    const results = found.length > 0 || !query.nameAlt ? found : this.find(query.nameAlt);
    return Promise.resolve(results.slice(0, limit).map((candidate) => ({ ...candidate })));
  }

  private find(name: string): GeocodeCandidate[] {
    const wanted = normalizeName(name);
    if (!wanted) return [];
    return this.places
      .filter((p) => p.names.some((n) => normalizeName(n) === wanted))
      .map((p) => p.candidate);
  }
}
