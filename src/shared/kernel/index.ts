// Public surface of the shared kernel. Plain TypeScript only: domain code of
// every module may import it (docs/kernel.md, docs/architecture.md).
export { ErrorCode, FieldErrorCode, type FieldError } from './errors/error-codes';
export {
  BusinessRuleViolationError,
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
  PreconditionFailedError,
  ValidationError,
  type DomainErrorOptions,
} from './errors/domain-error';
export { CLOCK, FixedClock, SystemClock, type Clock } from './time/clock';
export { ID_GENERATOR, SequentialIdGenerator, asId, type Id, type IdGenerator } from './ids/id';
export {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  mapPage,
  pageOffset,
  toPage,
  type Page,
  type PageRequest,
  type Sort,
  type SortDirection,
} from './pagination/page';
export { INITIAL_VERSION, type Versioned } from './versioning/versioned';
export {
  DOMAIN_EVENT_PUBLISHER,
  type DomainEvent,
  type DomainEventPublisher,
} from './events/domain-event';
export { AUDIT_RECORDER, type AuditEntry, type AuditRecorder } from './audit/audit-recorder';
