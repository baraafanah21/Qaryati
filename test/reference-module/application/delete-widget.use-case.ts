// Reference: copy the versioned soft delete: read for the audit `before`, delete with the expected version, audit.
import { Inject, Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import {
  AUDIT_RECORDER,
  NotFoundError,
  type AuditRecorder,
  type Id,
} from '../../../src/shared/kernel';
import { WIDGET_REPOSITORY, type WidgetRepository } from '../domain/widget.repository';

/** Soft-deletes a widget if the client still has the current version (If-Match). */
@Injectable()
export class DeleteWidget {
  constructor(
    @Inject(WIDGET_REPOSITORY) private readonly widgets: WidgetRepository,
    @Inject(AUDIT_RECORDER) private readonly audit: AuditRecorder,
  ) {}

  @Transactional()
  async execute(input: { id: Id<'Widget'>; expectedVersion: number }): Promise<void> {
    const current = await this.widgets.findById(input.id);
    if (!current) throw new NotFoundError(`Widget ${input.id} does not exist.`);
    await this.widgets.softDelete(input.id, input.expectedVersion);
    await this.audit.record({
      action: 'widget.deleted',
      entityType: 'Widget',
      entityId: input.id,
      before: current.snapshot(),
    });
  }
}
