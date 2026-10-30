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
 * Persistence port of the widget aggregate. Writes run in the caller's
 * transaction, if any.
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
  /**
   * Deletes the widget for good if it is still at `expectedVersion` and
   * returns it as it was; same errors as `update`.
   */
  delete(id: Id<'Widget'>, expectedVersion: number): Promise<Widget>;
}

/** Injection token of the {@link WidgetRepository}. */
export const WIDGET_REPOSITORY = Symbol('WIDGET_REPOSITORY');
