import { Body, Controller, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import type { Response } from 'express';

import { ETag, IfMatch } from '../../../platform/http/etag';
import { ApiModule, ApiProblems } from '../../../platform/http/openapi';
import { idParam } from '../../../platform/http/pagination';
import { asId, mapPage, type Page, UnauthenticatedError } from '../../../shared/kernel';

import { CurrentUser, Role, Roles, type AuthenticatedUser } from '../../iam';

import { CreateSource } from '../application/create-source.use-case';
import { GetSource } from '../application/get-source.use-case';
import { ListSources } from '../application/list-sources.use-case';
import { UpdateSource } from '../application/update-source.use-case';

import { toSourceResponse } from './source.mapper';

import {
  createSourceBody,
  listSourcesQuery,
  sourcePageResponse,
  sourceResponse,
  updateSourceBody,
  type CreateSourceBody,
  type ListSourcesQuery,
  type SourceResponse,
  type UpdateSourceBody,
} from './source.schemas';

/** REST endpoints for cited information sources. */
@ApiModule('curation')
@Roles(Role.CONTRIBUTOR)
@Controller('sources')
export class SourceController {
  constructor(
    private readonly createSource: CreateSource,
    private readonly getSource: GetSource,
    private readonly listSources: ListSources,
    private readonly updateSource: UpdateSource,
  ) {}

  @Post()
  @ETag()
  @ApiOperation({ summary: 'Create a source' })
  @ApiCreatedResponse({
    standardSchema: sourceResponse,
    description: 'Source created successfully with Location and version ETag headers.',
  })
  @ApiProblems(400, 401, 409, 422)
  async create(
    @Body({ schema: createSourceBody }) body: CreateSourceBody,
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SourceResponse> {
    if (!user) {
      throw new UnauthenticatedError('Authentication is required.');
    }

    const created = await this.createSource.execute({
      data: body,
      actorId: user.id,
    });

    response.setHeader('Location', `/api/v1/sources/${created.id}`);

    return toSourceResponse(created);
  }

  @Get()
  @ApiOperation({ summary: 'List sources' })
  @ApiOkResponse({
    standardSchema: sourcePageResponse,
  })
  @ApiProblems(400, 401)
  async list(
    @Query({ schema: listSourcesQuery }) query: ListSourcesQuery,
  ): Promise<Page<SourceResponse>> {
    return mapPage(await this.listSources.execute(query), toSourceResponse);
  }

  @Get(':id')
  @ETag()
  @ApiOperation({ summary: 'Get a source' })
  @ApiOkResponse({
    standardSchema: sourceResponse,
    description: 'Source details with version ETag.',
  })
  @ApiProblems(400, 401, 404)
  async get(@Param('id', { schema: idParam }) id: string): Promise<SourceResponse> {
    const found = await this.getSource.execute(asId<'Source'>(id));

    return toSourceResponse(found);
  }

  @Patch(':id')
  @ETag()
  @ApiOperation({ summary: 'Update a source' })
  @ApiOkResponse({
    standardSchema: sourceResponse,
    description: 'Source updated successfully.',
  })
  @ApiProblems(400, 401, 403, 404, 409, 412, 422, 428)
  async update(
    @Param('id', { schema: idParam }) id: string,
    @IfMatch() expectedVersion: number,
    @Body({ schema: updateSourceBody }) body: UpdateSourceBody,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ): Promise<SourceResponse> {
    if (!user) {
      throw new UnauthenticatedError('Authentication is required.');
    }

    const updated = await this.updateSource.execute({
      id: asId<'Source'>(id),
      expectedVersion,
      changes: body,
      actor: user,
    });

    return toSourceResponse(updated);
  }
}
