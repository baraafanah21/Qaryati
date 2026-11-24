import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { ApiModule, ApiProblems } from '../../../platform/http/openapi';
import { idParam } from '../../../platform/http/pagination';
import { CurrentUser, Public, Role, Roles, type AuthenticatedUser } from '../../iam';
import {
  GetVillageCompleteness,
  type VillageCompleteness,
} from '../application/get-village-completeness.use-case';
import { GetVillageProfile } from '../application/get-village-profile.use-case';
import type { VillageProfile } from '../application/village-profile';
import { completenessResponse, idOrSlugParam, villageProfileResponse } from './profile.schemas';

/**
 * `/api/v1/villages/{idOrSlug}/profile` and `/{id}/completeness` (#39): a
 * read-only composition of what the other modules publish about one village.
 * `GET /villages/{idOrSlug}` stays the identity resource in the village module.
 */
@ApiModule('profile')
@Controller('villages')
export class ProfileController {
  constructor(
    private readonly getProfile: GetVillageProfile,
    private readonly getCompleteness: GetVillageCompleteness,
  ) {}

  @Get(':idOrSlug/profile')
  @Public({ optionalUser: true })
  @ApiOperation({
    summary: 'Get everything published about a village',
    description:
      'One document: identity, names, name origin, administrative affiliation, location, ' +
      'measures, relations, population (history and latest), history, events, landmarks, ' +
      'cultural items, products and facilities. Only published (preferred) claims; each fact ' +
      'carries its claimId, source (id, title, reliability) and verifiedAt. Anonymous callers ' +
      'see published villages only (other statuses answer 404); with a bearer token, drafts ' +
      'and archived villages too. A fixed number of queries, whatever the number of facts.',
  })
  @ApiOkResponse({ standardSchema: villageProfileResponse })
  @ApiProblems(400, 404)
  profile(
    @Param('idOrSlug', { schema: idOrSlugParam }) idOrSlug: string,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ): Promise<VillageProfile> {
    return this.getProfile.execute(idOrSlug, user);
  }

  @Get(':id/completeness')
  @Roles(Role.EDITOR)
  @ApiOperation({
    summary: 'Which kinds of fact a village still lacks',
    description:
      'EDITOR+. The claim types with no published (preferred) claim, and a 0–100 score: the ' +
      'share of claim types with one, rounded down (100 means nothing is missing). Counts ' +
      'drafts too, so editors see what a village needs before publishing.',
  })
  @ApiOkResponse({ standardSchema: completenessResponse })
  @ApiProblems(400, 404)
  completeness(@Param('id', { schema: idParam }) id: string): Promise<VillageCompleteness> {
    return this.getCompleteness.execute(id);
  }
}
