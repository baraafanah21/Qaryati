import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ETag, IfMatch } from '../../../platform/http/etag';
import { ApiModule, ApiProblems } from '../../../platform/http/openapi';
import { idParam } from '../../../platform/http/pagination';
import { asId, mapPage, type Page } from '../../../shared/kernel';
import { CurrentUser, Public, Role, Roles, type AuthenticatedUser } from '../../iam';
import { ChangeVillagePublication } from '../application/change-village-publication.use-case';
import { CreateVillage } from '../application/create-village.use-case';
import { DeleteVillage } from '../application/delete-village.use-case';
import { GetVillage } from '../application/get-village.use-case';
import { SearchVillages } from '../application/search-villages.use-case';
import { UpdateVillage } from '../application/update-village.use-case';
import { toVillageResponse, toVillageSummary } from './village.mapper';
import {
  createVillageBody,
  idOrSlugParam,
  searchVillagesQuery,
  updateVillageBody,
  villageResponse,
  villageSummaryPage,
  type CreateVillageBody,
  type SearchVillagesQuery,
  type UpdateVillageBody,
  type VillageResponse,
  type VillageSummary,
} from './village.schemas';

/** `/api/v1/villages`: the village identity, its publication workflow and admin removal. */
@ApiModule('village')
@Controller('villages')
export class VillageController {
  constructor(
    private readonly createVillage: CreateVillage,
    private readonly getVillage: GetVillage,
    private readonly updateVillage: UpdateVillage,
    private readonly changePublication: ChangeVillagePublication,
    private readonly deleteVillage: DeleteVillage,
    private readonly searchVillages: SearchVillages,
  ) {}

  @Get()
  @Public({ optionalUser: true })
  @ApiOperation({
    summary: 'Search, filter, sort and page villages',
    description:
      'q is typo-tolerant (trigram similarity) over the Arabic and English display names and ' +
      'every published spelling of a name. Anonymous callers and contributors see published ' +
      'villages only; editors see every status and may filter by publicationStatus. ' +
      'Sort by nameAr, nameEn, createdAt or relevance (relevance needs q); the default is ' +
      'relevance,desc with q and nameAr,asc without.',
  })
  @ApiOkResponse({ standardSchema: villageSummaryPage })
  @ApiProblems(400, 422)
  async search(
    @Query({ schema: searchVillagesQuery }) query: SearchVillagesQuery,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ): Promise<Page<VillageSummary>> {
    const page = await this.searchVillages.execute({
      q: query.q,
      governorate: query.governorate,
      settlementStatus: query.settlementStatus,
      publicationStatus: query.publicationStatus,
      villageIds: query.ids,
      sort: query.sort,
      page: query.page,
      size: query.size,
      viewer: user,
    });
    return mapPage(page, toVillageSummary);
  }

  @Post()
  @Roles(Role.CONTRIBUTOR)
  @ETag()
  @ApiOperation({ summary: 'Create a village (as a draft)' })
  @ApiCreatedResponse({
    standardSchema: villageResponse,
    description: 'Created as DRAFT; Location points to it and ETag holds the version.',
  })
  @ApiProblems(400, 409, 422)
  async create(
    @Body({ schema: createVillageBody }) body: CreateVillageBody,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<VillageResponse> {
    const village = await this.createVillage.execute({ ...body, actor: user });
    response.setHeader('Location', `/api/v1/villages/${village.id}`);
    return toVillageResponse(village);
  }

  @Get(':idOrSlug')
  @Public({ optionalUser: true })
  @ETag()
  @ApiOperation({
    summary: 'Get a village by id or slug',
    description:
      'Anonymous callers see published villages only (other statuses answer 404). ' +
      'With a bearer token, drafts and archived villages are visible too.',
  })
  @ApiOkResponse({ standardSchema: villageResponse, description: 'ETag holds the version.' })
  @ApiProblems(400, 404)
  async get(
    @Param('idOrSlug', { schema: idOrSlugParam }) idOrSlug: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ): Promise<VillageResponse> {
    return toVillageResponse(await this.getVillage.execute(idOrSlug, user));
  }

  @Patch(':id')
  @Roles(Role.CONTRIBUTOR)
  @ETag()
  @ApiOperation({
    summary: 'Edit a village identity',
    description:
      'Editors, or the creator while the village is a draft. A display name is editable ' +
      'only until a CURRENT name claim in its language is published (422 after that).',
  })
  @ApiOkResponse({ standardSchema: villageResponse, description: 'ETag holds the new version.' })
  @ApiProblems(400, 403, 404, 412, 422, 428)
  async update(
    @Param('id', { schema: idParam }) id: string,
    @IfMatch() expectedVersion: number,
    @Body({ schema: updateVillageBody }) body: UpdateVillageBody,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<VillageResponse> {
    const village = await this.updateVillage.execute({
      id: asId<'Village'>(id),
      expectedVersion,
      changes: body,
      actor: user,
    });
    return toVillageResponse(village);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @Roles(Role.EDITOR)
  @ETag()
  @ApiOperation({ summary: 'Publish a draft or archived village' })
  @ApiOkResponse({ standardSchema: villageResponse, description: 'ETag holds the new version.' })
  @ApiProblems(400, 404, 412, 422, 428)
  async publish(
    @Param('id', { schema: idParam }) id: string,
    @IfMatch() expectedVersion: number,
  ): Promise<VillageResponse> {
    const village = await this.changePublication.execute({
      id: asId<'Village'>(id),
      expectedVersion,
      action: 'publish',
    });
    return toVillageResponse(village);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @Roles(Role.EDITOR)
  @ETag()
  @ApiOperation({ summary: 'Archive a published village (instead of deleting it)' })
  @ApiOkResponse({ standardSchema: villageResponse, description: 'ETag holds the new version.' })
  @ApiProblems(400, 404, 412, 422, 428)
  async archive(
    @Param('id', { schema: idParam }) id: string,
    @IfMatch() expectedVersion: number,
  ): Promise<VillageResponse> {
    const village = await this.changePublication.execute({
      id: asId<'Village'>(id),
      expectedVersion,
      action: 'archive',
    });
    return toVillageResponse(village);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Delete a village for good (admin only)',
    description: 'For spam or personal data. A village that still has claims answers 409.',
  })
  @ApiNoContentResponse({ description: 'Deleted.' })
  @ApiProblems(400, 404, 409, 412, 428)
  async remove(
    @Param('id', { schema: idParam }) id: string,
    @IfMatch() expectedVersion: number,
  ): Promise<void> {
    await this.deleteVillage.execute({ id: asId<'Village'>(id), expectedVersion });
  }
}
