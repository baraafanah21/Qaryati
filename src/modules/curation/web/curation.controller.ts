import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation } from '@nestjs/swagger';

import { ApiModule, ApiProblems } from '../../../platform/http/openapi';
import { mapPage, type Page } from '../../../shared/kernel';

import { Role, Roles } from '../../iam';

import { ListConflicts } from '../application/list-conflicts.use-case';
import { ListReviewQueue } from '../application/list-review-queue.use-case';

import { toClaimConflictResponse, toClaimResponse } from './claim.mapper';
import {
  claimConflictPageResponse,
  claimPageResponse,
  conflictsQuery,
  reviewQueueQuery,
  type ClaimConflictResponse,
  type ClaimResponse,
  type ConflictsQueryParams,
  type ReviewQueueQueryParams,
} from './claim.schemas';

/** The editors' inbox: claims waiting for review and questions whose sources disagree. */
@ApiModule('curation')
@Roles(Role.EDITOR)
@Controller('curation')
export class CurationController {
  constructor(
    private readonly queue: ListReviewQueue,
    private readonly conflictList: ListConflicts,
  ) {}

  @Get('queue')
  @ApiOperation({
    summary: 'List claims waiting for review',
    description: 'Unverified (default) or disputed claims, oldest first.',
  })
  @ApiOkResponse({ standardSchema: claimPageResponse })
  @ApiProblems(400, 401, 403)
  async reviewQueue(
    @Query({ schema: reviewQueueQuery }) query: ReviewQueueQueryParams,
  ): Promise<Page<ClaimResponse>> {
    return mapPage(await this.queue.execute(query), toClaimResponse);
  }

  @Get('conflicts')
  @ApiOperation({
    summary: 'List questions whose live claims disagree',
    description:
      'Computed on every request, never stored. Resolve one by verifying or preferring a claim ' +
      'and rejecting or disputing the others, each with a note.',
  })
  @ApiOkResponse({ standardSchema: claimConflictPageResponse })
  @ApiProblems(400, 401, 403)
  async conflicts(
    @Query({ schema: conflictsQuery }) query: ConflictsQueryParams,
  ): Promise<Page<ClaimConflictResponse>> {
    return mapPage(await this.conflictList.execute(query), toClaimConflictResponse);
  }
}
