# Shared kernel

`src/shared` holds the small set of types and helpers that every module needs. It arrives in **#9**:

- error types and the ProblemDetails mapping
- pagination (`Page<T>`, size capped at 100)
- UUIDv7 ids and an injectable `Clock`
- transaction helpers and the after-commit event dispatcher
- domain event types
- the `AuditRecorder` port interface (implemented by the audit module)

## Rules

- `src/shared` must not import from `src/modules` or `src/platform` (dependency-cruiser rule `shared-is-independent`). The kernel sits below every module, so a dependency back up would create a cycle.
- No business rules of a single module live here. If only one module needs it, it belongs in that module.
- Domain code may import the framework-free parts of the kernel only, because `domain/` stays plain TypeScript.
