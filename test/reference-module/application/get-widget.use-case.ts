// Reference: copy the read use case: no transaction for a single read, NotFoundError when missing.
import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError, type Id } from '../../../src/shared/kernel';
import type { Widget } from '../domain/widget';
import { WIDGET_REPOSITORY, type WidgetRepository } from '../domain/widget.repository';

/** Returns one widget or throws `NotFoundError` (404). */
@Injectable()
export class GetWidget {
  constructor(@Inject(WIDGET_REPOSITORY) private readonly widgets: WidgetRepository) {}

  async execute(id: Id<'Widget'>): Promise<Widget> {
    const widget = await this.widgets.findById(id);
    if (!widget) throw new NotFoundError(`Widget ${id} does not exist.`);
    return widget;
  }
}
