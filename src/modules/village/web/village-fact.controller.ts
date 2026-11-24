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
import type { Page } from '../../../shared/kernel';
import { CurrentUser, Public, Role, Roles, type AuthenticatedUser } from '../../iam';
import { FindNearbyVillages } from '../application/find-nearby-villages.use-case';
import { ListVillageFacts } from '../application/list-village-facts.use-case';
import { SubmitVillageFact } from '../application/submit-village-fact.use-case';
import { VillageNameClaims } from '../application/village-name-claims.use-case';
import type { VillageFactInputs } from '../application/village-fact-input';
import type { VillageFactType } from '../domain/village-fact.repository';
import { toFactPage, toFactResponse, type VillageFactResponse } from './village-fact.mapper';
import {
  affiliationResponse,
  createAffiliationBody,
  createMeasureBody,
  createNameOriginBody,
  createRelationBody,
  createVillageNameBody,
  listFactsQuery,
  locationResponse,
  measureResponse,
  nameOriginResponse,
  nearbyQuery,
  nearbyVillagesResponse,
  putLocationBody,
  relationResponse,
  updateVillageNameBody,
  villageNameResponse,
  type CreateAffiliationBody,
  type CreateMeasureBody,
  type CreateNameOriginBody,
  type CreateRelationBody,
  type CreateVillageNameBody,
  type ListFactsQuery,
  type NearbyQuery,
  type NearbyVillagesResponse,
  type PutLocationBody,
  type UpdateVillageNameBody,
} from './village-fact.schemas';

const SUBMIT_DESCRIPTION =
  'Any logged-in user. Submits an UNVERIFIED claim; editors verify and publish it through ' +
  '/claims/{id}/verify. 409 when the same value from the same source is already submitted.';
const LIST_DESCRIPTION =
  'Public: the published (preferred) claims only. `includeUnverified=true` (EDITOR+) adds ' +
  'every other claim with its status. Anonymous callers see published villages only.';

type ProvenanceBody = {
  sourceId?: string | null;
  sourceLocator?: string | null;
  supersedesId?: string | null;
};

/** Splits a submit body into its provenance and its value. */
function split<B extends ProvenanceBody>(body: B) {
  const { sourceId, sourceLocator, supersedesId, ...value } = body;
  return { provenance: { sourceId, sourceLocator, supersedesId }, value };
}

/**
 * `/api/v1/villages/{id}/...`: the facts of a village (each one a claim) and
 * the nearby search. Review (verify, prefer, ...) is curation's, not here.
 */
@ApiModule('village')
@Controller('villages')
export class VillageFactController {
  constructor(
    private readonly submitFact: SubmitVillageFact,
    private readonly listFacts: ListVillageFacts,
    private readonly names: VillageNameClaims,
    private readonly nearbyVillages: FindNearbyVillages,
  ) {}

  private async submit<T extends VillageFactType, B extends ProvenanceBody>(
    villageId: string,
    type: T,
    body: B,
  ): Promise<VillageFactResponse<T>> {
    const { provenance, value } = split(body);
    const fact = await this.submitFact.execute({
      villageId,
      type,
      value: value as unknown as VillageFactInputs[T],
      ...provenance,
    });
    return toFactResponse(fact);
  }

  private async list<T extends VillageFactType>(
    villageId: string,
    type: T,
    query: ListFactsQuery,
    user: AuthenticatedUser | undefined,
  ): Promise<Page<VillageFactResponse<T>>> {
    return toFactPage(await this.listFacts.execute({ villageId, type, user, ...query }));
  }

  // ---- names (#27) ----

  @Get(':id/names')
  @Public({ optionalUser: true })
  @ApiOperation({ summary: 'List the names of a village', description: LIST_DESCRIPTION })
  @ApiOkResponse({ standardSchema: pageResponse(villageNameResponse) })
  @ApiProblems(400, 403, 404)
  listNames(
    @Param('id', { schema: idParam }) id: string,
    @Query({ schema: listFactsQuery }) query: ListFactsQuery,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.list(id, 'VILLAGE_NAME', query, user);
  }

  @Post(':id/names')
  @Roles(Role.CONTRIBUTOR)
  @ETag()
  @ApiOperation({ summary: 'Submit a name of a village', description: SUBMIT_DESCRIPTION })
  @ApiCreatedResponse({
    standardSchema: villageNameResponse,
    description: 'ETag holds the claim version.',
  })
  @ApiProblems(400, 404, 409, 422)
  createName(
    @Param('id', { schema: idParam }) id: string,
    @Body({ schema: createVillageNameBody }) body: CreateVillageNameBody,
  ) {
    return this.submit(id, 'VILLAGE_NAME', body);
  }

  @Patch(':id/names/:claimId')
  @Roles(Role.CONTRIBUTOR)
  @ETag()
  @ApiOperation({
    summary: 'Edit your own unverified name',
    description:
      'Only the author, only while UNVERIFIED (403 / 422). If-Match is the claim version.',
  })
  @ApiOkResponse({
    standardSchema: villageNameResponse,
    description: 'ETag holds the new claim version.',
  })
  @ApiProblems(400, 403, 404, 409, 412, 422, 428)
  async updateName(
    @Param('id', { schema: idParam }) id: string,
    @Param('claimId', { schema: idParam }) claimId: string,
    @IfMatch() expectedVersion: number,
    @Body({ schema: updateVillageNameBody }) body: UpdateVillageNameBody,
  ) {
    return toFactResponse(
      await this.names.edit({ villageId: id, claimId, expectedVersion, changes: body }),
    );
  }

  @Delete(':id/names/:claimId')
  @HttpCode(204)
  @Roles(Role.CONTRIBUTOR)
  @ApiOperation({
    summary: 'Withdraw your own unverified name',
    description:
      'The claim becomes WITHDRAWN and stays as history. Only the author, only while UNVERIFIED.',
  })
  @ApiNoContentResponse({ description: 'Withdrawn.' })
  @ApiProblems(400, 403, 404, 412, 422, 428)
  async withdrawName(
    @Param('id', { schema: idParam }) id: string,
    @Param('claimId', { schema: idParam }) claimId: string,
    @IfMatch() expectedVersion: number,
  ): Promise<void> {
    await this.names.withdraw({ villageId: id, claimId, expectedVersion });
  }

  // ---- name origins (#27) ----

  @Get(':id/name-origins')
  @Public({ optionalUser: true })
  @ApiOperation({ summary: 'List the name origins of a village', description: LIST_DESCRIPTION })
  @ApiOkResponse({ standardSchema: pageResponse(nameOriginResponse) })
  @ApiProblems(400, 403, 404)
  listNameOrigins(
    @Param('id', { schema: idParam }) id: string,
    @Query({ schema: listFactsQuery }) query: ListFactsQuery,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.list(id, 'NAME_ORIGIN', query, user);
  }

  @Post(':id/name-origins')
  @Roles(Role.CONTRIBUTOR)
  @ETag()
  @ApiOperation({
    summary: 'Submit the origin of a village name',
    description: `${SUBMIT_DESCRIPTION} A source is required (422 without one).`,
  })
  @ApiCreatedResponse({
    standardSchema: nameOriginResponse,
    description: 'ETag holds the claim version.',
  })
  @ApiProblems(400, 404, 409, 422)
  createNameOrigin(
    @Param('id', { schema: idParam }) id: string,
    @Body({ schema: createNameOriginBody }) body: CreateNameOriginBody,
  ) {
    return this.submit(id, 'NAME_ORIGIN', body);
  }

  // ---- affiliations ----

  @Get(':id/affiliations')
  @Public({ optionalUser: true })
  @ApiOperation({
    summary: 'List the administrative affiliations of a village',
    description: LIST_DESCRIPTION,
  })
  @ApiOkResponse({ standardSchema: pageResponse(affiliationResponse) })
  @ApiProblems(400, 403, 404)
  listAffiliations(
    @Param('id', { schema: idParam }) id: string,
    @Query({ schema: listFactsQuery }) query: ListFactsQuery,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.list(id, 'AFFILIATION', query, user);
  }

  @Post(':id/affiliations')
  @Roles(Role.CONTRIBUTOR)
  @ETag()
  @ApiOperation({
    summary: 'Submit an administrative affiliation',
    description: `${SUBMIT_DESCRIPTION} 404 when the administrative unit is unknown.`,
  })
  @ApiCreatedResponse({
    standardSchema: affiliationResponse,
    description: 'ETag holds the claim version.',
  })
  @ApiProblems(400, 404, 409, 422)
  createAffiliation(
    @Param('id', { schema: idParam }) id: string,
    @Body({ schema: createAffiliationBody }) body: CreateAffiliationBody,
  ) {
    return this.submit(id, 'AFFILIATION', body);
  }

  // ---- location (#34) ----

  @Get(':id/location')
  @Public({ optionalUser: true })
  @ApiOperation({
    summary: 'Get the location of a village',
    description: `${LIST_DESCRIPTION} A village has at most one published location.`,
  })
  @ApiOkResponse({ standardSchema: pageResponse(locationResponse) })
  @ApiProblems(400, 403, 404)
  getLocation(
    @Param('id', { schema: idParam }) id: string,
    @Query({ schema: listFactsQuery }) query: ListFactsQuery,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.list(id, 'LOCATION', query, user);
  }

  @Put(':id/location')
  @HttpCode(201)
  @Roles(Role.CONTRIBUTOR)
  @ETag()
  @ApiOperation({
    summary: 'Submit a location for a village',
    description:
      `${SUBMIT_DESCRIPTION} Each PUT submits a new LOCATION claim; once preferred, it becomes ` +
      "the village's location and `village.locationChanged` is published.",
  })
  @ApiCreatedResponse({
    standardSchema: locationResponse,
    description: 'ETag holds the claim version.',
  })
  @ApiProblems(400, 404, 409, 422)
  putLocation(
    @Param('id', { schema: idParam }) id: string,
    @Body({ schema: putLocationBody }) body: PutLocationBody,
  ) {
    return this.submit(id, 'LOCATION', body);
  }

  // ---- measures ----

  @Get(':id/measures')
  @Public({ optionalUser: true })
  @ApiOperation({
    summary: 'List the measures of a village (elevation, area)',
    description: LIST_DESCRIPTION,
  })
  @ApiOkResponse({ standardSchema: pageResponse(measureResponse) })
  @ApiProblems(400, 403, 404)
  listMeasures(
    @Param('id', { schema: idParam }) id: string,
    @Query({ schema: listFactsQuery }) query: ListFactsQuery,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.list(id, 'MEASURE', query, user);
  }

  @Post(':id/measures')
  @Roles(Role.CONTRIBUTOR)
  @ETag()
  @ApiOperation({
    summary: 'Submit a measure (elevation in m, area in dunum)',
    description: SUBMIT_DESCRIPTION,
  })
  @ApiCreatedResponse({
    standardSchema: measureResponse,
    description: 'ETag holds the claim version.',
  })
  @ApiProblems(400, 404, 409, 422)
  createMeasure(
    @Param('id', { schema: idParam }) id: string,
    @Body({ schema: createMeasureBody }) body: CreateMeasureBody,
  ) {
    return this.submit(id, 'MEASURE', body);
  }

  // ---- relations (#34) ----

  @Get(':id/relations')
  @Public({ optionalUser: true })
  @ApiOperation({
    summary: 'List the relations of a village to others',
    description: LIST_DESCRIPTION,
  })
  @ApiOkResponse({ standardSchema: pageResponse(relationResponse) })
  @ApiProblems(400, 403, 404)
  listRelations(
    @Param('id', { schema: idParam }) id: string,
    @Query({ schema: listFactsQuery }) query: ListFactsQuery,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ) {
    return this.list(id, 'RELATION', query, user);
  }

  @Post(':id/relations')
  @Roles(Role.CONTRIBUTOR)
  @ETag()
  @ApiOperation({
    summary: 'Submit a relation to another village',
    description: `${SUBMIT_DESCRIPTION} 404 when the related village is unknown; 422 for the village itself.`,
  })
  @ApiCreatedResponse({
    standardSchema: relationResponse,
    description: 'ETag holds the claim version.',
  })
  @ApiProblems(400, 404, 409, 422)
  createRelation(
    @Param('id', { schema: idParam }) id: string,
    @Body({ schema: createRelationBody }) body: CreateRelationBody,
  ) {
    return this.submit(id, 'RELATION', body);
  }

  // ---- nearby (#34) ----

  @Get(':id/nearby')
  @Public({ optionalUser: true })
  @ApiOperation({
    summary: 'Published villages near a village',
    description:
      'Nearest first, within `radiusKm` (0.1–100, default 10), at most `limit` (1–50, default 10). ' +
      'Uses the location projection and its GiST index (ST_DWithin + KNN). ' +
      '422 when the village has no published location.',
  })
  @ApiOkResponse({ standardSchema: nearbyVillagesResponse })
  @ApiProblems(400, 404, 422)
  async nearby(
    @Param('id', { schema: idParam }) id: string,
    @Query({ schema: nearbyQuery }) query: NearbyQuery,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ): Promise<NearbyVillagesResponse> {
    return { content: await this.nearbyVillages.execute({ villageId: id, ...query, user }) };
  }
}
