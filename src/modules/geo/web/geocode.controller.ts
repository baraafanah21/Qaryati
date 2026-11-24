import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { ETag } from '../../../platform/http/etag';
import { ApiModule, ApiProblems } from '../../../platform/http/openapi';
import { idParam } from '../../../platform/http/pagination';
import type { VillageFact } from '../../village';
import { Role, Roles } from '../../iam';
import { AcceptGeocodeSuggestion } from '../application/accept-geocode-suggestion.use-case';
import { SuggestVillageLocations } from '../application/suggest-village-locations.use-case';
import {
  acceptedLocationResponse,
  geocodeCandidate,
  geocodeSuggestionsResponse,
  type AcceptedLocationResponse,
  type GeocodeCandidateBody,
} from './geocode.schemas';

const PROVIDER_DOWN =
  '502 `GEOCODING_UNAVAILABLE` when the provider times out, fails or is rate limited, or ' +
  'the circuit breaker is open; 502 `GEOCODING_BAD_RESPONSE` when its answer is unusable. ' +
  'Only this endpoint is affected.';

/** Geocoding suggestions for a village and accepting one as a location claim (#41). */
@ApiModule('geo')
@Controller('villages')
export class GeocodeController {
  constructor(
    private readonly suggest: SuggestVillageLocations,
    private readonly accept: AcceptGeocodeSuggestion,
  ) {}

  @Post(':id/geocode-suggestions')
  @HttpCode(200)
  @Roles(Role.EDITOR)
  @ApiOperation({
    summary: 'Suggest locations for a village from the geocoding provider',
    description:
      "Searches the provider for the village's preferred Arabic name, then its English name. " +
      'Answers come from a Redis cache when the same question was asked before (30 days; ' +
      `empty answers 24 hours). Nothing is stored. ${PROVIDER_DOWN}`,
  })
  @ApiOkResponse({ standardSchema: geocodeSuggestionsResponse })
  @ApiProblems(404, 502)
  async suggestions(@Param('id', { schema: idParam }) id: string) {
    return { candidates: await this.suggest.execute(id) };
  }

  @Post(':id/geocode-suggestions/accept')
  @HttpCode(201)
  @Roles(Role.EDITOR)
  @ETag()
  @ApiOperation({
    summary: 'Accept a geocoding suggestion as an unverified location claim',
    description:
      'Submits the candidate as a `LOCATION` claim with precision `APPROXIMATE`, cited to the ' +
      "provider's `EXTERNAL_API` source (created on first use) with `providerRef` as locator. " +
      'The claim is `UNVERIFIED` until another editor verifies it. Accepting the same ' +
      'candidate twice is a 409.',
  })
  @ApiCreatedResponse({
    standardSchema: acceptedLocationResponse,
    description: 'ETag holds the claim version.',
  })
  @ApiProblems(400, 404, 409, 422)
  async acceptSuggestion(
    @Param('id', { schema: idParam }) id: string,
    @Body({ schema: geocodeCandidate }) body: GeocodeCandidateBody,
  ): Promise<AcceptedLocationResponse> {
    return toResponse(await this.accept.execute(id, body));
  }
}

function toResponse({ claim, value }: VillageFact<'LOCATION'>): AcceptedLocationResponse {
  return {
    claimId: claim.id,
    status: claim.status,
    isPreferred: claim.isPreferred,
    sourceId: claim.sourceId,
    sourceLocator: claim.sourceLocator,
    createdBy: claim.createdBy,
    version: claim.version,
    createdAt: claim.createdAt.toISOString(),
    ...value,
  };
}
