# Technology stack

One entry per technology, library or tool. Each entry gives the version, its role in Qaryati, the reason we chose it (tied to a quality attribute), the alternatives we rejected and the cost we accepted.

**Status** is **In use** once the issue that adds it is merged, and **Planned (#n)** before that. Exact versions are pinned when the dependency is installed (`save-exact=true` in `.npmrc`), and the entry is updated in the same PR.

**Rule:** a PR that adds a dependency or tool adds or updates its entry here.

## Overview

| Area | Technology | Status |
| --- | --- | --- |
| Collaboration | GitHub, GitHub Projects, branch protection + CODEOWNERS, GitHub CLI + jq | In use |
| Runtime and language | Node.js 24 LTS, TypeScript (strict) | Planned (#2) |
| Framework and architecture | NestJS, hexagonal modules | Planned (#2) |
| Code quality | ESLint, Prettier, Husky, lint-staged, commitlint, dependency-cruiser | Planned (#2) |
| Testing | Jest, Supertest, Testcontainers | Planned (#2, #3) |
| Data | PostgreSQL 16, PostGIS, pg_trgm, citext, Drizzle ORM, drizzle-kit, node-postgres, two database roles | Planned (#3) |
| Cache and queues | Redis 7 | Planned (#3) |
| Configuration | zod, @nestjs/config | Planned (#3) |
| Containers | Docker Compose, node:24-slim, postgis/postgis:16-3.4, redis:7-alpine | Planned (#3) |
| CI and supply chain | GitHub Actions, gitleaks, Dependabot | Planned (#4) |

---

## Collaboration

### GitHub

- **Version:** github.com (hosted)
- **Status:** In use (#1)
- **Role:** hosts the repository, issues, pull requests, reviews and (from #4) CI.
- **Why:** code, plan, reviews and checks live in one place, so every contribution is traceable (Git process is 15% of the grade). *Maintainability, traceability.*
- **Alternatives:** GitLab: equivalent features, but the team already uses GitHub, and GitHub Actions and Projects are free here.
- **Cost:** private repositories on a free personal plan cannot use branch protection. The repository must be public, or the owner needs GitHub Pro (free with the Student Developer Pack).

### GitHub Projects

- **Version:** Projects (v2)
- **Status:** In use (#1)
- **Role:** the board "Qaryati" with Backlog, Ready, In progress, In review, Done; it holds every planned issue.
- **Why:** shows at a glance who works on what and what is blocked, next to the issues themselves. *Development speed, transparency.*
- **Alternatives:** Trello or Jira: a second tool to keep in sync with the issues by hand.
- **Cost:** someone must move cards; automation covers only "closed/merged → Done".

### Branch protection + CODEOWNERS

- **Version:** GitHub feature; configuration in `scripts/github-bootstrap.sh` and `.github/CODEOWNERS`
- **Status:** In use (#1)
- **Role:** enforces issue → PR → review → merge on `main`. Details in [workflow.md](workflow.md#branch-protection-on-main).
- **Why:** the process holds even when someone is in a hurry, and every member's contribution is traceable. *Security, maintainability.*
- **Alternatives:** trusting conventions: one direct push breaks traceability and nothing warns.
- **Cost:** the owner's own PRs need a second approver (Hamam), and admins cannot bypass the rules in an emergency.

### GitHub CLI (gh) + jq

- **Version:** gh 2.98.0, jq 1.7 (on the machine that runs the script)
- **Status:** In use (#1)
- **Role:** `scripts/github-bootstrap.sh` uses them to configure the repository: settings, labels, milestones, issues, project and protection.
- **Why:** the configuration is code. It can be reviewed in a PR, run again safely and audited later. *Maintainability, reproducibility.*
- **Alternatives:** clicking through the GitHub UI: not repeatable, with no record of what was set. Terraform's GitHub provider: a whole extra tool for a one-time setup.
- **Cost:** a Bash script to maintain. Project workflows ("Item closed → Done") cannot be set through the API and are checked by hand.

---

## Runtime and language

### Node.js 24 LTS

- **Status:** Planned (#2). Same major version in `.nvmrc`, `package.json` `engines`, the Dockerfile and CI.
- **Role:** runs the API, migrations and tests.
- **Why:** an LTS line has long security support, and one runtime for the whole team avoids version differences. *Security, maintainability.*
- **Alternatives:** odd-numbered "current" releases: short support windows.
- **Cost:** none significant.

### TypeScript (strict)

- **Status:** Planned (#2); #2 documents each strict flag we enable.
- **Role:** the language of all code.
- **Why:** types act as contracts between 5 developers and 9 modules, and errors surface at compile time instead of in production. *Maintainability, correctness.*
- **Alternatives:** plain JavaScript: errors only at runtime.
- **Cost:** slightly more typing up front.

---

## Framework and architecture

### NestJS

- **Status:** Planned (#2), Express adapter
- **Role:** HTTP layer, dependency injection, module system, guards and pipes.
- **Why:** its module system maps 1:1 to our modular monolith. Dependency injection makes ports, adapters and test doubles natural. Guards and pipes centralise authentication and validation. *Modularity, testability.*
- **Alternatives:** Express alone: each member would invent their own structure. Fastify alone: the same problem.
- **Cost:** more framework concepts and decorators to learn.

### Hexagonal modules (web / application / domain / infrastructure)

- **Status:** Planned (#2), see [architecture.md](architecture.md)
- **Role:** the internal structure of every business module.
- **Why:** business rules stay framework-free and run in milliseconds in unit tests. Infrastructure can change without touching the rules. The brief explicitly asks for this. *Modularity, testability.*
- **Alternatives:** a classic app layered by technical role: boundaries erode, and any service touches any table.
- **Cost:** more files and interfaces per feature.

---

## Code quality

### dependency-cruiser

- **Status:** Planned (#2)
- **Role:** checks import rules: no cycles, framework-free domain, layer direction, cross-module access only through `index.ts`, and an independent shared kernel.
- **Why:** turns module and layer boundaries into failing CI checks instead of review comments. *Modularity, maintainability.*
- **Alternatives:** code review only: violations slip through.
- **Cost:** the rules must be maintained as the structure evolves.

### ESLint + Prettier

- **Status:** Planned (#2)
- **Role:** ESLint catches bugs such as floating promises and misused promises. Prettier formats the code.
- **Why:** catches bugs early and removes formatting debates from reviews. *Correctness, development speed.*
- **Alternatives:** manual review.
- **Cost:** occasional rule friction.

### Husky + lint-staged + commitlint

- **Status:** Planned (#2)
- **Role:** Git hooks. Before a commit: lint and format the staged files. On the commit message: check Conventional Commits.
- **Why:** problems are fixed before they reach a commit, and consistent commit messages keep history readable, which is graded. *Maintainability.*
- **Alternatives:** CI only: slower feedback.
- **Cost:** a few seconds per commit.

---

## Testing

### Jest + Supertest

- **Status:** Planned (#2)
- **Role:** unit tests (Jest) and HTTP tests against the Nest app (Supertest).
- **Why:** the default NestJS test stack, with good mocking and HTTP testing. *Testability.*
- **Alternatives:** Vitest: fine, but has less NestJS documentation.
- **Cost:** slower than Vitest.

### Testcontainers

- **Status:** Planned (#3)
- **Role:** starts a real PostGIS container for integration tests.
- **Why:** the only way to test trigram, spatial and constraint behaviour honestly. *Correctness, testability.*
- **Alternatives:** SQLite or in-memory fakes: they cannot run PostGIS or pg_trgm, and they give false confidence.
- **Cost:** Docker is needed for tests, and they are slower than unit tests.

---

## Data

### PostgreSQL 16

- **Status:** Planned (#3)
- **Role:** the system of record.
- **Why:** a relational database is mandatory, and PostgreSQL has the strongest extension ecosystem for our needs (spatial, fuzzy text, case-insensitive text). *Correctness, performance.*
- **Alternatives:** MySQL: weaker spatial and fuzzy-text support.
- **Cost:** none significant.

### PostGIS

- **Status:** Planned (#3)
- **Role:** village coordinates as `geography(Point,4326)`, distance and "nearby villages" queries, GiST indexes.
- **Why:** spatial queries with spatial indexes. *Performance, correctness.*
- **Alternatives:** Haversine in application code: no index, slow and error-prone.
- **Cost:** an extension to install and learn.

### pg_trgm

- **Status:** Planned (#3)
- **Role:** fuzzy search across Arabic and English spellings (بيت فوريك / بيت فوريق) with a GIN trigram index.
- **Why:** typo-tolerant, indexed search inside the database. *Performance, usability.*
- **Alternatives:** `ILIKE '%x%'`: full scan, no typo tolerance. Elasticsearch: a whole extra system.
- **Cost:** index size, and the similarity threshold needs tuning.

### citext

- **Status:** Planned (#3)
- **Role:** case-insensitive text for user emails.
- **Why:** the database enforces case-insensitive unique emails. *Correctness, security.*
- **Alternatives:** `lower()` everywhere: easy to forget.
- **Cost:** needs a custom column type in Drizzle.

### Drizzle ORM + drizzle-kit + node-postgres (pg)

- **Status:** Planned (#3)
- **Role:** Drizzle defines schemas and queries in TypeScript. drizzle-kit generates and checks migrations. `pg` is the driver.
- **Why:** an SQL-transparent ORM. We see the exact SQL, which matters for the 20% performance study. Constraints, partial indexes and GIN/GiST indexes are declared in TypeScript and land in migrations. Native SQL composes inside normal queries through the `sql` template. Custom types for PostGIS are easy. *Performance, maintainability.*
- **Alternatives:** Prisma: friendlier for beginners, but hides SQL, has no PostGIS types, and partial indexes need hand-edited migrations. TypeORM: weaker result typing and a weaker maintenance history. Kysely: a query builder, and the brief requires an ORM.
- **Cost:** a steeper learning curve for SQL-shy members, and a smaller community than Prisma.

### Two database roles (owner and `qaryati_app`)

- **Status:** Planned (#3)
- **Role:** the owner role runs migrations. The app connects as `qaryati_app` with DML rights only.
- **Why:** least privilege. Even if compromised, the running app cannot change the schema or delete audit history. *Security.*
- **Alternatives:** one superuser connection: any bug or injection has full power.
- **Cost:** two connection strings to manage.

---

## Cache and queues

### Redis 7

- **Status:** Planned (#3)
- **Role:** shared cache, distributed rate limits, and later the BullMQ job queue.
- **Why:** one dependency covers all three, and it works with more than one API instance. *Performance, scalability.*
- **Alternatives:** an in-process cache: breaks with more than one instance.
- **Cost:** one more service to run.

---

## Configuration

### zod + @nestjs/config

- **Status:** Planned (#3)
- **Role:** load environment variables and validate them at startup.
- **Why:** the app refuses to start with a missing or malformed variable instead of failing later, and there is no hidden configuration (brief). *Correctness, security.*
- **Alternatives:** reading `process.env` ad hoc: silent misconfiguration.
- **Cost:** a schema to keep in sync with `.env.example`.

---

## Containers

### Docker Compose

- **Status:** Planned (#3)
- **Role:** starts the database, Redis, migrations and API locally with one command.
- **Why:** identical infrastructure for everyone, and Docker is mandatory in the brief. *Reproducibility.*
- **Alternatives:** local installs: "works on my machine" problems.
- **Cost:** Docker is required on every laptop.

### Base images: node:24-slim, postgis/postgis:16-3.4, redis:7-alpine

- **Status:** Planned (#3)
- **Role:** runtime image of the API, the database, the cache.
- **Why:** official, pinned and small. The slim image uses glibc, which avoids the native-module issues seen on Alpine for Node. *Reliability, security.*
- **Alternatives:** node:alpine: musl surprises with native modules.
- **Cost:** slightly larger than Alpine.

---

## CI and supply chain

### GitHub Actions

- **Status:** Planned (#4)
- **Role:** runs quality, unit, integration, secrets and Docker-build jobs on every PR.
- **Why:** every check runs on every PR, next to the code, and it is free for this use. *Correctness, maintainability.*
- **Alternatives:** local discipline only.
- **Cost:** CI minutes, and YAML to maintain.

### gitleaks

- **Status:** Planned (#4)
- **Role:** scans the full Git history for committed secrets.
- **Why:** blocks committed secrets, which the brief forbids. *Security.*
- **Alternatives:** manual review.
- **Cost:** occasional false positives to allow-list.

### Dependabot

- **Status:** Planned (#4)
- **Role:** weekly update PRs for npm, GitHub Actions and Docker images.
- **Why:** automatic dependency and security updates. *Security.*
- **Alternatives:** manual upgrades.
- **Cost:** PR noise, handled weekly.
