// Reference: copy the repository port: an interface plus token in domain/, speaking in aggregates, implemented in infrastructure/.
import type { Id, Page, PageRequest, Sort } from '../../../src/shared/kernel';
import type { Widget } from './widget';

/** Fields a widget list can be sorted by; each has an index. */
export type WidgetSortField = 'name' | 'createdAt';

/** A validated list request: page, size and sort keys from the allow-list. */
export interface WidgetListQuery extends PageRequest {
  sort: Sort<WidgetSortField>[];
}

/**
 * Persistence port of the widget aggregate. Soft-deleted widgets do not
 * exist for any method. Writes run in the caller's transaction, if any.
 */
export interface WidgetRepository {
  /** Stores a new widget and returns it as stored. */
  insert(widget: Widget): Promise<Widget>;
  findById(id: Id<'Widget'>): Promise<Widget | undefined>;
  list(query: WidgetListQuery): Promise<Page<Widget>>;
  /**
   * Stores `widget` if it is still at `expectedVersion` and returns it with
   * its new version. Throws `NotFoundError` or `PreconditionFailedError`.
   */
  update(widget: Widget, expectedVersion: number): Promise<Widget>;
  /** Soft-deletes the widget if it is still at `expectedVersion`; same errors as `update`. */
  softDelete(id: Id<'Widget'>, expectedVersion: number): Promise<void>;
}

/** Injection token of the {@link WidgetRepository}. */
export const WIDGET_REPOSITORY = Symbol('WIDGET_REPOSITORY');
