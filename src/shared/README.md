# Shared kernel

`src/shared/kernel` holds the small set of plain TypeScript types and helpers that every module needs, including its `domain/` code. Usage guide: [docs/kernel.md](../../docs/kernel.md).

- `errors/`: `DomainError` and its categories, the `ErrorCode` and `FieldErrorCode` catalogues ([docs/errors.md](../../docs/errors.md))
- `pagination/`: `Page<T>`, `PageRequest`, `Sort`, `toPage`, `pageOffset` (size capped at 100)
- `ids/`: `Id<Entity>`, the `IdGenerator` port and `ID_GENERATOR` token, `SequentialIdGenerator` for tests
- `time/`: the `Clock` port and `CLOCK` token, `SystemClock`, `FixedClock` for tests
- `versioning/`: `Versioned` (aggregates with an optimistic-lock `version`) and `INITIAL_VERSION`
- `events/`: `DomainEvent` and the `DomainEventPublisher` port with its `DOMAIN_EVENT_PUBLISHER` token
- `audit/`: `AuditEntry` and the `AuditRecorder` port with its `AUDIT_RECORDER` token (implemented by the audit module, #20)

The Nest side (exception filter, validation pipe, UUIDv7 generator, transactions, event delivery, logging) lives in `src/platform`.

## Rules

- `src/shared` must not import from `src/modules` or `src/platform` (dependency-cruiser rule `shared-is-independent`). The kernel sits below every module, so a dependency back up would create a cycle.
- No business rules of a single module live here. If only one module needs it, it belongs in that module.
- `src/shared/kernel` imports no npm package at all (rule `kernel-is-framework-free`), because `domain/` imports it and stays plain TypeScript. `domain/` may import nothing else from `src/shared` or `src/platform` (rule `domain-imports-only-kernel`).
