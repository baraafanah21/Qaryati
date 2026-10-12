# Qaryati

Qaryati is an API-only backend for structured, sourced knowledge about Palestinian villages: names and identity, administrative affiliation, geography, population history, history and heritage, landmarks, economy and facilities. Every fact is stored as a claim with a source, an author and a verification status, so readers can see where a fact comes from and how far it has been checked. The system is a NestJS modular monolith on PostgreSQL with PostGIS, built by a five-person university team.

## Team

Each member adds their own row in their onboarding pull request (#5 to #8).

| Name  | GitHub                                           | Role                                      | Modules          |
| ----- | ------------------------------------------------ | ----------------------------------------- | ---------------- |
| Baraa | [@baraafanah21](https://github.com/baraafanah21) | Repository owner, reviewer, platform lead | platform, shared |

## Getting started

Prerequisites: **Node.js 24** (`nvm use` reads `.nvmrc`), Git and **Docker** with Compose v2.

```bash
nvm use
npm ci                 # exact dependency versions; also installs the Git hooks
cp .env.example .env   # local configuration
docker compose up -d --build --wait  # PostGIS, Redis, migrations, API
curl localhost:3000/api/v1/health    # {"status":"ok"}
```

Checks to run before every push (CI runs the same):

```bash
npm run format:check && npm run lint && npm run typecheck && npm run depcruise
npm run test:unit && npm run test:int && npm run test:e2e
```

Hot reload on the host, every script and test type: [docs/development.md](docs/development.md). Integration and e2e tests need Docker running.

## Documentation

- [Project context and rules](CONTEXT.md)
- [Documentation index](docs/README.md)
- [Development: setup, Docker, scripts, tests](docs/development.md)
- [Configuration: environment variables](docs/configuration.md)
- [Database: roles, migrations, Drizzle](docs/database.md)
- [Architecture](docs/architecture.md)
- [Git workflow](docs/workflow.md)
- [Technology stack and reasons](docs/tech-stack.md)
