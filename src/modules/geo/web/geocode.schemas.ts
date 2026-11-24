import { z } from 'zod';
import { CLAIM_STATUSES } from '../../curation';
import { LOCATION_PRECISIONS } from '../../village';
import { GEOCODING_PROVIDERS } from '../application/geocoding.port';

/** One candidate, as the suggestions endpoint returns it and the accept endpoint takes it. */
export const geocodeCandidate = z
  .strictObject({
    displayName: z.string().trim().min(1).max(1000),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    provider: z.enum(GEOCODING_PROVIDERS),
    providerRef: z.string().trim().min(1).max(200).nullable(),
  })
  .meta({ id: 'GeocodeCandidate' });

export type GeocodeCandidateBody = z.infer<typeof geocodeCandidate>;

export const geocodeSuggestionsResponse = z
  .strictObject({ candidates: z.array(geocodeCandidate) })
  .meta({ id: 'GeocodeSuggestions' });

/** The `LOCATION` claim an accepted candidate became, like `PUT /villages/{id}/location`. */
export const acceptedLocationResponse = z
  .strictObject({
    claimId: z.uuid(),
    status: z.enum(CLAIM_STATUSES),
    isPreferred: z.boolean(),
    sourceId: z.uuid().nullable(),
    sourceLocator: z.string().nullable(),
    createdBy: z.uuid(),
    version: z.int().min(1),
    createdAt: z.iso.datetime(),
    latitude: z.number(),
    longitude: z.number(),
    precision: z.enum(LOCATION_PRECISIONS),
    description: z.string().nullable(),
  })
  .meta({ id: 'AcceptedGeocodeLocation' });

export type AcceptedLocationResponse = z.infer<typeof acceptedLocationResponse>;
