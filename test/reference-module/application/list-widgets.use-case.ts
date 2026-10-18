// Reference: copy the list use case: takes the validated page and sort, returns Page<aggregate>.
import { Inject, Injectable } from '@nestjs/common';
import type { Page } from '../../../src/shared/kernel';
import type { Widget } from '../domain/widget';
import {
  WIDGET_REPOSITORY,
  type WidgetListQuery,
  type WidgetRepository,
} from '../domain/widget.repository';

/** One page of widgets, sorted by the allow-listed keys. */
@Injectable()
export class ListWidgets {
  constructor(@Inject(WIDGET_REPOSITORY) private readonly widgets: WidgetRepository) {}

  execute(query: WidgetListQuery): Promise<Page<Widget>> {
    return this.widgets.list(query);
  }
}
