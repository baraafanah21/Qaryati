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
import {
  EconomyFactClaims,
  type EconomyFactChanges,
} from '../application/economy-fact-claims.use-case';
import { ListEconomyFacts } from '../application/list-economy-facts.use-case';
import { SubmitEconomyFact } from '../application/submit-economy-fact.use-case';
import type {
  EconomyFactFilters,
  EconomyFactInputs,
  EconomyFactType,
} from '../domain/economy-facts';
import { toFactPage, toFactResponse } from './economy.mapper';
import {
  createFacilityBody,
  createVillageProductBody,
  facilityResponse,
  listEconomyQuery,
  listFacilitiesQuery,
  updateFacilityBody,
  updateVillageProductBody,
  villageProductResponse,
  type CreateFacilityBody,
  type CreateVillageProductBody,
  type ListEconomyQuery,
  type ListFacilitiesQuery,
  type UpdateFacilityBody,
  type UpdateVillageProductBody,
} from './economy.schemas';

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
 * `/api/v1/villages/{id}/products|facilities`: what a village produces and its
 * community facilities (#36), each item one claim of its type. Review
 * (verify, prefer, ...) is curation's `/claims/{id}/...`, not here.
 */
@ApiModule('economy')
@Controller('villages')
export class EconomyController {
  constructor(
    private readonly submitFact: SubmitEconomyFact,
    private readonly listFacts: ListEconomyFacts,
    private readonly factClaims: EconomyFactClaims,
  ) {}

  // ---- products ----

  @Get(':id/products')
  @Public({ optionalUser: true })
  @ApiOperation({
    summary: "List a village's products, by English product name",
    description: LIST_DESCRIPTION,
  })
  @ApiOkResponse({ standardSchema: pageResponse(villageProductResponse) })
  @ApiProblems(400, 404)
  listVillageProducts(
    @Param('id', { schema: idParam }) id: string,
    @Query({ schema: listEconomyQuery }) query: ListEconomyQuery,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.list(id, 'VILLAGE_PRODUCT', query, {}, user);
  }

  @Post(':id/products')
  @Roles(Role.CONTRIBUTOR)
  @ETag()
  @ApiOperation({
    summary: 'Submit a product of a village',
    description:
      `${SUBMIT_DESCRIPTION} 404 for an unknown product (GET /products). One question per ` +
      'product and village: another significance from another source is a conflict, listed in ' +
      '/curation/conflicts.',
  })
  @ApiCreatedResponse({
    standardSchema: villageProductResponse,
    description: 'ETag: claim version.',
  })
  @ApiProblems(400, 401, 404, 409, 422)
  createVillageProduct(
    @Param('id', { schema: idParam }) id: string,
    @Body({ schema: createVillageProductBody }) body: CreateVillageProductBody,
  ) {
    return this.submit(id, 'VILLAGE_PRODUCT', body);
  }

  @Patch(':id/products/:claimId')
  @Roles(Role.CONTRIBUTOR)
  @ETag()
  @ApiOperation({
    summary: 'Edit your own unverified village product',
    description: EDIT_DESCRIPTION,
  })
  @ApiOkResponse({
    standardSchema: villageProductResponse,
    description: 'ETag: new claim version.',
  })
  @ApiProblems(400, 401, 403, 404, 409, 412, 422, 428)
  editVillageProduct(
    @Param('id', { schema: idParam }) id: string,
    @Param('claimId', { schema: idParam }) claimId: string,
    @IfMatch() expectedVersion: number,
    @Body({ schema: updateVillageProductBody }) body: UpdateVillageProductBody,
  ) {
    return this.edit(id, 'VILLAGE_PRODUCT', claimId, expectedVersion, body);
  }

  @Delete(':id/products/:claimId')
  @HttpCode(204)
  @Roles(Role.CONTRIBUTOR)
  @ApiOperation({
    summary: 'Withdraw your own unverified village product',
    description: WITHDRAW_DESCRIPTION,
  })
  @ApiNoContentResponse({ description: 'Withdrawn.' })
  @ApiProblems(400, 401, 403, 404, 412, 422, 428)
  async withdrawVillageProduct(
    @Param('id', { schema: idParam }) id: string,
    @Param('claimId', { schema: idParam }) claimId: string,
    @IfMatch() expectedVersion: number,
  ): Promise<void> {
    await this.factClaims.withdraw({
      villageId: id,
      type: 'VILLAGE_PRODUCT',
      claimId,
      expectedVersion,
    });
  }

  // ---- facilities ----

  @Get(':id/facilities')
  @Public({ optionalUser: true })
  @ApiOperation({
    summary: "List a village's facilities, by type and name",
    description: `${LIST_DESCRIPTION} \`type\` filters by facility type.`,
  })
  @ApiOkResponse({ standardSchema: pageResponse(facilityResponse) })
  @ApiProblems(400, 404)
  listFacilities(
    @Param('id', { schema: idParam }) id: string,
    @Query({ schema: listFacilitiesQuery }) query: ListFacilitiesQuery,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    const { type, ...page } = query;
    return this.list(id, 'FACILITY', page, { facilityType: type }, user);
  }

  @Post(':id/facilities')
  @Roles(Role.CONTRIBUTOR)
  @ETag()
  @ApiOperation({
    summary: 'Submit a facility of a village',
    description:
      `${SUBMIT_DESCRIPTION} \`location\` is optional; latitude -90…90, longitude -180…180, ` +
      'rounded to 5 decimals. `establishedYear` is optional, 1800 to the current year (422).',
  })
  @ApiCreatedResponse({ standardSchema: facilityResponse, description: 'ETag: claim version.' })
  @ApiProblems(400, 401, 404, 409, 422)
  createFacility(
    @Param('id', { schema: idParam }) id: string,
    @Body({ schema: createFacilityBody }) body: CreateFacilityBody,
  ) {
    return this.submit(id, 'FACILITY', body);
  }

  @Patch(':id/facilities/:claimId')
  @Roles(Role.CONTRIBUTOR)
  @ETag()
  @ApiOperation({ summary: 'Edit your own unverified facility', description: EDIT_DESCRIPTION })
  @ApiOkResponse({ standardSchema: facilityResponse, description: 'ETag: new claim version.' })
  @ApiProblems(400, 401, 403, 404, 409, 412, 422, 428)
  editFacility(
    @Param('id', { schema: idParam }) id: string,
    @Param('claimId', { schema: idParam }) claimId: string,
    @IfMatch() expectedVersion: number,
    @Body({ schema: updateFacilityBody }) body: UpdateFacilityBody,
  ) {
    return this.edit(id, 'FACILITY', claimId, expectedVersion, body);
  }

  @Delete(':id/facilities/:claimId')
  @HttpCode(204)
  @Roles(Role.CONTRIBUTOR)
  @ApiOperation({
    summary: 'Withdraw your own unverified facility',
    description: WITHDRAW_DESCRIPTION,
  })
  @ApiNoContentResponse({ description: 'Withdrawn.' })
  @ApiProblems(400, 401, 403, 404, 412, 422, 428)
  async withdrawFacility(
    @Param('id', { schema: idParam }) id: string,
    @Param('claimId', { schema: idParam }) claimId: string,
    @IfMatch() expectedVersion: number,
  ): Promise<void> {
    await this.factClaims.withdraw({ villageId: id, type: 'FACILITY', claimId, expectedVersion });
  }

  // ---- shared ----

  private async list<T extends EconomyFactType>(
    villageId: string,
    type: T,
    query: ListEconomyQuery,
    filter: EconomyFactFilters[T],
    user: AuthenticatedUser | undefined,
  ) {
    return toFactPage(await this.listFacts.execute({ villageId, type, filter, user, ...query }));
  }

  private async submit<T extends EconomyFactType>(
    villageId: string,
    type: T,
    body: EconomyFactInputs[T] & Provenance,
  ) {
    const { sourceId, sourceLocator, supersedesId, ...value } = body;
    return toFactResponse(
      await this.submitFact.execute({
        villageId,
        type,
        value: value as unknown as EconomyFactInputs[T],
        sourceId,
        sourceLocator,
        supersedesId,
      }),
    );
  }

  private async edit<T extends EconomyFactType>(
    villageId: string,
    type: T,
    claimId: string,
    expectedVersion: number,
    changes: EconomyFactChanges<T>,
  ) {
    return toFactResponse(
      await this.factClaims.edit({ villageId, type, claimId, expectedVersion, changes }),
    );
  }
}
