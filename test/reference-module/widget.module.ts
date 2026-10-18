// Reference: copy the module file: forFeature with the module's own schema, the repository port bound to its adapter, use cases and controller.
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../src/platform/database/database.module';
import { CreateWidget } from './application/create-widget.use-case';
import { DeleteWidget } from './application/delete-widget.use-case';
import { GetWidget } from './application/get-widget.use-case';
import { ListWidgets } from './application/list-widgets.use-case';
import { UpdateWidget } from './application/update-widget.use-case';
import { WIDGET_REPOSITORY } from './domain/widget.repository';
import { DrizzleWidgetRepository } from './infrastructure/drizzle-widget.repository';
import * as schema from './infrastructure/persistence/schema';
import { WidgetController } from './web/widget.controller';

/**
 * The reference module. Test-only: AppModule does not import it, so it is
 * not in the API or in docs/api/openapi.json. Tests add it next to AppModule.
 */
@Module({
  imports: [DatabaseModule.forFeature(schema)],
  controllers: [WidgetController],
  providers: [
    CreateWidget,
    GetWidget,
    ListWidgets,
    UpdateWidget,
    DeleteWidget,
    { provide: WIDGET_REPOSITORY, useClass: DrizzleWidgetRepository },
  ],
})
export class WidgetModule {}
