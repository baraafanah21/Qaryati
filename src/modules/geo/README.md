# geo module

**Owner:** Ali · **Issues:** #21, #37, #41

## Responsibility

Geocoding through an external API (Nominatim) behind a port: resilience, cache, suggestions and the accept flow that submits a village location claim.

## Owned data

None. Suggestions are not stored: an accepted candidate becomes a `LOCATION` claim owned by the village module. `infrastructure/persistence/schema.ts` stays empty.

## Geocoding port (#21)

`GeocodingPort` (`application/geocoding.port.ts`, token `GEOCODING_PORT`) is the only way the module talks to a geocoder:

```ts
search({ name, nameAlt?, limit? }, { signal? }): Promise<GeocodeCandidate[]>
// GeocodeCandidate = { displayName, latitude, longitude, provider, providerRef }
```

- `name` is searched first; `nameAlt` (usually the English name) only when `name` finds nothing. `limit` is 1–10, default 5.
- An empty array means "nothing found". Every failure is one of two errors from `domain/geocoding-errors.ts`, both 502 through the kernel's `UpstreamError` category ([errors.md](../../../docs/errors.md#geocoding-unavailable)):

| Error                       | Code                     | When                                                                                                                 |
| --------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `GeocodingUnavailableError` | `GEOCODING_UNAVAILABLE`  | timeout, network error, any HTTP error status. `transient` is true for timeouts, network errors and 502/503/504 only |
| `GeocodingBadResponseError` | `GEOCODING_BAD_RESPONSE` | malformed JSON, a body that does not match the schema, coordinates out of range                                      |

The provider's body never reaches the client or the error message: an error status is dropped unread, and a JSON syntax error is thrown without its cause, because its message quotes the body.

### Adapters

`GEO_PROVIDER` picks the adapter in `geo.module.ts` ([configuration.md](../../../docs/configuration.md#geocoding)).

| Adapter                     | When                                     | What it does                                                                                                                                                                                                                               |
| --------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `StubGeocodingAdapter`      | `stub`, the default (dev, tests, CI, k6) | Fixed fixtures for six villages (Lifta, Deir Yassin, Battir, Sebastia, Beit Furik, Ein Karem), matched by `normalizeName` on their Arabic or English name. No network, same answer every time.                                             |
| `NominatimGeocodingAdapter` | `nominatim`                              | Node 24 `fetch`: `GET {GEO_NOMINATIM_URL}/search?q=&format=jsonv2&limit=&countrycodes=ps,il&accept-language=ar,en`, header `User-Agent: {GEO_USER_AGENT}`. The answer is validated with zod (`lat`/`lon` strings → range-checked numbers). |

- **Why `countrycodes=ps,il`:** many of the villages this project documents were depopulated in 1948 and lie inside today's Israel. Searching `ps` alone would miss them; searching worldwide would return same-named places in Syria, Lebanon or Jordan.
- **Why `accept-language=ar,en`:** the display names come back in Arabic when OpenStreetMap has them, which matches the village names editors compare against.
- **User-Agent:** Nominatim's usage policy requires one that identifies the application. The config schema requires `GEO_USER_AGENT` with `GEO_PROVIDER=nominatim` and rejects any value containing `@`: a generic project agent, never a personal email.
- **Timeout:** without a caller signal, one search aborts after `GEO_TIMEOUT_MS`.

## Public API (`index.ts`)

Nothing: no other module calls geo.

## Dependencies

| Direction                         | Modules                      |
| --------------------------------- | ---------------------------- |
| May import (besides `src/shared`) | `iam`, `curation`, `village` |
| Imported by                       | none                         |

dependency-cruiser enforces these directions (`module-dependency-direction`), and other modules may reach this one only through `index.ts` (`no-cross-module-internals`). See [docs/architecture.md](../../../docs/architecture.md).

## Tests

- `infrastructure/nominatim-geocoding.adapter.spec.ts` (nock, `disableNetConnect`): success mapping, empty result, `nameAlt` fallback, malformed JSON, wrong shapes, 503, 429/500/400, timeout, network error, missing User-Agent. The timeout case uses a local server that never answers, because nock's delayed mock socket trips an undici assertion when `fetch` aborts it.
- `infrastructure/stub-geocoding.adapter.spec.ts`, `geo.module.spec.ts` (provider selection).

## Layout

| Folder            | Holds                                            |
| ----------------- | ------------------------------------------------ |
| `web/`            | Controllers and request/response DTOs            |
| `application/`    | Use cases and the geocoding port                 |
| `domain/`         | Geocoding errors; plain TypeScript, no framework |
| `infrastructure/` | Adapters: Nominatim (HTTP), stub                 |
