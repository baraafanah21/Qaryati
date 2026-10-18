# Continuous integration

GitHub Actions runs [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) on every pull request and on every push to `main`. Its five jobs are **required status checks** on `main`: a pull request cannot be merged until all five pass on a branch that is up to date with `main`.

## Jobs

The jobs run in parallel on `ubuntu-24.04` with the Node version from `.nvmrc`. Each one can be reproduced locally with the commands in its row.

| Job (check name) | What it runs                                                                                                      | Reproduce locally                                                                                                        | Typical time |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------ |
| `quality`        | Prettier, ESLint, TypeScript, dependency-cruiser, `drizzle-kit check`, schema drift check                         | `npm run format:check && npm run lint && npm run typecheck && npm run depcruise && npm run db:check && npm run db:drift` | ~1 min       |
| `unit`           | Jest project `unit`                                                                                               | `npm run test:unit`                                                                                                      | < 1 min      |
| `integration`    | Jest projects `integration` and `e2e` against real PostGIS (Testcontainers on the runner's Docker)                | `npm run test:int && npm run test:e2e` (Docker running)                                                                  | 2–3 min      |
| `secrets`        | gitleaks over the full Git history                                                                                | see [secrets](#secrets) below                                                                                            | < 1 min      |
| `docker`         | Builds the image and starts the whole Compose stack from `.env.example`, then checks health and the database role | `cp .env.example .env && docker compose up -d --build --wait && curl localhost:3000/api/v1/health`                       | 2–3 min      |

### quality

- `db:check` (`drizzle-kit check`) catches an inconsistent migration history, for example two branches that both generated migration `0003`.
- **Schema drift** (`npm run db:drift`, [`scripts/check-schema-drift.sh`](../scripts/check-schema-drift.sh)) runs `drizzle-kit generate` and fails if that writes anything into `migrations/`. It catches a `schema.ts` change that was committed without its migration. Locally, a failure leaves the generated migration in place for you to review and commit. If drizzle-kit has a question (for example "was this column renamed?"), the script fails instead of waiting for input.
- Neither command connects to a database. The job sets a placeholder `DATABASE_OWNER_URL` because `drizzle.config.ts` validates it.

### integration

Testcontainers starts `postgis/postgis:16-3.5` with the real role init script and all migrations ([database.md](database.md#testing-against-the-database)). `test/extensions.int-spec.ts` is the sample that proves PostGIS and pg_trgm work in CI. It runs a distance search and a fuzzy Arabic name search through Drizzle's `sql` template, and checks that the GiST and GIN trigram indexes are used.

### secrets

The job downloads the gitleaks release binary, checks it against a pinned SHA-256 and scans every commit (`fetch-depth: 0`). It does not use `gitleaks-action`, which requires a licence key for organisation repositories and would add a third-party action. Findings are redacted in the log.

To run the same scan locally:

```bash
docker run --rm -v "$PWD:/repo" ghcr.io/gitleaks/gitleaks:v8.30.1 git /repo --redact --no-banner
```

If gitleaks finds a real secret, **rotate it first**: removing it from Git does not make it secret again. A false positive gets an entry in a `.gitleaksignore` file (the finding's fingerprint), added in its own reviewed PR.

### docker

Starts `db`, `redis`, `migrate` and `api` exactly as a teammate does, using the development values from `.env.example`. It fails if a service is unhealthy after 180 seconds, if `/api/v1/health` does not answer, or if the API did not log `Connected to PostgreSQL as qaryati_app`. On failure it prints every container's logs, and it always removes the stack and its volume.

## Workflow security

| Measure                                           | Why                                                                                                              |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `permissions: contents: read`                     | The token can only read the repository. No job pushes, comments or publishes.                                    |
| Actions pinned to a commit SHA                    | A tag like `v7` can be moved to other code. A SHA cannot. Dependabot updates the SHA and the `# v7.0.1` comment. |
| `persist-credentials: false` on checkout          | The token is not left in `.git/config` for later steps (npm scripts, tests) to read.                             |
| gitleaks binary checked against a SHA-256         | A changed or tampered download fails the job.                                                                    |
| `pull_request` trigger, not `pull_request_target` | Workflows from forks run without secrets or write access.                                                        |
| `timeout-minutes` on every job                    | A hung container or test cannot hold a runner for six hours.                                                     |

New pushes to a pull request cancel the run for the previous push (`concurrency`).

## Required checks on `main`

[`scripts/github-bootstrap.sh`](../scripts/github-bootstrap.sh) sets them in its `protection` step from `REQUIRED_CHECKS`:

```bash
scripts/github-bootstrap.sh --only protection --dry-run   # shows the payload
scripts/github-bootstrap.sh --only protection             # applies it
```

- Each check is bound to the GitHub Actions app (`app_id` 15368), so only a workflow run can satisfy it, not a commit status posted through the API by someone with write access.
- `strict: true`: the branch must be up to date with `main` ("Require branches to be up to date before merging"). The checks therefore ran against the code that will actually land. How to update a PR and why we chose this: [workflow.md](workflow.md#keeping-a-pr-up-to-date-with-main-update-branch).
- **Renaming or adding a job** means updating `REQUIRED_CHECKS` in the same PR and running the protection step after merge. Until then, a renamed check never reports, and every PR stays blocked waiting for it.

## Dependabot

[`.github/dependabot.yml`](../.github/dependabot.yml) checks for updates every Sunday. In every ecosystem, **minor and patch updates arrive together in one grouped PR**, and each major update gets its own PR, because a major needs reading the changelog. **At most 3 Dependabot PRs are open per ecosystem**, so updates never pile up faster than one review session clears them.

| Ecosystem        | Covers                                        | Majors                                             |
| ---------------- | --------------------------------------------- | -------------------------------------------------- |
| `npm`            | `package.json`                                | Own PR each, except the core packages below        |
| `github-actions` | the actions in `ci.yml` (SHA pins)            | Own PR each                                        |
| `docker`         | `node:24-slim` in the `Dockerfile`            | Ignored: a Node major is a planned upgrade         |
| `docker-compose` | `postgis` and `redis` in `docker-compose.yml` | Ignored: a PostgreSQL major needs a data migration |

**Ignored npm majors.** Dependabot opens no major PRs for `@types/node`, `typescript`, `@nestjs/*`, `drizzle-orm`, `drizzle-kit`, `jest`, `ts-jest`, `typescript-eslint` and `eslint`. A major of any of them changes how the whole codebase compiles, runs or is tested, so it is a planned upgrade with its own issue, not a weekly bump. Their minor and patch updates still arrive in the grouped PR.

**Why `@types/node` stays on 24.** The app runs on Node 24 (`.nvmrc`, `engines`, `node:24-slim`). `@types/node` describes the Node API for the compiler, and its major follows the Node major. With `@types/node` 25, TypeScript accepts calls to APIs that exist only in Node 25, so code compiles and then fails at runtime on Node 24. This happened in #74, which was reverted. `@types/node` moves to a new major only together with the Node runtime.

Dependabot PRs go through the same checks as any other PR. Only Baraa approves and merges them ([workflow.md](workflow.md#reviews-and-codeowners)), and a major update needs its own issue before it merges. Their titles are Conventional Commits (`chore(deps): …`, `ci(deps): …`). A PostGIS image update must also change `POSTGIS_IMAGE` in `test/support/test-database.ts`; the reviewer adds that commit to the PR.
