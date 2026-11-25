# Seeds (`src/seed`)

Two development tools that fill a local database. Both **refuse to run with `NODE_ENV=production`** (`production-guard.ts`), read their settings through `src/config/seed-env.ts` ([configuration.md](../../docs/configuration.md#seeds)), and are idempotent: run them as often as you like.

| Command                | Writes                                                                                    | How                                                       | Audited                         |
| ---------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------- |
| `npm run db:seed`      | 15 well-known villages with every kind of fact, verified and published                    | **through the HTTP API** of the running stack             | yes, by the API itself          |
| `npm run db:seed:perf` | 800 synthetic villages (`PERF_SEED_VILLAGES`) for the k6 load tests (docs/performance.md) | bulk SQL as the owner role (`jsonb_to_recordset` batches) | no: a fixture loader on purpose |

## `npm run db:seed`: sample villages

Needs the stack running (`docker compose up -d`) and `.env` (it reads `SEED_API_URL` and `DATABASE_OWNER_URL`).

**The data is illustrative.** Names and places are the real villages (Beit Furik, Sebastia, Burqin, Arraba, Zababdeh, Battir, Al-Walaja, Beit Ummar, Taybeh, Jifna, Aboud, Bil'in, Kafr Qaddum, Lifta, Deir Yassin). Coordinates are approximate and stored as `APPROXIMATE`. **Every number (population, years) and every name origin is a plausible sample, not a figure from a cited source.** That is why every claim cites one of two seed sources whose titles end in "(illustrative)" and whose notes say so, with reliability 1. Do not quote these values anywhere.

Each village gets: Arabic and English `CURRENT` names, a name origin, its current governorate, a location, 3–4 population records, and depending on the village landmarks, products and facilities. Every claim is submitted by `seed-author@qaryati.test` (a contributor) and verified by `seed-editor@qaryati.test` (a different account: four eyes), which makes it preferred; the editor then publishes the village.

Why through the API: every domain rule, every audit entry (`claim.submitted`, `claim.verified`, `village.published`, ...) and every projection (`display_name_*`, `location`) is the real one, so the seed cannot write data the API would reject.

**The one write the API cannot do** is the first administrator: there is no endpoint that creates one. The seed promotes `seed-admin@qaryati.test` by SQL as the owner role and writes the matching `user_account.role_changed` audit entry (actor `NULL`, a system action) in the same way. That administrator then promotes the editor through `PATCH /users/{id}/role`, audited by the API.

**Rate limiting stays on.** The seed sends everything from one IP; when the API answers 429 it waits the `Retry-After` seconds and sends the request again (`seed-api-client.ts`, at most 10 times in a row per request, unit-tested). A full run is ~400 requests from two accounts, under the per-user limit of 300 per minute in practice, so on a normal machine it never waits.

**Idempotent:** accounts are registered once (409 is fine), sources are found by their unique title, and a village whose slug exists is skipped whole. If a run is interrupted in the middle of a village, that village stays a draft and is skipped later: reset the database (`docker compose down -v`) to seed it again.

The three accounts share the password `qaryati-seed-password` (development only), so you can log in as an author, an editor or an administrator.

## `npm run db:seed:perf`: synthetic villages

Needs only the database. It writes, for each village (`perf-generator.ts`, fixed random seed `PERF_RANDOM_SEED`, so every run and every machine gets the same data):

- a `PUBLISHED` village with Arabic and English `CURRENT` names built from common name parts ("Beit", "Kafr", "Deir", ... + a second word), so search by partial names is realistic;
- a location near the centre of one of the 16 current governorates, and that governorate as its affiliation;
- 3–5 population records (census years; 1945 is an estimate), 2–4 landmarks with points, 1–2 products;
- every fact as a `VERIFIED`, preferred claim citing one of three sources titled "Synthetic perf dataset: ...", written by `perf-author@qaryati.test` and reviewed by `perf-editor@qaryati.test`.

`group_key` and `value_hash` come from the owning modules' own pure functions (`villageNameClaim`, `populationClaim`, `landmarkClaim`, ...), so the rows are exactly what the API writes: submitting one of the seeded population values again through the API answers 409 `DUPLICATE`. The projections equal their preferred claims (`test/seed/perf-seed.int-spec.ts` checks it). Ids are UUIDv5 of a fixed name, and every insert is `ON CONFLICT DO NOTHING`, so a second run inserts nothing. The run ends with `ANALYZE`, so the planner knows the real table sizes before a measurement, and prints the number of rows per table.

**Why it bypasses the API and the audit trail:** it is a fixture loader for load tests (800 villages, ~10 000 claims in about a second), not a user action; the issue asks for it explicitly. Nothing about it reaches production.

## Code and boundaries

`src/seed` is a development tool next to the composition root, not a module. Like `test/support`, the perf seed reads modules' pure domain functions and seed lists directly (`fact-claims.ts`, `governorates.ts`, ...), so the keys are computed by the code that owns them. dependency-cruiser's module rules apply to `src/modules/**` only; no module imports `src/seed`.

## Tests

- Unit: `production-guard.spec.ts`, `dev/seed-api-client.spec.ts` (429 + `Retry-After`, retry limit, problem details), `perf/perf-generator.spec.ts` (determinism, unique valid slugs, values inside the domain rules, seeded governorates and products).
- Integration: `test/seed/perf-seed.int-spec.ts`: rows per table, a second run inserts nothing, only verified preferred four-eyes claims, projections equal their claims.
- E2E: `test/seed/dev-seed.e2e-spec.ts`: the real app over HTTP, run twice (the second run changes nothing), published profile with sourced facts, audit entries by author and editor.
