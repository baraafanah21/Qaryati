/**
 * One change to record in the audit trail, as a use case describes it. Who
 * did it, in which request and when are not part of the entry: the recorder
 * fills `actorId`, `requestId` and `occurredAt` from the request context and
 * the `Clock`, so a use case cannot get them wrong.
 */
export interface AuditEntry {
  /** `<entity>.<pastTenseVerb>`, e.g. `village.published`, `claim.verified`. */
  action: string;
  /** The aggregate's type, e.g. `Village`. */
  entityType: string;
  /** The aggregate's id. */
  entityId: string;
  /** The village the change belongs to, when there is one; lets the audit API filter by village. */
  villageId?: string;
  /**
   * State before the change; omitted on create. Plain objects with only the
   * fields worth keeping, never password hashes or tokens.
   */
  before?: Record<string, unknown>;
  /** State after the change; omitted on delete. Same rules as `before`. */
  after?: Record<string, unknown>;
}

/**
 * Port every write use case calls to record what it changed. The audit
 * module (#20) implements it; modules depend only on this interface, never on
 * `audit` (docs/architecture.md, "How the backward calls are inverted").
 *
 * Contract for implementations:
 * - `record` writes **in the caller's active transaction**, so a failed audit
 *   insert rolls the change back and a rolled-back change leaves no entry.
 *   Calling it outside `@Transactional()` is a programming error and throws.
 * - It fills `actorId` and `requestId` from the request context and
 *   `occurredAt` from the `Clock`.
 */
export interface AuditRecorder {
  record(entry: AuditEntry): Promise<void>;
}

/** Injection token of the {@link AuditRecorder}. */
export const AUDIT_RECORDER = Symbol('AUDIT_RECORDER');
