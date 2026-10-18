// Reference: copy the event declaration: a named DomainEvent type plus a factory, payload with plain values only.
import type { DomainEvent } from '../../../src/shared/kernel';
import type { Widget } from './widget';

/** Name listeners subscribe to: `@OnDomainEvent(WIDGET_CREATED)`. */
export const WIDGET_CREATED = 'widget.created';

/** A widget was created. Real modules export their event types from index.ts. */
export type WidgetCreated = DomainEvent<typeof WIDGET_CREATED, { name: string }>;

/** Builds the event for a stored widget. */
export function widgetCreated(widget: Widget, occurredAt: Date): WidgetCreated {
  return {
    name: WIDGET_CREATED,
    occurredAt,
    aggregateId: widget.id,
    payload: { name: widget.name },
  };
}
