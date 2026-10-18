import { TransactionHost } from '@nestjs-cls/transactional';
import type { AuditEntry, AuditRecorder } from '../../src/shared/kernel';

/** An entry as the in-memory recorder saw it. */
export interface RecordedAuditEntry extends AuditEntry {
  /** Whether a transaction was active when the use case recorded it (the port requires one). */
  inTransaction: boolean;
}

/**
 * `AuditRecorder` for tests: keeps entries in memory so a test can assert
 * that every write was audited, and can make the next `record` fail to prove
 * the change rolls back with it.
 *
 * ```ts
 * const audit = new InMemoryAuditRecorder();
 * Test.createTestingModule({ imports: [AppModule] })
 *   .overrideProvider(AUDIT_RECORDER).useValue(audit)
 * ```
 */
export class InMemoryAuditRecorder implements AuditRecorder {
  readonly entries: RecordedAuditEntry[] = [];
  private nextFailure: Error | undefined;

  /**
   * @param isInTransaction how to tell whether a transaction is active; by
   *   default the app's TransactionHost (so it must be used inside a Nest app).
   */
  constructor(
    private readonly isInTransaction: () => boolean = () =>
      TransactionHost.getInstance().isTransactionActive(),
  ) {}

  /** Makes the next `record` call reject with `error`, like a failed audit insert. */
  failNext(error = new Error('audit insert failed')): void {
    this.nextFailure = error;
  }

  /** Forgets every entry (call it in `beforeEach`). */
  clear(): void {
    this.entries.length = 0;
    this.nextFailure = undefined;
  }

  record(entry: AuditEntry): Promise<void> {
    const failure = this.nextFailure;
    if (failure) {
      this.nextFailure = undefined;
      return Promise.reject(failure);
    }
    this.entries.push({ ...entry, inTransaction: this.isInTransaction() });
    return Promise.resolve();
  }
}
