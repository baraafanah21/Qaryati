// Reference: copy the controller: @ApiModule, zod schemas on params, ETag/@IfMatch, @ApiProblems, thin handlers that call one use case and map the result.
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
} from '@nestjs/swagger';
import { ETag, IfMatch } from '../../../src/platform/http/etag';
import { ApiModule, ApiProblems } from '../../../src/platform/http/openapi';
import { idParam } from '../../../src/platform/http/pagination';
import { asId, mapPage, type Page } from '../../../src/shared/kernel';
import { CreateWidget } from '../application/create-widget.use-case';
import { DeleteWidget } from '../application/delete-widget.use-case';
import { GetWidget } from '../application/get-widget.use-case';
import { ListWidgets } from '../application/list-widgets.use-case';
import { UpdateWidget } from '../application/update-widget.use-case';
import { toWidgetResponse } from './widget.mapper';
import {
  createWidgetBody,
  listWidgetsQuery,
  updateWidgetBody,
  widgetPageResponse,
  widgetResponse,
  type CreateWidgetBody,
  type ListWidgetsQuery,
  type UpdateWidgetBody,
  type WidgetResponse,
} from './widget.schemas';

/** `/api/v1/widgets`: CRUD with optimistic locking. */
@ApiModule('widget')
@Controller('widgets')
export class WidgetController {
  constructor(
    private readonly createWidget: CreateWidget,
    private readonly getWidget: GetWidget,
    private readonly listWidgets: ListWidgets,
    private readonly updateWidget: UpdateWidget,
    private readonly deleteWidget: DeleteWidget,
  ) {}

  @Post()
  @ETag()
  @ApiOperation({ summary: 'Create a widget' })
  @ApiCreatedResponse({
    standardSchema: widgetResponse,
    description: 'Created; ETag holds the version.',
  })
  @ApiProblems(400, 409, 422)
  async create(
    @Body({ schema: createWidgetBody }) body: CreateWidgetBody,
  ): Promise<WidgetResponse> {
    return toWidgetResponse(await this.createWidget.execute(body));
  }

  @Get()
  @ApiOperation({ summary: 'List widgets' })
  @ApiOkResponse({ standardSchema: widgetPageResponse })
  @ApiProblems(400)
  async list(
    @Query({ schema: listWidgetsQuery }) query: ListWidgetsQuery,
  ): Promise<Page<WidgetResponse>> {
    return mapPage(await this.listWidgets.execute(query), toWidgetResponse);
  }

  @Get(':id')
  @ETag()
  @ApiOperation({ summary: 'Get a widget' })
  @ApiOkResponse({ standardSchema: widgetResponse, description: 'ETag holds the version.' })
  @ApiProblems(400, 404)
  async get(@Param('id', { schema: idParam }) id: string): Promise<WidgetResponse> {
    return toWidgetResponse(await this.getWidget.execute(asId<'Widget'>(id)));
  }

  @Patch(':id')
  @ETag()
  @ApiOperation({ summary: 'Rename a widget' })
  @ApiOkResponse({ standardSchema: widgetResponse, description: 'ETag holds the new version.' })
  @ApiProblems(400, 404, 409, 412, 422, 428)
  async update(
    @Param('id', { schema: idParam }) id: string,
    @IfMatch() expectedVersion: number,
    @Body({ schema: updateWidgetBody }) body: UpdateWidgetBody,
  ): Promise<WidgetResponse> {
    const widget = await this.updateWidget.execute({
      id: asId<'Widget'>(id),
      expectedVersion,
      name: body.name,
    });
    return toWidgetResponse(widget);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a widget' })
  @ApiNoContentResponse({ description: 'Deleted.' })
  @ApiProblems(400, 404, 412, 428)
  async remove(
    @Param('id', { schema: idParam }) id: string,
    @IfMatch() expectedVersion: number,
  ): Promise<void> {
    await this.deleteWidget.execute({ id: asId<'Widget'>(id), expectedVersion });
  }
}
