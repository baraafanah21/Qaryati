import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation } from '@nestjs/swagger';

import { ETag, IfMatch } from '../../../platform/http/etag';
import { ApiModule, ApiProblems } from '../../../platform/http/openapi';
import { idParam } from '../../../platform/http/pagination';
import { asId, UnauthenticatedError } from '../../../shared/kernel';

import { CurrentUser, Role, Roles, type AuthenticatedUser } from '../../iam';

import { GetClaim } from '../application/get-claim.use-case';
import { ReviewClaim } from '../application/review-claim.use-case';
import type { ReviewAction } from '../domain/claim-preference';

import { toClaimResponse } from './claim.mapper';
import {
  claimResponse,
  reviewClaimBody,
  type ClaimResponse,
  type ReviewClaimBody,
} from './claim.schemas';

/**
 * Review endpoints shared by every claim type (ADR-003). Editors and admins
 * only; every action needs `If-Match` with the claim's current version.
 */
@ApiModule('curation')
@Roles(Role.EDITOR)
@Controller('claims')
export class ClaimController {
  constructor(
    private readonly claims: GetClaim,
    private readonly reviews: ReviewClaim,
  ) {}

  @Get(':id')
  @ETag()
  @ApiOperation({ summary: 'Get a claim and its review state' })
  @ApiOkResponse({ standardSchema: claimResponse, description: 'Claim with version ETag.' })
  @ApiProblems(400, 401, 403, 404)
  async getClaim(@Param('id', { schema: idParam }) id: string): Promise<ClaimResponse> {
    return toClaimResponse(await this.claims.execute(asId<'Claim'>(id)));
  }

  @Post(':id/verify')
  @HttpCode(200)
  @ETag()
  @ApiOperation({
    summary: 'Verify a claim',
    description:
      'Needs a source; the author cannot verify their own claim (403 SELF_VERIFICATION_FORBIDDEN). ' +
      'The first verified claim of a question becomes preferred.',
  })
  @ApiOkResponse({ standardSchema: claimResponse, description: 'ETag holds the new version.' })
  @ApiProblems(400, 401, 403, 404, 409, 412, 422, 428)
  verifyClaim(
    @Param('id', { schema: idParam }) id: string,
    @IfMatch() expectedVersion: number,
    @Body({ schema: reviewClaimBody }) body: ReviewClaimBody,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ): Promise<ClaimResponse> {
    return this.review('VERIFY', id, expectedVersion, body, user);
  }

  @Post(':id/dispute')
  @HttpCode(200)
  @ETag()
  @ApiOperation({
    summary: 'Dispute a claim',
    description: 'Needs a note. A disputed preferred claim loses the preferred flag.',
  })
  @ApiOkResponse({ standardSchema: claimResponse, description: 'ETag holds the new version.' })
  @ApiProblems(400, 401, 403, 404, 412, 422, 428)
  disputeClaim(
    @Param('id', { schema: idParam }) id: string,
    @IfMatch() expectedVersion: number,
    @Body({ schema: reviewClaimBody }) body: ReviewClaimBody,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ): Promise<ClaimResponse> {
    return this.review('DISPUTE', id, expectedVersion, body, user);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @ETag()
  @ApiOperation({
    summary: 'Reject a claim',
    description: 'Needs a note. A rejected preferred claim loses the preferred flag.',
  })
  @ApiOkResponse({ standardSchema: claimResponse, description: 'ETag holds the new version.' })
  @ApiProblems(400, 401, 403, 404, 412, 422, 428)
  rejectClaim(
    @Param('id', { schema: idParam }) id: string,
    @IfMatch() expectedVersion: number,
    @Body({ schema: reviewClaimBody }) body: ReviewClaimBody,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ): Promise<ClaimResponse> {
    return this.review('REJECT', id, expectedVersion, body, user);
  }

  @Post(':id/prefer')
  @HttpCode(200)
  @ETag()
  @ApiOperation({
    summary: 'Make a verified claim the published answer of its question',
    description:
      'Moves the preferred flag from the old preferred claim in one transaction. ' +
      'Two editors preferring different claims at once: one wins, the other gets 409.',
  })
  @ApiOkResponse({ standardSchema: claimResponse, description: 'ETag holds the new version.' })
  @ApiProblems(400, 401, 403, 404, 409, 412, 422, 428)
  preferClaim(
    @Param('id', { schema: idParam }) id: string,
    @IfMatch() expectedVersion: number,
    @Body({ schema: reviewClaimBody }) body: ReviewClaimBody,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ): Promise<ClaimResponse> {
    return this.review('PREFER', id, expectedVersion, body, user);
  }

  private async review(
    action: ReviewAction,
    id: string,
    expectedVersion: number,
    body: ReviewClaimBody,
    user: AuthenticatedUser | undefined,
  ): Promise<ClaimResponse> {
    if (!user) {
      throw new UnauthenticatedError('Authentication is required.');
    }

    const claim = await this.reviews.execute({
      id: asId<'Claim'>(id),
      expectedVersion,
      action,
      reviewerId: user.id,
      note: body?.note ?? null,
    });

    return toClaimResponse(claim);
  }
}
