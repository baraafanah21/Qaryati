import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
} from '@nestjs/swagger';
import { ETag, IfMatch } from '../../../platform/http/etag';
import { ApiModule, ApiProblems } from '../../../platform/http/openapi';
import { idParam, pageResponse } from '../../../platform/http/pagination';
import { CurrentUser, Public, Role, Roles, type AuthenticatedUser } from '../../iam';
import {
  HeritageFactClaims,
  type HeritageFactChanges,
} from '../application/heritage-fact-claims.use-case';
import { ListHeritageFacts } from '../application/list-heritage-facts.use-case';
import { SubmitHeritageFact } from '../application/submit-heritage-fact.use-case';
import type { HeritageFactFilters, HeritageFactType } from '../domain/heritage-fact-types';
import type { HeritageFactInputs } from '../domain/prepare-heritage-fact';
import { toFactPage, toFactResponse } from './heritage.mapper';
import {
  createCulturalItemBody,
  createEventBody,
  createLandmarkBody,
  culturalItemResponse,
  eventResponse,
  historyResponse,
  landmarkResponse,
  listCulturalItemsQuery,
  listHeritageQuery,
  listLandmarksQuery,
  putHistoryBody,
  updateCulturalItemBody,
  updateEventBody,
  updateHistoryBody,
  updateLandmarkBody,
  type CreateCulturalItemBody,
  type CreateEventBody,
  type CreateLandmarkBody,
  type ListCulturalItemsQuery,
  type ListHeritageQuery,
  type ListLandmarksQuery,
  type PutHistoryBody,
  type UpdateCulturalItemBody,
  type UpdateEventBody,
  type UpdateHistoryBody,
  type UpdateLandmarkBody,
} from './heritage.schemas';

const LIST_DESCRIPTION =
  'Public: the published (preferred) claims only. `includeUnverified=true` adds every claim ' +
  'with its status for EDITOR+, and only your own claims for other logged-in users. ' +
  'Anonymous callers see published villages only.';
const SUBMIT_DESCRIPTION =
  'Any logged-in user. Submits an UNVERIFIED claim; editors verify and publish it through ' +
  '/claims/{id}/verify. 404 for an unknown village, 422 for a broken rule, 409 when the same ' +
  'value from the same source is already submitted.';
const EDIT_DESCRIPTION =
  'Only the author, only while UNVERIFIED (403 / 422). If-Match is the claim version. ' +
  'Absent fields keep their value.';
const WITHDRAW_DESCRIPTION =
  'The claim becomes WITHDRAWN and stays as history. Only the author, only while UNVERIFIED. ' +
  'If-Match is the claim version.';

type Provenance = {
  sourceId?: string | null;
  sourceLocator?: string | null;
  supersedesId?: string | null;
};

/**
 * `/api/v1/villages/{id}/history|events|landmarks|cultural-items`: the heritage
 * of a village (#24, #31), each item one claim of its type. Review (verify,
 * prefer, ...) is curation's `/claims/{id}/...`, not here.
 */
@ApiModule('heritage')
@Controller('villages')
export class HeritageController {
  constructor(
    private readonly submitFact: SubmitHeritageFact,
    private readonly listFacts: ListHeritageFacts,
    private readonly factClaims: HeritageFactClaims,
  ) {}

  // ---- history overview (#24) ----

  @Get(':id/history')
  @Public({ optionalUser: true })
  @ApiOperation({
    summary: 'Get the history overview of a village',
    description: `${LIST_DESCRIPTION} A village has at most one published overview.`,
  })
  @ApiOkResponse({ standardSchema: pageResponse(historyResponse) })
  @ApiProblems(400, 404)
  listHistory(
    @Param('id', { schema: idParam }) id: string,
    @Query({ schema: listHeritageQuery }) query: ListHeritageQuery,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.list(id, 'HISTORY_OVERVIEW', query, {}, user);
  }

  @Put(':id/history')
  @HttpCode(201)
  @Roles(Role.CONTRIBUTOR)
  @ETag()
  @ApiOperation({
    summary: 'Submit a history overview for a village',
    description:
      `${SUBMIT_DESCRIPTION} Each PUT submits a new HISTORY_OVERVIEW claim (summary up to ` +
      '10 000 characters); the published one changes only when an editor prefers it.',
  })
  @ApiCreatedResponse({ standardSchema: historyResponse, description: 'ETag: claim version.' })
  @ApiProblems(400, 401, 404, 409, 422)
  putHistory(
    @Param('id', { schema: idParam }) id: string,
    @Body({ schema: putHistoryBody }) body: PutHistoryBody,
  ) {
    return this.submit(id, 'HISTORY_OVERVIEW', body);
  }

  @Patch(':id/history/:claimId')
  @Roles(Role.CONTRIBUTOR)
  @ETag()
  @ApiOperation({
    summary: 'Edit your own unverified history overview',
    description: EDIT_DESCRIPTION,
  })
  @ApiOkResponse({ standardSchema: historyResponse, description: 'ETag: new claim version.' })
  @ApiProblems(400, 401, 403, 404, 409, 412, 422, 428)
  editHistory(
    @Param('id', { schema: idParam }) id: string,
    @Param('claimId', { schema: idParam }) claimId: string,
    @IfMatch() expectedVersion: number,
    @Body({ schema: updateHistoryBody }) body: UpdateHistoryBody,
  ) {
    return this.edit(id, 'HISTORY_OVERVIEW', claimId, expectedVersion, body);
  }

  @Delete(':id/history/:claimId')
  @HttpCode(204)
  @Roles(Role.CONTRIBUTOR)
  @ApiOperation({
    summary: 'Withdraw your own unverified history overview',
    description: WITHDRAW_DESCRIPTION,
  })
  @ApiNoContentResponse({ description: 'Withdrawn.' })
  @ApiProblems(400, 401, 403, 404, 412, 422, 428)
  async withdrawHistory(
    @Param('id', { schema: idParam }) id: string,
    @Param('claimId', { schema: idParam }) claimId: string,
    @IfMatch() expectedVersion: number,
  ): Promise<void> {
    await this.factClaims.withdraw({
      villageId: id,
      type: 'HISTORY_OVERVIEW',
      claimId,
      expectedVersion,
    });
  }

  // ---- historical events (#24) ----

  @Get(':id/events')
  @Public({ optionalUser: true })
  @ApiOperation({
    summary: 'List the historical events of a village, by start date',
    description: LIST_DESCRIPTION,
  })
  @ApiOkResponse({ standardSchema: pageResponse(eventResponse) })
  @ApiProblems(400, 404)
  listEvents(
    @Param('id', { schema: idParam }) id: string,
    @Query({ schema: listHeritageQuery }) query: ListHeritageQuery,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.list(id, 'HISTORICAL_EVENT', query, {}, user);
  }

  @Post(':id/events')
  @Roles(Role.CONTRIBUTOR)
  @ETag()
  @ApiOperation({
    summary: 'Submit a historical event',
    description:
      `${SUBMIT_DESCRIPTION} A source is required (422). Dates are YYYY-MM-DD, the first day ` +
      'of their period: YEAR 1948-01-01, MONTH 1948-05-01, DECADE 1930-01-01, CENTURY ' +
      '1800-01-01 (422 otherwise). The start is not in the future; the end is not before it.',
  })
  @ApiCreatedResponse({ standardSchema: eventResponse, description: 'ETag: claim version.' })
  @ApiProblems(400, 401, 404, 409, 422)
  createEvent(
    @Param('id', { schema: idParam }) id: string,
    @Body({ schema: createEventBody }) body: CreateEventBody,
  ) {
    return this.submit(id, 'HISTORICAL_EVENT', body);
  }

  @Patch(':id/events/:claimId')
  @Roles(Role.CONTRIBUTOR)
  @ETag()
  @ApiOperation({
    summary: 'Edit your own unverified historical event',
    description: EDIT_DESCRIPTION,
  })
  @ApiOkResponse({ standardSchema: eventResponse, description: 'ETag: new claim version.' })
  @ApiProblems(400, 401, 403, 404, 409, 412, 422, 428)
  editEvent(
    @Param('id', { schema: idParam }) id: string,
    @Param('claimId', { schema: idParam }) claimId: string,
    @IfMatch() expectedVersion: number,
    @Body({ schema: updateEventBody }) body: UpdateEventBody,
  ) {
    return this.edit(id, 'HISTORICAL_EVENT', claimId, expectedVersion, body);
  }

  @Delete(':id/events/:claimId')
  @HttpCode(204)
  @Roles(Role.CONTRIBUTOR)
  @ApiOperation({
    summary: 'Withdraw your own unverified historical event',
    description: WITHDRAW_DESCRIPTION,
  })
  @ApiNoContentResponse({ description: 'Withdrawn.' })
  @ApiProblems(400, 401, 403, 404, 412, 422, 428)
  async withdrawEvent(
    @Param('id', { schema: idParam }) id: string,
    @Param('claimId', { schema: idParam }) claimId: string,
    @IfMatch() expectedVersion: number,
  ): Promise<void> {
    await this.factClaims.withdraw({
      villageId: id,
      type: 'HISTORICAL_EVENT',
      claimId,
      expectedVersion,
    });
  }

  // ---- landmarks (#31) ----

  @Get(':id/landmarks')
  @Public({ optionalUser: true })
  @ApiOperation({
    summary: 'List the landmarks of a village, by name',
    description: `${LIST_DESCRIPTION} \`type\` filters by landmark type.`,
  })
  @ApiOkResponse({ standardSchema: pageResponse(landmarkResponse) })
  @ApiProblems(400, 404)
  listLandmarks(
    @Param('id', { schema: idParam }) id: string,
    @Query({ schema: listLandmarksQuery }) query: ListLandmarksQuery,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    const { type, ...page } = query;
    return this.list(id, 'LANDMARK', page, { landmarkType: type }, user);
  }

  @Post(':id/landmarks')
  @Roles(Role.CONTRIBUTOR)
  @ETag()
  @ApiOperation({
    summary: 'Submit a landmark',
    description:
      `${SUBMIT_DESCRIPTION} \`location\` is optional; latitude -90…90, longitude -180…180 ` +
      '(422), rounded to 5 decimals.',
  })
  @ApiCreatedResponse({ standardSchema: landmarkResponse, description: 'ETag: claim version.' })
  @ApiProblems(400, 401, 404, 409, 422)
  createLandmark(
    @Param('id', { schema: idParam }) id: string,
    @Body({ schema: createLandmarkBody }) body: CreateLandmarkBody,
  ) {
    return this.submit(id, 'LANDMARK', body);
  }

  @Patch(':id/landmarks/:claimId')
  @Roles(Role.CONTRIBUTOR)
  @ETag()
  @ApiOperation({ summary: 'Edit your own unverified landmark', description: EDIT_DESCRIPTION })
  @ApiOkResponse({ standardSchema: landmarkResponse, description: 'ETag: new claim version.' })
  @ApiProblems(400, 401, 403, 404, 409, 412, 422, 428)
  editLandmark(
    @Param('id', { schema: idParam }) id: string,
    @Param('claimId', { schema: idParam }) claimId: string,
    @IfMatch() expectedVersion: number,
    @Body({ schema: updateLandmarkBody }) body: UpdateLandmarkBody,
  ) {
    return this.edit(id, 'LANDMARK', claimId, expectedVersion, body);
  }

  @Delete(':id/landmarks/:claimId')
  @HttpCode(204)
  @Roles(Role.CONTRIBUTOR)
  @ApiOperation({
    summary: 'Withdraw your own unverified landmark',
    description: WITHDRAW_DESCRIPTION,
  })
  @ApiNoContentResponse({ description: 'Withdrawn.' })
  @ApiProblems(400, 401, 403, 404, 412, 422, 428)
  async withdrawLandmark(
    @Param('id', { schema: idParam }) id: string,
    @Param('claimId', { schema: idParam }) claimId: string,
    @IfMatch() expectedVersion: number,
  ): Promise<void> {
    await this.factClaims.withdraw({ villageId: id, type: 'LANDMARK', claimId, expectedVersion });
  }

  // ---- cultural items (#31) ----

  @Get(':id/cultural-items')
  @Public({ optionalUser: true })
  @ApiOperation({
    summary: 'List the cultural items of a village, by category and name',
    description: `${LIST_DESCRIPTION} \`category\` filters by category.`,
  })
  @ApiOkResponse({ standardSchema: pageResponse(culturalItemResponse) })
  @ApiProblems(400, 404)
  listCulturalItems(
    @Param('id', { schema: idParam }) id: string,
    @Query({ schema: listCulturalItemsQuery }) query: ListCulturalItemsQuery,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    const { category, ...page } = query;
    return this.list(id, 'CULTURAL_ITEM', page, { category }, user);
  }

  @Post(':id/cultural-items')
  @Roles(Role.CONTRIBUTOR)
  @ETag()
  @ApiOperation({ summary: 'Submit a cultural item', description: SUBMIT_DESCRIPTION })
  @ApiCreatedResponse({ standardSchema: culturalItemResponse, description: 'ETag: claim version.' })
  @ApiProblems(400, 401, 404, 409, 422)
  createCulturalItem(
    @Param('id', { schema: idParam }) id: string,
    @Body({ schema: createCulturalItemBody }) body: CreateCulturalItemBody,
  ) {
    return this.submit(id, 'CULTURAL_ITEM', body);
  }

  @Patch(':id/cultural-items/:claimId')
  @Roles(Role.CONTRIBUTOR)
  @ETag()
  @ApiOperation({
    summary: 'Edit your own unverified cultural item',
    description: EDIT_DESCRIPTION,
  })
  @ApiOkResponse({ standardSchema: culturalItemResponse, description: 'ETag: new claim version.' })
  @ApiProblems(400, 401, 403, 404, 409, 412, 422, 428)
  editCulturalItem(
    @Param('id', { schema: idParam }) id: string,
    @Param('claimId', { schema: idParam }) claimId: string,
    @IfMatch() expectedVersion: number,
    @Body({ schema: updateCulturalItemBody }) body: UpdateCulturalItemBody,
  ) {
    return this.edit(id, 'CULTURAL_ITEM', claimId, expectedVersion, body);
  }

  @Delete(':id/cultural-items/:claimId')
  @HttpCode(204)
  @Roles(Role.CONTRIBUTOR)
  @ApiOperation({
    summary: 'Withdraw your own unverified cultural item',
    description: WITHDRAW_DESCRIPTION,
  })
  @ApiNoContentResponse({ description: 'Withdrawn.' })
  @ApiProblems(400, 401, 403, 404, 412, 422, 428)
  async withdrawCulturalItem(
    @Param('id', { schema: idParam }) id: string,
    @Param('claimId', { schema: idParam }) claimId: string,
    @IfMatch() expectedVersion: number,
  ): Promise<void> {
    await this.factClaims.withdraw({
      villageId: id,
      type: 'CULTURAL_ITEM',
      claimId,
      expectedVersion,
    });
  }

  // ---- shared ----

  private async list<T extends HeritageFactType>(
    villageId: string,
    type: T,
    query: ListHeritageQuery,
    filter: HeritageFactFilters[T],
    user: AuthenticatedUser | undefined,
  ) {
    return toFactPage(await this.listFacts.execute({ villageId, type, filter, user, ...query }));
  }

  private async submit<T extends HeritageFactType>(
    villageId: string,
    type: T,
    body: HeritageFactInputs[T] & Provenance,
  ) {
    const { sourceId, sourceLocator, supersedesId, ...value } = body;
    return toFactResponse(
      await this.submitFact.execute({
        villageId,
        type,
        value: value as unknown as HeritageFactInputs[T],
        sourceId,
        sourceLocator,
        supersedesId,
      }),
    );
  }

  private async edit<T extends HeritageFactType>(
    villageId: string,
    type: T,
    claimId: string,
    expectedVersion: number,
    changes: HeritageFactChanges<T>,
  ) {
    return toFactResponse(
      await this.factClaims.edit({ villageId, type, claimId, expectedVersion, changes }),
    );
  }
}
