// Reference: copy the versioned hard delete: delete with the expected version, audit the deleted row as `before`.
import { Inject, Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { AUDIT_RECORDER, type AuditRecorder, type Id } from '../../../src/shared/kernel';
import { WIDGET_REPOSITORY, type WidgetRepository } from '../domain/widget.repository';

/** Deletes a widget if the client still has the current version (If-Match). */
@Injectable()
export class DeleteWidget {
  constructor(
    @Inject(WIDGET_REPOSITORY) private readonly widgets: WidgetRepository,
    @Inject(AUDIT_RECORDER) private readonly audit: AuditRecorder,
  ) {}

  @Transactional()
  async execute(input: { id: Id<'Widget'>; expectedVersion: number }): Promise<void> {
    // 404 for an unknown id, 412 for a stale version; nothing is deleted then.
    const deleted = await this.widgets.delete(input.id, input.expectedVersion);
    await this.audit.record({
      action: 'widget.deleted',
      entityType: 'Widget',
      entityId: input.id,
      before: deleted.snapshot(),
    });
  }
}
