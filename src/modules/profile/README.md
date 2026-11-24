# profile module

**Owner:** Momen · **Issues:** #39, #45

## Responsibility

Read-only composition of one village: everything the other modules publish about it, in one document, and how complete that knowledge is. Profile owns no table and writes nothing, so it records no audit entries.

| Endpoint                                  | Who                                                   | What                                                                                                     |
| ----------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/villages/{idOrSlug}/profile` | public; anonymous callers see published villages only | identity, names, name origin, affiliations, location, measures, relations, population, heritage, economy |
| `GET /api/v1/villages/{id}/completeness`  | EDITOR+                                               | the claim types without a preferred claim, and a 0–100 score                                             |

`GET /api/v1/villages/{idOrSlug}` stays the identity resource of the village module (with its `ETag`, used by `PATCH`/`DELETE`). The profile is a separate, read-only resource next to it.

## Why a separate module

`village` is the core record every content module points to (`population`, `heritage` and `economy` all import `village`). If `village` also read those modules to build the page, the graph would have cycles (`village → population → village`), and no content module could change or be tested without the others. So the page lives here: `profile` may import every content module's `index.ts`, and **no module imports profile**. dependency-cruiser enforces both (`module-dependency-direction`, [docs/architecture.md](../../../docs/architecture.md#why-village-does-not-depend-on-the-content-modules)).

## The profile document

- **Only published facts.** Every item is a preferred claim. The facades of population, heritage and economy return preferred claims only; village facts are read by the ids that curation's provenance query returns, which are preferred by definition. An item is kept only when that provenance query also saw its claim preferred, so a claim that loses the flag between two statements drops out instead of appearing without a source.
- **Provenance on every fact:** `claimId`, `source` (`id`, `title`, `reliability`), `sourceLocator` and `verifiedAt` (the review time of the claim). A preferred claim is verified, and a verified claim has a source (CHECKs on `claim`), so `source` is never null.
- **Visibility** follows `GET /villages/{idOrSlug}`: anonymous callers get 404 for a draft or archived village; any logged-in user sees every status. A relation to a village the caller may not see is left out, so a draft's name does not leak through its neighbour.
- **Order:** names with `CURRENT` first, then by language and name; affiliations by start date; measures by kind; relations by type; population by year (`latest`: on equal years a census beats a register beats an estimate); heritage and economy in their facades' order.

## Fixed number of queries (no N+1)

The profile sends **17 SQL statements** with warm caches, whatever the number of facts:

| Statements | From                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------ |
| 1          | `VillageQueries.findVisible`: the identity, by id or slug                                              |
| 1          | `ClaimQueries.preferredProvenanceFor`: every preferred claim of the village joined to its source       |
| ≤ 6        | `VillageQueries.factValues`: one `claim_id = ANY(...)` read per village fact type that has claims      |
| ≤ 1        | `VillageQueries.findVisibleByIds`: the villages named by relations                                     |
| 2          | `PopulationQueries.historyFor` and `latestFor`                                                         |
| 4          | `HeritageQueries.sectionsFor`: one per heritage type                                                   |
| 2          | `EconomyQueries.sectionsFor`: products and facilities                                                  |
| 0 (cached) | administrative units (`AdminUnitQueries.list`) and products: in-process caches of their owning modules |

Independent reads run together (`Promise.all`). `test/profile/profile.int-spec.ts` counts the statements of one profile read on `pg.Client#query` and asserts that a village with 20 landmarks, events, cultural items, facilities and population records sends exactly as many as a village with one of each, and no more than 17.

**No Redis cache yet.** A cache of the whole document (#45) is the performance work of task 13. It will be added only if measurements show this endpoint needs it; until then every read is fresh and there is nothing to evict.

## Completeness

`completenessOf` (`domain/completeness.ts`, unit-tested) compares the claim types with a preferred claim (one `SELECT DISTINCT claim_type ... WHERE village_id = $1 AND is_preferred`, the "completeness" query of [docs/data-model.md](../../../docs/data-model.md#main-queries), on the partial index `claim_village_published`) with curation's `CLAIM_TYPES`. Every type weighs the same; a type is complete as soon as one claim of it is published. The score is `floor(present × 100 / 13)`, so 100 means nothing is missing. Drafts count too: editors use it to see what a village still needs before publishing.

## Owned data

None. No `schema.ts`, no migrations.

## Public API (`index.ts`)

Nothing. **No module imports profile.**

## Dependencies

| Direction                         | Modules                                                           |
| --------------------------------- | ----------------------------------------------------------------- |
| May import (besides `src/shared`) | `iam`, `curation`, `village`, `population`, `heritage`, `economy` |
| Imported by                       | none                                                              |

Facades used: `VillageQueries`, `AdminUnitQueries` (village), `ClaimQueries` (curation), `PopulationQueries`, `HeritageQueries`, `EconomyQueries`.

## Layout

| Folder         | Holds                                                                     |
| -------------- | ------------------------------------------------------------------------- |
| `web/`         | `ProfileController`, the response schemas (OpenAPI)                       |
| `application/` | `GetVillageProfile`, `GetVillageCompleteness`, the `VillageProfile` shape |
| `domain/`      | `completenessOf`: plain TypeScript                                        |
