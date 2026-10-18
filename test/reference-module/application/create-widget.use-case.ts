// Reference: copy the write use case: @Transactional(), ids and time from the kernel ports, repository port, audit entry, event after commit.
import { Inject, Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import {
  AUDIT_RECORDER,
  CLOCK,
  DOMAIN_EVENT_PUBLISHER,
  ID_GENERATOR,
  type AuditRecorder,
  type Clock,
  type DomainEventPublisher,
  type IdGenerator,
} from '../../../src/shared/kernel';
import { Widget } from '../domain/widget';
import { widgetCreated } from '../domain/widget-events';
import { WIDGET_REPOSITORY, type WidgetRepository } from '../domain/widget.repository';

/** Creates a widget. One transaction: the insert, its audit entry, and the event queued for commit. */
@Injectable()
export class CreateWidget {
  constructor(
    @Inject(WIDGET_REPOSITORY) private readonly widgets: WidgetRepository,
    @Inject(AUDIT_RECORDER) private readonly audit: AuditRecorder,
    @Inject(DOMAIN_EVENT_PUBLISHER) private readonly events: DomainEventPublisher,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
  ) {}

  @Transactional()
  async execute(input: { name: string }): Promise<Widget> {
    const now = this.clock.now();
    const widget = await this.widgets.insert(
      Widget.create({ id: this.ids.next<'Widget'>(), name: input.name, now }),
    );
    await this.audit.record({
      action: 'widget.created',
      entityType: 'Widget',
      entityId: widget.id,
      after: widget.snapshot(),
    });
    // Delivered only after COMMIT; dropped if anything above fails.
    await this.events.publish(widgetCreated(widget, now));
    return widget;
  }
}
