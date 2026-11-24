# economy module

**Owner:** Hamam · **Issues:** #22, #36

## Responsibility

What each village produces, its community facilities, and the product filter for village search (`GET /products/{idOrCode}/villages`). A village product and a facility are claims (docs/data-model.md): submitted unverified, reviewed through curation, published when preferred.

**Facilities are supporting context only.** The brief treats community and facility information as context for a village's profile, not as something Qaryati manages: there is no facility directory, no opening hours, no contact details and no management workflow, only the claim of what exists (type, name, optional point, optional year).

## Owned data

Three tables, declared in `infrastructure/persistence/schema.ts` (migration `0021`).

| Table             | Kind                    | Columns                                                                                                                                                       |
| ----------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `product`         | reference data          | `id`, `code` (unique `product_code_key`), `category` (index `product_category_idx`), `name_ar`, `name_en`, `version`, `created_at`, `updated_at`              |
| `village_product` | fact, `VILLAGE_PRODUCT` | `product_id uuid NOT NULL → product ON DELETE RESTRICT` (index `village_product_product_id_idx`), `significance text NOT NULL`                                |
| `facility`        | fact, `FACILITY`        | `facility_type text NOT NULL`, `name text NOT NULL`, `location geography(Point,4326)` (GiST `facility_location_gist`), `established_year smallint` (nullable) |

- Both fact tables follow "Fact tables: one pattern for all": `claim_id` primary key, a constant `claim_type` with `CHECK (claim_type = '<TYPE>')`, and no village, source or status column (those live on `claim`).
- `(claim_id, claim_type) → claim (id, claim_type) ON DELETE CASCADE` is cross-module, so it is raw SQL in `0022_economy_claim_fks` ([docs/database.md](../../../docs/database.md#cross-module-foreign-keys)). The primary key index on `claim_id` serves it.
- `village_product.product_id → product` is `RESTRICT`: a product that a claim names stays, because claims are history.
- No other CHECK. Allowed values and rules are in `domain/`, unit-tested, and the zod schemas read the same arrays.

### Products

The 15 common products are seeded by the data migration `0023_seed_products.sql` with fixed UUIDv7 ids and `ON CONFLICT (code) DO NOTHING`, so it is idempotent and never overwrites an edited row. The list lives once, in `infrastructure/seed/products.ts`; `test/economy/economy.int-spec.ts` checks that the database matches it. A change to the list is a new migration plus a change to that file. Products are not editable through the API.

| Code                                                                             | Category    |
| -------------------------------------------------------------------------------- | ----------- |
| `olives`, `grapes`, `figs`, `wheat`, `barley`, `almonds`, `citrus`, `vegetables` | `CROP`      |
| `sheep-and-goats`, `honey`                                                       | `LIVESTOCK` |
| `embroidery`, `pottery`                                                          | `CRAFT`     |
| `olive-oil`, `stone-quarrying`, `soap`                                           | `INDUSTRY`  |

**Cache.** Like administrative units, products go through `CachedProductRepository` (an `lru-cache` decorator around `DrizzleProductRepository`), kept in each API process for `PRODUCTS_CACHE_TTL_SECONDS` (default 3600, [configuration.md](../../../docs/configuration.md)), at most 200 entries. Misses are not cached. Village product lists take the product names from the cached full list (one entry), not one lookup per row. Cost: a product changed by a migration can be stale for up to one TTL per process.

## Values and rules (`domain/economy-values.ts`, `domain/economy-facts.ts`)

| Value                   | Allowed                                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `PRODUCT_CATEGORIES`    | `CROP`, `LIVESTOCK`, `CRAFT`, `INDUSTRY`, `SERVICE`                                                                          |
| `PRODUCT_SIGNIFICANCES` | `PRIMARY`, `SECONDARY`, `HISTORICAL`                                                                                         |
| `FACILITY_TYPES`        | `SCHOOL`, `CLINIC`, `HOSPITAL`, `LIBRARY`, `COMMUNITY_CENTER`, `PARK`, `SPORTS`, `MOSQUE`, `CHURCH`, `MUNICIPALITY`, `OTHER` |

Rules, all **422 `VALIDATION_FAILED`** naming every broken field (a wrong shape, such as an unknown enum value, is 400):

- Facility name: NFC, white space collapsed, trimmed; 1–200 characters and at least one letter or digit.
- Facility coordinates: latitude −90 … 90, longitude −180 … 180, rounded to 5 decimals (`roundCoordinate`).
- `established_year`: a whole year from 1800 to the current year (`Clock`, UTC).
- A village product names an existing product (404 otherwise).
- **Source:** neither type is in curation's `SOURCE_REQUIRED_ON_SUBMIT`; any claim still needs one to be verified.

## Claims (`domain/economy-claims.ts`)

| Type              | `group_key`                              | `value_hash` of                  |
| ----------------- | ---------------------------------------- | -------------------------------- |
| `VILLAGE_PRODUCT` | `product\|v\|product_id`                 | significance                     |
| `FACILITY`        | `facility\|v\|type\|normalizeName(name)` | rounded point + established year |

A `|` in a facility name becomes `/` in the key. The same value from the same source for the same question is a 409 (`claim_no_duplicate`); a different value (for example `PRIMARY` from one source and `HISTORICAL` from another) is another claim, listed in `/curation/conflicts`.

## REST API

| Method | Endpoint                                                 | Who                          | Notes                                                                                                                 |
| ------ | -------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/products?category=`                             | public                       | Every product by category then English name, not paginated; cached                                                    |
| GET    | `/api/v1/products/{idOrCode}/villages?page=&size=&sort=` | public                       | Villages with a **preferred** `VILLAGE_PRODUCT` claim for the product; sort `nameAr` (default), `nameEn`, `createdAt` |
| GET    | `/api/v1/villages/{id}/products`                         | public                       | By the product's English name; each item carries its `product`                                                        |
| POST   | `/api/v1/villages/{id}/products`                         | logged in                    | 404 for an unknown product                                                                                            |
| GET    | `/api/v1/villages/{id}/facilities?type=`                 | public                       | By type, then name; `type` filters                                                                                    |
| POST   | `/api/v1/villages/{id}/facilities`                       | logged in                    | `location` written with native SQL (`ST_MakePoint`)                                                                   |
| PATCH  | `/api/v1/villages/{id}/{products\|facilities}/{claimId}` | the author, while UNVERIFIED | `If-Match` = claim version (428 / 412); absent fields keep their value                                                |
| DELETE | `/api/v1/villages/{id}/{products\|facilities}/{claimId}` | the author, while UNVERIFIED | Withdraw (`WITHDRAWN`, kept as history); `If-Match`; 204                                                              |

- Village lists take `page`, `size` and `includeUnverified`: `true` shows every claim to EDITOR+, and the reader's own claims as well as the published ones to other logged-in users. Anonymous readers see published villages only (404 for a draft).
- **Villages by product** (#36): economy runs one native statement, `village_product` by `village_product_product_id_idx` joined to curation's `preferredClaimsOf('VILLAGE_PRODUCT')` by claim id, and passes the village ids to `VillageQueries.search({ villageIds, sort, page, size, viewer })`. Village filters by publication status for the viewer, sorts and pages in one statement, so the page and its total are exact. Village never imports economy. The id list is not capped: the `?ids=` limit of `GET /villages` is a limit of that query string, not of the facade.
- Verify, dispute, reject and prefer are curation's `/api/v1/claims/{id}/...`.
- Every write goes through curation's `ClaimWriter` inside one `@Transactional()` use case, which records `claim.submitted`, `claim.edited` (with the value before and after as `fact`) or `claim.withdrawn`, with the `villageId`.

## Public API (`index.ts`)

- `EconomyQueries` (global, for profile #39): `sectionsFor(villageId)` returns `{ products, facilities }`, preferred claims only (two indexed statements and the cached product list), each product with its `product`. It does not check the village's publication status; the caller does.
- The value lists, their guards and types, and the value types.

Economy keeps no projection, so it registers no `ClaimTypeHandler`.

## Dependencies

| Direction                         | Modules                      |
| --------------------------------- | ---------------------------- |
| May import (besides `src/shared`) | `iam`, `curation`, `village` |
| Imported by                       | `profile`                    |

dependency-cruiser enforces these directions (`module-dependency-direction`), and other modules may reach this one only through `index.ts` (`no-cross-module-internals`). See [docs/architecture.md](../../../docs/architecture.md).

## Tests

- Unit: `domain/*.spec.ts` (value lists, every rule, both claim functions) and `application/list-economy-facts.spec.ts` (who sees what).
- Integration: `test/economy/economy.int-spec.ts`: the seed matches `seed/products.ts` and is idempotent; product `RESTRICT`; for each fact table, own type accepted, another type 23503, constant CHECK 23514, second row per claim 23505, cascade; facility point round trip; villages by product (preferred only) and its index (`EXPLAIN`); list order, filter and scopes; `EconomyQueries`; the product cache and its TTL.
- E2E: `test/economy/economy.e2e-spec.ts`.

## Layout

| Folder            | Holds                                                                               |
| ----------------- | ----------------------------------------------------------------------------------- |
| `web/`            | Controllers and request/response DTOs                                               |
| `application/`    | Use cases; the transaction boundary                                                 |
| `domain/`         | Entities, value objects, rules and repository ports; plain TypeScript, no framework |
| `infrastructure/` | Adapters: Drizzle repositories and schema, Redis, HTTP clients                      |
