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

The module exports `normalizeName` for consistent comparison of Arabic and
Latin names, including names owned by other modules such as heritage landmarks.
Other village facades remain planned:

- Village search facade (#30) with an optional `villageIds` filter, used by economy for the product filter.
- Village lookups used by the content modules, geo and profile.

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
