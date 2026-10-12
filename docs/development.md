# Development

How to set up the project, what every script does, and how to run each kind of test.

## Prerequisites

| Tool    | Version               | Why                                                                                           |
| ------- | --------------------- | --------------------------------------------------------------------------------------------- |
| Node.js | 24 LTS (see `.nvmrc`) | The runtime of the API, the tooling and the tests. `package.json` `engines` allows only 24.x. |
| npm     | comes with Node 24    | Installs exact versions from `package-lock.json`.                                             |
| Git     | any recent            | Husky hooks run on commit.                                                                    |
| Docker  | any recent            | Needed from #3 (database, Redis, integration tests).                                          |

With [nvm](https://github.com/nvm-sh/nvm):

```bash
nvm install    # reads .nvmrc
nvm use
```

## Setup

```bash
git clone git@github.com:baraafanah21/Qaryati.git
cd Qaryati
nvm use
npm ci         # exact versions from package-lock.json; also installs the Git hooks (prepare → husky)
npm run start:dev
curl localhost:3000/api/v1/health   # {"status":"ok"}
```

`npm ci` runs the `prepare` script, which points Git at `.husky/` for hooks. If the hooks do not run on commit, run `npx husky` once.

## npm scripts

| Script         | What it does                                                                                                     | When to use it                      |
| -------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `start:dev`    | Starts the API with `nest start --watch`; restarts on file changes                                               | Daily development                   |
| `start:debug`  | Same, with the Node inspector open                                                                               | Debugging in the editor             |
| `start`        | Compiles and starts once                                                                                         | Quick manual check                  |
| `build`        | Compiles `src/` to `dist/` with `tsconfig.build.json` (tests excluded)                                           | Before `start:prod`; in Docker (#3) |
| `start:prod`   | Runs `dist/main.js` with source maps enabled                                                                     | Production-like run after `build`   |
| `typecheck`    | `tsc --noEmit` over `src/`, `test/` and root config files                                                        | Before pushing; in CI               |
| `lint`         | ESLint with type-aware rules over the repository                                                                 | Before pushing; in CI               |
| `lint:fix`     | ESLint with automatic fixes                                                                                      | After a lint failure                |
| `format`       | Prettier writes every supported file                                                                             | After a format failure              |
| `format:check` | Prettier checks every supported file, changes nothing                                                            | Before pushing; in CI               |
| `depcruise`    | dependency-cruiser checks module and layer boundaries in `src/` ([architecture.md](architecture.md#enforcement)) | Before pushing; in CI               |
| `test:unit`    | Jest project `unit`: `src/**/*.spec.ts`                                                                          | Constantly                          |
| `test:int`     | Jest project `integration`: `test/**/*.int-spec.ts` (real PostGIS from #3)                                       | Before pushing                      |
| `test:e2e`     | Jest project `e2e`: `test/**/*.e2e-spec.ts`, the app over HTTP                                                   | Before pushing                      |
| `test:cov`     | Unit tests with a coverage report in `coverage/`                                                                 | To find untested code               |
| `prepare`      | Installs the Husky Git hooks; npm runs it automatically after install                                            | Never by hand                       |

Before every push, run the same checks as CI:

```bash
npm run format:check && npm run lint && npm run typecheck && npm run depcruise && npm run test:unit && npm run test:int && npm run test:e2e
```

## Tests

| Type        | Location and name                         | What it may use                                                                                             | Speed        |
| ----------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------ |
| Unit        | Next to the code: `src/**/<name>.spec.ts` | Plain objects only. No Nest testing module, no database, no network.                                        | Milliseconds |
| Integration | `test/**/<name>.int-spec.ts`              | Real PostGIS (and Redis) in Docker via Testcontainers, from #3. Never mocks the database.                   | Seconds      |
| End-to-end  | `test/**/<name>.e2e-spec.ts`              | The full Nest app, configured with `configureApp()` exactly like `main.ts`, called over HTTP with Supertest | Seconds      |

Notes:

- `test:int` passes when there are no integration tests (`--passWithNoTests`). The first integration test arrives in #3, and the flag can be removed then.
- Tests run under `node --experimental-vm-modules`. NestJS 12 is published as ES modules, while this project compiles to CommonJS; the flag lets Jest load those packages. This is what the official Nest 12 project template does. The flag prints an `ExperimentalWarning` line, which is expected.
- Coverage counts real code only. Nest module classes (`*.module.ts`), `index.ts` files and `main.ts` are wiring and are excluded.

## Git hooks

| Hook         | Runs          | Effect                                                                                                                                                                    |
| ------------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pre-commit` | `lint-staged` | Staged `.ts/.js/.cjs/.mjs` files: `eslint --fix` then `prettier --write`. Staged `.json/.md/.yml`: `prettier --write`. The commit stops if ESLint still reports an error. |
| `commit-msg` | `commitlint`  | The message must be a Conventional Commit with an allowed scope (see [workflow.md](workflow.md#commits)).                                                                 |

The hooks give fast feedback; CI repeats every check (#4), so skipping a hook only delays the failure.

## Project layout

```
src/
  main.ts                 starts the app (port 3000 until #3 adds configuration)
  app.module.ts           composition root: imports every module
  platform/
    http/configure-app.ts global prefix /api, URI versioning (default v1), shutdown hooks
    health/               GET /api/v1/health → { "status": "ok" }; replaced by Terminus in #43
  shared/                 kernel, arrives in #9
  modules/<module>/       9 business modules, see architecture.md
    index.ts              public API
    <module>.module.ts    Nest module
    web/ application/ domain/ infrastructure/
    README.md             responsibility, data, API, dependencies
test/                     integration and e2e tests
```

## TypeScript settings

`tsconfig.json` uses `strict` plus the flags below. Each one turns a class of runtime bugs into compile errors:

| Flag                               | What it catches                                                                                                              |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `strict`                           | `null`/`undefined` misuse, implicit `any`, unsafe `this`, uninitialised class fields, unchecked `catch` variables            |
| `noUncheckedIndexedAccess`         | `rows[0]` and `map[key]` are typed as possibly `undefined`, so a missing row is handled, not assumed                         |
| `noImplicitOverride`               | A method that overrides a base method must say `override`, so renaming the base method cannot silently leave a dead override |
| `noImplicitReturns`                | Every path of a function with a return type returns a value                                                                  |
| `noFallthroughCasesInSwitch`       | A `case` cannot fall into the next one by accident                                                                           |
| `forceConsistentCasingInFileNames` | `import './Village'` vs `./village` fails on Linux CI. This flag catches it on case-insensitive laptops too.                 |

`emitDecoratorMetadata` and `experimentalDecorators` are required by NestJS dependency injection.
