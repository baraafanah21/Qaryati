# village module

**Owner:** Momen · **Issues:** #12, #15, #19, #23, #27, #30, #34, #39

## Responsibility

The core village record: identity and slug, names and name origins, administrative units, search, location, nearby villages, relations, publish and archive. Village does not depend on any content module.

## Owned data

`village`, `village_name`, `name_origin`, `admin_unit`, `village_affiliation`, `village_relation`. Tables are declared only in `infrastructure/persistence/schema.ts` of this module, which `drizzle.config.ts` picks up. No other module edits them. See [docs/database.md](../../../docs/database.md).

## Data model

Issue #15 adds the two identity/reference tables that are not claims:

- `village` stores the stable identity, unique slug, settlement and publication statuses, display-name and location projections, creator, and kernel version/timestamps. Rows are never flagged as deleted: archived villages use `publication_status = 'ARCHIVED'`.
- `admin_unit` stores a unique stable code, self-parent hierarchy, unit and authority types, era, and Arabic/English names.

The `display_name_ar`, `display_name_en`, and `location` columns are projections. They are maintained only when the preferred current name or location claim changes. The local Drizzle geography custom type maps PostgreSQL `geography(Point,4326)` without modifying platform database code.

Allowed values live in `domain/village-values.ts` and `domain/admin-unit-values.ts` as `as const` arrays, with exact, case-sensitive membership checks (`isSettlementStatus`, `isPublicationStatus`, `isAdminUnitType`, `isAdminEra`, `isAuthorityType`); the tables have no CHECK, so these are the only guard. `validateAdminUnit` applies them and then the conditional authority and hierarchy rules. `index.ts` exports the arrays and checks for other modules and API schemas.

## Public API (`index.ts`)

| Export                                                   | Use                                                                                                                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `VillageQueries.exists(id)`                              | Fact modules call it **before** `ClaimWriter.submit`, so a claim for a missing village is a 404 rather than a foreign-key 409.                         |
| `VillageQueries.findById(id)`                            | The identity and its projections (`VillageView`), or `undefined`.                                                                                      |
| `VillageQueries.isVisibleTo(id, user)`                   | Anonymous callers see `PUBLISHED` villages only; any logged-in user sees every status. `false` for a missing village.                                  |
| `AdminUnitQueries.exists / findById / findByCode / list` | Administrative units through the in-process cache.                                                                                                     |
| `normalizeName`                                          | Consistent comparison of Arabic and Latin names, including names owned by other modules such as heritage landmarks.                                    |
| value arrays and `isX` guards                            | `SETTLEMENT_STATUSES`, `PUBLICATION_STATUSES`, `ADMIN_UNIT_TYPES`, `ADMIN_ERAS`, `AUTHORITY_TYPES`: API schemas and other modules read the same lists. |

`VillageModule` is global (like `IamModule` and `CurationModule`), so other modules inject these facades without importing the module's wiring. Planned: the village search facade (#30) with an optional `villageIds` filter.

## Villages REST API (#23, publish/archive from #39)

| Method   | Path                            | Who                                   | Notes                                                                                                               |
| -------- | ------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `POST`   | `/api/v1/villages`              | any logged-in user                    | Body `{ slug, settlementStatus, displayNameAr, displayNameEn? }`. Creates a `DRAFT`; 201 + `Location` + `ETag`.     |
| `GET`    | `/api/v1/villages/{idOrSlug}`   | public (token optional)               | Anonymous: `PUBLISHED` only, other statuses answer 404. With a token: every status. Identity row only.              |
| `PATCH`  | `/api/v1/villages/{id}`         | `EDITOR`+, or the creator while draft | `If-Match` required (428 / 412). Editable: `settlementStatus`, `displayNameAr`, `displayNameEn`.                    |
| `POST`   | `/api/v1/villages/{id}/publish` | `EDITOR`+                             | `DRAFT → PUBLISHED`, `ARCHIVED → PUBLISHED`. `If-Match` required.                                                   |
| `POST`   | `/api/v1/villages/{id}/archive` | `EDITOR`+                             | `PUBLISHED → ARCHIVED`. `If-Match` required.                                                                        |
| `DELETE` | `/api/v1/villages/{id}`         | `ADMIN`                               | Hard delete for spam or personal data, `deleteWithVersion`. A village with claims answers 409 `REFERENCE_CONFLICT`. |

Rules, all in `domain/` with unit tests:

- **Slug** (`validateSlug`): lowercase letters, digits and single hyphens, at most 120 characters, and never UUID-shaped, so `{idOrSlug}` is never ambiguous. A taken slug is a 409 `DUPLICATE` (checked first; the unique index decides a race). The slug cannot be changed by `PATCH`: it is the public URL.
- **Publication workflow** (`publication-rules.ts`): only the three moves above; any other (archiving a draft, publishing a published village) is a 422 `CONSTRAINT_VIOLATION`. Archiving replaces soft delete.
- **Display names** (`display-name-rules.ts`): `display_name_ar` and `display_name_en` are projections of the preferred `CURRENT` name claim in the same language. Each one is editable through `PATCH` only while no such claim is published for its language (question `name|<villageId>|<lang>|current`, checked through curation's `ClaimQueries.hasPreferredForGroup`). After that, a change is a new name claim (422 otherwise). Historical names and alternative spellings never lock it, and the English name stays editable until an English `CURRENT` name is published.
- **Who may edit**: editors and admins any village; the creator their own village while it is `DRAFT` (403 otherwise).

Every write records one audit entry in its transaction, with `villageId`: `village.created`, `village.updated` (before and after), `village.published`, `village.archived`, `village.deleted` (before).

`GET /villages/{idOrSlug}` uses `@Public({ optionalUser: true })`: the route is public, but a sent token is verified (an invalid one is a 401, so a client with an expired token refreshes it instead of silently seeing less). The full village page with its preferred facts belongs to the profile module (#39, later).

## Administrative units (#19)

The 16 current governorates are seeded by the data migration `0013_seed_current_governorates.sql` with fixed UUIDv7 ids and `ON CONFLICT (code) DO NOTHING`, so it is idempotent and never overwrites an edited row. The list lives once, in `infrastructure/seed/governorates.ts`; `test/village/governorates-seed.int-spec.ts` checks that the database matches it. A change to the list is a new migration plus a change to that file.

| Method | Path                                       | Notes                                                                                                                  |
| ------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/v1/admin-units?type=&era=&parentId=` | Public. Every unit matching all given filters, sorted by `nameAr` (then id), not paginated. An unknown value is a 400. |
| `GET`  | `/api/v1/admin-units/{idOrCode}`           | Public. One unit by UUID or code (`nablus`), with an `ETag`; 404 when unknown.                                         |

**Cache.** Administrative units are reference data and change almost never, so `CachedAdminUnitRepository` (an `lru-cache` decorator around `DrizzleAdminUnitRepository`) keeps results in each API process for `ADMIN_UNITS_CACHE_TTL_SECONDS` (default 3600, [configuration.md](../../../docs/configuration.md)), at most 500 entries. Misses are not cached. The TTL reads the injected `Clock`, so the integration test moves past it without sleeping. Cost: a changed unit can be stale for up to one TTL per process ([tech-stack.md](../../../docs/tech-stack.md#lru-cache-in-process)).

## Name normalization

`normalizeName` in `domain/name-normalizer.ts` provides a pure, idempotent
normalization for Arabic, Latin and mixed-script names. It never throws for
string input and returns an empty string for empty or whitespace-only input.
The rules run in this order:

| #   | Rule                                                                               | Example                      |
| --- | ---------------------------------------------------------------------------------- | ---------------------------- |
| 1   | Apply Unicode NFKC to normalize compatibility forms and full-width characters.     | `ﺑﻴﺖ` → `بيت`                |
| 2   | Remove invisible format characters (Unicode category Cf), such as RLM and ZWNJ.    | `Fu`+U+00AD+`rik` → `Furik`  |
| 3   | Remove tashkeel and Quranic marks (U+064B–U+065F, U+0670, U+06D6–U+06ED).          | `صَفُّورِيَّة` → `صفوريه`    |
| 4   | Remove tatweel (U+0640).                                                           | `قريــة` → `قريه`            |
| 5   | Map alef variants أ, إ, آ and ٱ to ا.                                              | `إذنا` → `اذنا`              |
| 6   | Map ة to ه.                                                                        | `قلقيلية` → `قلقيليه`        |
| 7   | Map ى to ي.                                                                        | `مصلى` → `مصلي`              |
| 8   | Map Persian/Urdu ک to ك and ی to ي.                                                | `کفر یاسيف` → `كفر ياسيف`    |
| 9   | Map Arabic-Indic and Persian digits to ASCII digits.                               | `٤٥` → `45`                  |
| 10  | Remove Latin accents using NFD and strip U+0300–U+036F combining marks.            | `Fūrīk` → `Furik`            |
| 11  | Remove transliteration marks ʿ, ʾ, ʻ, ʼ, straight/curly apostrophes and backticks. | `ʻAnan` → `Anan`             |
| 12  | Replace hyphens, dashes (U+2010–U+2015), underscores and dots with spaces.         | `Beit–Furik` → `Beit Furik`  |
| 13  | Lowercase text.                                                                    | `Beit Furik` → `beit furik`  |
| 14  | Collapse repeated whitespace and trim the result.                                  | ` بيت   فوريك` → `بيت فوريك` |

The normalizer deliberately does not strip the Arabic definite article `ال` or
merge words separated by spaces: `بيرزيت` remains distinct from `بير زيت`.
Trigram similarity in search (#30) handles spelling distance without
introducing false matches by deleting meaningful text or boundaries. The
letters ؤ and ئ are preserved for the same reason.

Village names will be stored with this normalized form in
`village_name.name_normalized` (#27). Search (#30) will normalize the query
with the same function before comparing it, so stored names and queries use
matching rules.

## Dependencies

| Direction                         | Modules                                               |
| --------------------------------- | ----------------------------------------------------- |
| May import (besides `src/shared`) | `iam`, `curation`                                     |
| Imported by                       | `population`, `heritage`, `economy`, `geo`, `profile` |

dependency-cruiser enforces these directions (`module-dependency-direction`), and other modules may reach this one only through `index.ts` (`no-cross-module-internals`). See [docs/architecture.md](../../../docs/architecture.md).

## Layout

| Folder            | Holds                                                                               |
| ----------------- | ----------------------------------------------------------------------------------- |
| `web/`            | Controllers and request/response DTOs                                               |
| `application/`    | Use cases; the transaction boundary                                                 |
| `domain/`         | Entities, value objects, rules and repository ports; plain TypeScript, no framework |
| `infrastructure/` | Adapters: Drizzle repositories and schema, Redis, HTTP clients                      |
