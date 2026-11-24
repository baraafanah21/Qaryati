import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
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
import { GetPopulationStats } from '../application/get-population-stats.use-case';
import { ListPopulationRecords } from '../application/list-population-records.use-case';
import { PopulationRecordClaims } from '../application/population-record-claims.use-case';
import { SubmitPopulationRecord } from '../application/submit-population-record.use-case';
import { toRecordPage, toWrittenResponse } from './population.mapper';
import {
  createPopulationBody,
  listPopulationQuery,
  populationRecordResponse,
  populationStatsResponse,
  updatePopulationBody,
  writtenPopulationRecordResponse,
  type CreatePopulationBody,
  type ListPopulationQuery,
  type PopulationStatsResponse,
  type UpdatePopulationBody,
} from './population.schemas';

/**
 * `/api/v1/villages/{id}/population`: population records (each one a
 * `POPULATION` claim) and their statistics (#28, #33). Review (verify,
 * prefer, ...) is curation's `/claims/{id}/...`, not here.
 */
@ApiModule('population')
@Controller('villages')
export class PopulationController {
  constructor(
    private readonly submitRecord: SubmitPopulationRecord,
    private readonly listRecords: ListPopulationRecords,
    private readonly recordClaims: PopulationRecordClaims,
    private readonly stats: GetPopulationStats,
  ) {}

  @Get(':id/population')
  @Public({ optionalUser: true })
  @ApiOperation({
    summary: 'List the population records of a village, by year',
    description:
      'Public: the published (preferred) records only. `includeUnverified=true` adds every ' +
      'claim with its status for EDITOR+, and only your own claims for other logged-in users. ' +
      'Anonymous callers see published villages only.',
  })
  @ApiOkResponse({ standardSchema: pageResponse(populationRecordResponse) })
  @ApiProblems(400, 404)
  async list(
    @Param('id', { schema: idParam }) id: string,
    @Query({ schema: listPopulationQuery }) query: ListPopulationQuery,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return toRecordPage(await this.listRecords.execute({ villageId: id, user, ...query }));
  }

  @Get(':id/population/stats')
  @Public({ optionalUser: true })
  @ApiOperation({
    summary: 'Population growth statistics of a village',
    description:
      'From the published records only, per count type: the previous year, the absolute and ' +
      'percentage change and the compounded average yearly growth (SQL `lag()`), plus the ' +
      'first, latest, smallest and largest record.',
  })
  @ApiOkResponse({ standardSchema: populationStatsResponse })
  @ApiProblems(400, 404)
  async getStats(
    @Param('id', { schema: idParam }) id: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ): Promise<PopulationStatsResponse> {
    return this.stats.execute(id, user);
  }

  @Post(':id/population')
  @Roles(Role.CONTRIBUTOR)
  @ETag()
  @ApiOperation({
    summary: 'Submit a population record',
    description:
      'Any logged-in user. Submits an UNVERIFIED claim; editors verify and publish it through ' +
      '/claims/{id}/verify. A source is required (422). The year cannot be in the future (422). ' +
      '409 when the same number from the same source is already submitted for this year and ' +
      'count type; a different number is accepted and listed in /curation/conflicts. ' +
      '`warnings` holds ANOMALY_SUSPECTED when the change against the nearest published record ' +
      'of the same count type averages more than 50% a year.',
  })
  @ApiCreatedResponse({
    standardSchema: writtenPopulationRecordResponse,
    description: 'ETag holds the claim version.',
  })
  @ApiProblems(400, 401, 404, 409, 422)
  async create(
    @Param('id', { schema: idParam }) id: string,
    @Body({ schema: createPopulationBody }) body: CreatePopulationBody,
  ) {
    return toWrittenResponse(await this.submitRecord.execute({ villageId: id, ...body }));
  }

  @Patch(':id/population/:claimId')
  @Roles(Role.CONTRIBUTOR)
  @ETag()
  @ApiOperation({
    summary: 'Edit your own unverified population record',
    description:
      'Only the author, only while UNVERIFIED (403 / 422). If-Match is the claim version.',
  })
  @ApiOkResponse({
    standardSchema: writtenPopulationRecordResponse,
    description: 'ETag holds the new claim version.',
  })
  @ApiProblems(400, 401, 403, 404, 409, 412, 422, 428)
  async update(
    @Param('id', { schema: idParam }) id: string,
    @Param('claimId', { schema: idParam }) claimId: string,
    @IfMatch() expectedVersion: number,
    @Body({ schema: updatePopulationBody }) body: UpdatePopulationBody,
  ) {
    return toWrittenResponse(
      await this.recordClaims.edit({ villageId: id, claimId, expectedVersion, changes: body }),
    );
  }

  @Delete(':id/population/:claimId')
  @HttpCode(204)
  @Roles(Role.CONTRIBUTOR)
  @ApiOperation({
    summary: 'Withdraw your own unverified population record',
    description:
      'The claim becomes WITHDRAWN and stays as history. Only the author, only while UNVERIFIED.',
  })
  @ApiNoContentResponse({ description: 'Withdrawn.' })
  @ApiProblems(400, 401, 403, 404, 412, 422, 428)
  async withdraw(
    @Param('id', { schema: idParam }) id: string,
    @Param('claimId', { schema: idParam }) claimId: string,
    @IfMatch() expectedVersion: number,
  ): Promise<void> {
    await this.recordClaims.withdraw({ villageId: id, claimId, expectedVersion });
  }
}
