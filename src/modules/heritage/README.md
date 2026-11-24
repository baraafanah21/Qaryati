# heritage module

**Owner:** Ali · **Issues:** #17, #24, #31

## Responsibility

History overview, historical events, landmarks and cultural items of a village. Each one is a claim (docs/data-model.md): submitted unverified, reviewed through curation, published when preferred.

## Owned data

Four fact tables, declared in `infrastructure/persistence/schema.ts` (migration `0019`). Each follows "Fact tables: one pattern for all" in [docs/data-model.md](../../../docs/data-model.md): `claim_id` primary key, a constant `claim_type` with `CHECK (claim_type = '<TYPE>')` (structural, never changes), and no village, source or status column (those live on `claim`).

| Table              | `claim_type`       | Value columns                                                                                                                                         |
| ------------------ | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `history_overview` | `HISTORY_OVERVIEW` | `summary text NOT NULL`                                                                                                                               |
| `historical_event` | `HISTORICAL_EVENT` | `title text NOT NULL`, `description text NOT NULL`, `start_date date NOT NULL`, `end_date date`, `date_precision text NOT NULL`                       |
| `landmark`         | `LANDMARK`         | `name text NOT NULL`, `landmark_type text NOT NULL`, `description text`, `location geography(Point,4326)` (GiST `landmark_location_gist`), `era text` |
| `cultural_item`    | `CULTURAL_ITEM`    | `category text NOT NULL`, `name text NOT NULL`, `description text NOT NULL`                                                                           |

- `(claim_id, claim_type) → claim (id, claim_type) ON DELETE CASCADE` for each table is cross-module, so it is raw SQL in `0020_heritage_claim_fks` ([docs/database.md](../../../docs/database.md#cross-module-foreign-keys)). The primary key index on `claim_id` serves it.
- No other CHECK. Allowed values and rules are in `domain/`, unit-tested, and the zod schemas read the same arrays.

## Values and rules (`domain/heritage-values.ts`, `domain/heritage-facts.ts`)

| Value                 | Allowed                                                                                                                                                              |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LANDMARK_TYPES`      | `MOSQUE`, `CHURCH`, `MAQAM`, `CEMETERY`, `SPRING`, `WELL`, `SCHOOL`, `KHAN`, `MILL`, `OLIVE_PRESS`, `FORTRESS`, `HOUSE`, `ARCHAEOLOGICAL_SITE`, `VIEWPOINT`, `OTHER` |
| `LANDMARK_ERAS`       | `ROMAN`, `BYZANTINE`, `EARLY_ISLAMIC`, `CRUSADER`, `AYYUBID`, `MAMLUK`, `OTTOMAN`, `BRITISH_MANDATE`, `MODERN`                                                       |
| `CULTURAL_CATEGORIES` | `FOLK_SONG`, `DANCE`, `DISH`, `CRAFT`, `COSTUME`, `EMBROIDERY`, `AGRICULTURAL_PRACTICE`, `PROVERB`, `STORY`, `FESTIVAL`, `CUSTOM`, `OTHER`                           |
| `DATE_PRECISIONS`     | `DAY`, `MONTH`, `YEAR`, `DECADE`, `CENTURY`                                                                                                                          |

Rules, all **422 `VALIDATION_FAILED`** naming every broken field (a wrong shape, such as an unknown enum value or a malformed date, is 400):

- Lengths after `normalizeText`: summary 1 … 10 000; names and titles 1–200 and at least one letter or digit; descriptions 1 … 5 000 (optional for a landmark).
- Event dates are real `YYYY-MM-DD` dates and the first day of their period: `MONTH` → day 01, `YEAR` → 01-01, `DECADE` → 01-01 of a year ending in 0, `CENTURY` → 01-01 of a year ending in 00. Both dates match the precision.
- The event start is not after today (`Clock`, UTC); the end, when given, is not before the start.
- Landmark coordinates: latitude −90 … 90, longitude −180 … 180, rounded to 5 decimals (`roundCoordinate`).
- **Source:** `HISTORICAL_EVENT` is in curation's `SOURCE_REQUIRED_ON_SUBMIT` (422 without one, on submit and edit). The other three accept a source but do not require one; any claim still needs one to be verified.

`normalizeText` (`domain/normalize-text.ts`): NFC, spaces and tabs collapsed, at most one blank line between paragraphs, trimmed. Paragraphs survive, so a long text keeps its layout.

## Claims (`domain/heritage-claims.ts`)

| Type               | `group_key`                                 | `value_hash` of                    |
| ------------------ | ------------------------------------------- | ---------------------------------- |
| `HISTORY_OVERVIEW` | `history\|v`                                | normalized summary                 |
| `HISTORICAL_EVENT` | `event\|v\|normalizeName(title)`            | start, end, precision, description |
| `LANDMARK`         | `landmark\|v\|normalizeName(name)`          | type, rounded point, description   |
| `CULTURAL_ITEM`    | `culture\|v\|category\|normalizeName(name)` | description                        |

A `|` in a name becomes `/` in the key. The same value from the same source for the same question is a 409 (`claim_no_duplicate`); a different value is another claim, listed in `/curation/conflicts`.

## REST API

| Method | Endpoint                                         | Who                          | Notes                                                                  |
| ------ | ------------------------------------------------ | ---------------------------- | ---------------------------------------------------------------------- |
| GET    | `/api/v1/villages/{id}/history`                  | public                       | Page of overviews; the published one only by default                   |
| PUT    | `/api/v1/villages/{id}/history`                  | logged in                    | Submits a new `HISTORY_OVERVIEW` claim; 201, `ETag`                    |
| GET    | `/api/v1/villages/{id}/events`                   | public                       | By `start_date`                                                        |
| POST   | `/api/v1/villages/{id}/events`                   | logged in                    | Source required                                                        |
| GET    | `/api/v1/villages/{id}/landmarks?type=`          | public                       | By name; `type` filters                                                |
| POST   | `/api/v1/villages/{id}/landmarks`                | logged in                    | `location` written with native SQL (`ST_MakePoint`)                    |
| GET    | `/api/v1/villages/{id}/cultural-items?category=` | public                       | By category, then name                                                 |
| POST   | `/api/v1/villages/{id}/cultural-items`           | logged in                    |                                                                        |
| PATCH  | `/api/v1/villages/{id}/{collection}/{claimId}`   | the author, while UNVERIFIED | `If-Match` = claim version (428 / 412); absent fields keep their value |
| DELETE | `/api/v1/villages/{id}/{collection}/{claimId}`   | the author, while UNVERIFIED | Withdraw (`WITHDRAWN`, kept as history); `If-Match`; 204               |

- Every list takes `page`, `size` and `includeUnverified`: `true` shows every claim to EDITOR+, and the reader's own claims as well as the published ones to other logged-in users. Anonymous readers see published villages only (404 for a draft).
- Writes need an existing village (404). PATCH and DELETE answer 404 when the claim is not a fact of that collection about that village, 403 to anyone but the author.
- Verify, dispute, reject and prefer are curation's `/api/v1/claims/{id}/...`.
- Every write goes through curation's `ClaimWriter` inside one `@Transactional()` use case, which records `claim.submitted`, `claim.edited` (with the value before and after as `fact`) or `claim.withdrawn`, with the `villageId`.

## Public API (`index.ts`)

- `HeritageQueries` (global, for profile #39): `sectionsFor(villageId)` returns `{ history, events, landmarks, culturalItems }`, preferred claims only, four indexed statements run together. It does not check the village's publication status; the caller does.
- The value lists, their guards and types, and the value types.

Heritage keeps no projection, so it registers no `ClaimTypeHandler`.

## Dependencies

| Direction                         | Modules                      |
| --------------------------------- | ---------------------------- |
| May import (besides `src/shared`) | `iam`, `curation`, `village` |
| Imported by                       | `profile`                    |

dependency-cruiser enforces these directions (`module-dependency-direction`), and other modules may reach this one only through `index.ts` (`no-cross-module-internals`). See [docs/architecture.md](../../../docs/architecture.md).

## Tests

- Unit: `domain/*.spec.ts` (value lists, every rule, every claim function, `normalizeText`) and `application/list-heritage-facts.spec.ts` (who sees what).
- Integration: `test/heritage/heritage.int-spec.ts`: for each table, own type accepted, another type 23503, constant CHECK 23514, second row per claim 23505, cascade; landmark point round trip; `ST_DWithin` uses `landmark_location_gist`; list order, filters and scopes; `HeritageQueries`.
- E2E: `test/heritage/heritage.e2e-spec.ts`.

## Layout

| Folder            | Holds                                                                               |
| ----------------- | ----------------------------------------------------------------------------------- |
| `web/`            | Controllers and request/response DTOs                                               |
| `application/`    | Use cases; the transaction boundary                                                 |
| `domain/`         | Entities, value objects, rules and repository ports; plain TypeScript, no framework |
| `infrastructure/` | Adapters: Drizzle repositories and schema, Redis, HTTP clients                      |
