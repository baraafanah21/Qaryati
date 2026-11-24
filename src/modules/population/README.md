# population module

**Owner:** Yahya · **Issues:** #28, #33

## Responsibility

Population records per village and year, the consistency rules, and population history and statistics.

## Owned data

`population_record`, declared in `infrastructure/persistence/schema.ts` (migration `0017`). It follows "Fact tables: one pattern for all" in [docs/data-model.md](../../../docs/data-model.md): each row is the value of exactly one `POPULATION` claim.

| Column           | Type     | Rule                                                                                       |
| ---------------- | -------- | ------------------------------------------------------------------------------------------ |
| `claim_id`       | uuid     | primary key                                                                                |
| `claim_type`     | text     | NOT NULL, default `POPULATION`, `CHECK (claim_type = 'POPULATION')` (structural, constant) |
| `population`     | integer  | NOT NULL; 0 … 1 000 000 in the domain                                                      |
| `reference_year` | smallint | NOT NULL; 1800 … the current year (`Clock`) in the domain                                  |
| `count_type`     | text     | NOT NULL; `CENSUS`, `ESTIMATE`, `REGISTERED` in the domain                                 |

- `(claim_id, claim_type) → claim (id, claim_type) ON DELETE CASCADE` is cross-module, so it is raw SQL in `0018_population_claim_fks` ([docs/database.md](../../../docs/database.md#cross-module-foreign-keys)). The primary key index on `claim_id` serves it.
- No village, source or status column: those live on `claim`. No other CHECK: ranges and allowed values are in `domain/population-record.ts` and `domain/population-values.ts`, unit-tested, and the zod schemas read the same arrays.
- Reads that need the review state join curation's SQL fragments `preferredClaimsOf('POPULATION')` and `claimsOf('POPULATION')`, so this module never names the `claim` table.

## Claim

`populationClaim(villageId, value)` in `domain/population-claim.ts`:

- `group_key` = `population|<village>|<year>|<count_type>`: one published number per village, year and count type.
- `value_hash` = `valueHash({ population })`: two sources giving the same number agree; a different number is a conflict.

## Consistency rules 1–5

| #   | Rule                                                                                                                                                                                                                   | Where                                                                            | Result                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------ |
| 1   | A source is required.                                                                                                                                                                                                  | curation (`SOURCE_REQUIRED_ON_SUBMIT` contains `POPULATION`), on submit and edit | 422                                  |
| 2   | One value per (village, year, count type, source).                                                                                                                                                                     | the partial unique index `claim_no_duplicate (group_key, value_hash, source_id)` | 409 `DUPLICATE`                      |
| 3   | The year is not in the future (nor before 1800); the population is a whole number 0 … 1 000 000.                                                                                                                       | `validatePopulation(input, clock year)`                                          | 422 `VALIDATION_FAILED`              |
| 4   | A different value for an existing question is a new claim and never overwrites the old one.                                                                                                                            | nothing to code: same `group_key`, another `value_hash`                          | 201, listed in `/curation/conflicts` |
| 5   | **Anomaly:** against the nearest preferred record of the same count type (another year; on a tie the earlier one), an average yearly change above 50%, up or down, adds `warnings: ["ANOMALY_SUSPECTED"]` to the body. | `populationWarnings` in `domain/population-anomaly.ts`                           | 201 / 200, not an error              |

The average yearly change is **compounded**: `(later / earlier) ^ (1 / years) − 1`, the same formula as `averageYearlyGrowthPercent` in the statistics. There is no rate from a count of 0 (no warning). Rule 3 is a domain rule, so it answers 422 like every other domain validation ([docs/errors.md](../../../docs/errors.md#validation-failed)); a wrong shape (`12.5`, unknown count type, unknown field) is 400.

## REST API

| Method | Endpoint                                     | Who                          | Notes                                                                                                                                                       |
| ------ | -------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/villages/{id}/population`           | public                       | Preferred records, by year (then census, register, estimate), `page`/`size`. `includeUnverified=true`: every claim for EDITOR+, plus own claims for others. |
| GET    | `/api/v1/villages/{id}/population/stats`     | public                       | Preferred records only; see "Statistics".                                                                                                                   |
| POST   | `/api/v1/villages/{id}/population`           | logged in                    | `{ population, referenceYear, countType, sourceId, sourceLocator?, supersedesId? }`; 201, `ETag`, `warnings`.                                               |
| PATCH  | `/api/v1/villages/{id}/population/{claimId}` | the author, while UNVERIFIED | `If-Match` = claim version (428 / 412); `ClaimWriter.edit` + fact update; 200 with `warnings`.                                                              |
| DELETE | `/api/v1/villages/{id}/population/{claimId}` | the author, while UNVERIFIED | Withdraw (`WITHDRAWN`, kept as history); `If-Match`; 204.                                                                                                   |

Verify, dispute, reject and prefer are curation's `/api/v1/claims/{id}/...`. Anonymous readers see published villages only (404 for a draft), like the village facts.

Every write goes through curation's `ClaimWriter` inside one `@Transactional()` use case, which records `claim.submitted`, `claim.edited` (with the population value before and after as `fact`) or `claim.withdrawn`, with the `villageId`.

## Statistics

`GET /population/stats` runs one native statement (`infrastructure/population.sql.ts`, `populationChangesQuery`):

- `lag()` over `PARTITION BY count_type ORDER BY reference_year`: census and estimate series are never mixed.
- Per record: `previousYear`, `previousPopulation`, `absoluteChange`, `percentChange` and `averageYearlyGrowthPercent` (two decimals; null on the first record of a count type, percentages null after a count of 0).
- `summary`: `first` and `latest` in time, `min` and `max` population (`summarizePopulation`), or `null` without records.

## Public API (`index.ts`)

- `PopulationQueries` (global, for profile #39), preferred records only:
  - `latestFor(villageIds)`: the latest record of each village, one `DISTINCT ON (village_id)` statement; on equal years census beats register beats estimate. At most `MAX_LATEST_VILLAGE_IDS` (100) ids.
  - `historyFor(villageId)`: every record, by year.
- `COUNT_TYPES`, `isCountType`, `CountType`.

Population keeps no projection, so it registers no `ClaimTypeHandler`.

## Dependencies

| Direction                         | Modules                      |
| --------------------------------- | ---------------------------- |
| May import (besides `src/shared`) | `iam`, `curation`, `village` |
| Imported by                       | `profile`                    |

dependency-cruiser enforces these directions (`module-dependency-direction`), and other modules may reach this one only through `index.ts` (`no-cross-module-internals`). See [docs/architecture.md](../../../docs/architecture.md).

## Tests

- Unit: `domain/*.spec.ts` (every rule, the anomaly at 49% and 51%, the claim function, the summary) and `application/list-population-records.spec.ts` (who sees what).
- Integration: `test/population/population.int-spec.ts` (wrong-type FK, CHECK, cascade, `lag()` on a known series, `DISTINCT ON` latest per village, list scopes).
- E2E: `test/population/population.e2e-spec.ts`.

## Layout

| Folder            | Holds                                                                               |
| ----------------- | ----------------------------------------------------------------------------------- |
| `web/`            | Controllers and request/response DTOs                                               |
| `application/`    | Use cases; the transaction boundary                                                 |
| `domain/`         | Entities, value objects, rules and repository ports; plain TypeScript, no framework |
| `infrastructure/` | Adapters: Drizzle repositories and schema, Redis, HTTP clients                      |
