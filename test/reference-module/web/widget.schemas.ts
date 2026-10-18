// Reference: copy the DTOs: zod strictObject requests, paginationQuery + sortQuery allow-list, a response schema with an id for Swagger.
import { z } from 'zod';
import { pageResponse, paginationQuery, sortQuery } from '../../../src/platform/http/pagination';

// Shape limits only; the domain owns the rule (trimmed length), so "   " passes here and gets a 422 there.
const name = z.string().min(1).max(80);

export const createWidgetBody = z.strictObject({ name });
export type CreateWidgetBody = z.infer<typeof createWidgetBody>;

export const updateWidgetBody = z.strictObject({ name });
export type UpdateWidgetBody = z.infer<typeof updateWidgetBody>;

export const listWidgetsQuery = paginationQuery.extend({
  sort: sortQuery(['name', 'createdAt'], [{ field: 'createdAt', direction: 'desc' }]),
});
export type ListWidgetsQuery = z.infer<typeof listWidgetsQuery>;

/** What the API returns for a widget. `version` is also sent as the ETag. */
export const widgetResponse = z
  .strictObject({
    id: z.uuid(),
    name: z.string(),
    version: z.int().min(1),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'WidgetResponse' });
export type WidgetResponse = z.infer<typeof widgetResponse>;

export const widgetPageResponse = pageResponse(widgetResponse).meta({ id: 'WidgetPage' });
