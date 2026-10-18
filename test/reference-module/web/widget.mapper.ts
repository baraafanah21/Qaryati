// Reference: copy the mapper: aggregate → response DTO in web/, so the domain never shapes JSON.
import type { Widget } from '../domain/widget';
import type { WidgetResponse } from './widget.schemas';

/** The response body for one widget. Dates become ISO strings here. */
export function toWidgetResponse(widget: Widget): WidgetResponse {
  return {
    id: widget.id,
    name: widget.name,
    version: widget.version,
    createdAt: widget.createdAt.toISOString(),
    updatedAt: widget.updatedAt.toISOString(),
  };
}
