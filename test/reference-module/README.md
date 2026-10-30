# Reference module (`Widget`)

A complete, small module that uses every kernel and platform helper: copy it file by file when you build a feature. The walkthrough is in [docs/kernel.md, "Build a new endpoint in 10 steps"](../../docs/kernel.md#build-a-new-endpoint-in-10-steps). Each file starts with a one-line comment saying what a real module should copy from it.

It is **test-only**:

- its table is created by the tests (`infrastructure/persistence/widget-table.ts`), not by a migration; a real module runs `npm run db:generate`;
- AppModule does not import `WidgetModule`, so it is not in the running API or in `docs/api/openapi.json`;
- dependency-cruiser and ESLint check it like a module under `src/modules` (layer rules, no `new Date()` in domain/application), and it may not import any real module.

| Folder               | Shows                                                                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain/`            | `Widget` with one invariant (name 1–80 characters), the repository port, the `widget.created` event, a unit test                                               |
| `application/`       | create, get, list, update, delete (a real, audited `DELETE`); every write `@Transactional()` and audited; create publishes `WidgetCreated`                     |
| `infrastructure/`    | Drizzle schema with `versionColumns()`, the repository adapter on the module handle, `updateWithVersion`/`deleteWithVersion`, native SQL, its integration test |
| `web/`               | zod DTOs, pagination with a sort allow-list, `@ETag()`/`@IfMatch()`, `@ApiModule`/`@ApiProblems`, the mapper to the response                                   |
| `widget.e2e-spec.ts` | every status code of every endpoint, audit and events over HTTP, and the generated OpenAPI document                                                            |
