// Reference: copy the versioned update: read, apply the domain rule, store with the expected version, audit before and after.
import { Inject, Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import {
  AUDIT_RECORDER,
  NotFoundError,
  type AuditRecorder,
  type Id,
} from '../../../src/shared/kernel';
import type { Widget } from '../domain/widget';
import { WIDGET_REPOSITORY, type WidgetRepository } from '../domain/widget.repository';

/** Renames a widget if the client still has the current version (If-Match). */
@Injectable()
export class UpdateWidget {
  constructor(
    @Inject(WIDGET_REPOSITORY) private readonly widgets: WidgetRepository,
    @Inject(AUDIT_RECORDER) private readonly audit: AuditRecorder,
  ) {}

  @Transactional()
  async execute(input: {
    id: Id<'Widget'>;
    expectedVersion: number;
    name: string;
  }): Promise<Widget> {
    const current = await this.widgets.findById(input.id);
    if (!current) throw new NotFoundError(`Widget ${input.id} does not exist.`);
    // If the stored version is not the expected one, update() throws 412, so
    // `current` is exactly the state this change replaces: a correct `before`.
    const updated = await this.widgets.update(current.rename(input.name), input.expectedVersion);
    await this.audit.record({
      action: 'widget.renamed',
      entityType: 'Widget',
      entityId: updated.id,
      before: current.snapshot(),
      after: updated.snapshot(),
    });
    return updated;
  }
}
