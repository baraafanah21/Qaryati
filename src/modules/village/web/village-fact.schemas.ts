import { z } from 'zod';
import { CLAIM_STATUSES } from '../../curation';
import { paginationQuery } from '../../../platform/http/pagination';
import {
  LOCATION_PRECISIONS,
  MEASURE_KINDS,
  NAME_TYPES,
  RELATION_TYPES,
} from '../domain/fact-values';

// Shape limits only; the domain owns the rules (ranges, period order, language tag, lengths).

/** Where a fact comes from, and the claim it corrects. Shared by every submit body. */
const provenance = {
  sourceId: z.uuid().nullable().optional(),
  sourceLocator: z.string().min(1).max(500).nullable().optional(),
  supersedesId: z.uuid().nullable().optional(),
};

const year = z.int().min(-9999).max(9999);
const isoDate = z.iso.date();

export const villageNameFields = {
  name: z.string().min(1).max(200),
  lang: z.string().min(2).max(20),
  nameType: z.enum(NAME_TYPES),
  periodFromYear: year.nullable().optional(),
  periodToYear: year.nullable().optional(),
};

export const createVillageNameBody = z.strictObject({ ...villageNameFields, ...provenance });
export type CreateVillageNameBody = z.infer<typeof createVillageNameBody>;

/** PATCH of an unverified name by its author: any subset of the value and source fields. */
export const updateVillageNameBody = z.strictObject({
  name: villageNameFields.name.optional(),
  lang: villageNameFields.lang.optional(),
  nameType: villageNameFields.nameType.optional(),
  periodFromYear: villageNameFields.periodFromYear,
  periodToYear: villageNameFields.periodToYear,
  sourceId: provenance.sourceId,
  sourceLocator: provenance.sourceLocator,
});
export type UpdateVillageNameBody = z.infer<typeof updateVillageNameBody>;

export const createNameOriginBody = z.strictObject({
  meaning: z.string().min(1).max(500),
  originLanguage: z.string().min(1).max(100).nullable().optional(),
  explanation: z.string().min(1).max(4000).nullable().optional(),
  ...provenance,
});
export type CreateNameOriginBody = z.infer<typeof createNameOriginBody>;

export const createAffiliationBody = z.strictObject({
  adminUnitId: z.uuid(),
  validFrom: isoDate.nullable().optional(),
  validTo: isoDate.nullable().optional(),
  ...provenance,
});
export type CreateAffiliationBody = z.infer<typeof createAffiliationBody>;

export const putLocationBody = z.strictObject({
  latitude: z.number(),
  longitude: z.number(),
  precision: z.enum(LOCATION_PRECISIONS),
  description: z.string().min(1).max(1000).nullable().optional(),
  ...provenance,
});
export type PutLocationBody = z.infer<typeof putLocationBody>;

export const createMeasureBody = z.strictObject({
  kind: z.enum(MEASURE_KINDS),
  value: z.number(),
  ...provenance,
});
export type CreateMeasureBody = z.infer<typeof createMeasureBody>;

export const createRelationBody = z.strictObject({
  relatedVillageId: z.uuid(),
  relationType: z.enum(RELATION_TYPES),
  ...provenance,
});
export type CreateRelationBody = z.infer<typeof createRelationBody>;

/** `?page=&size=&includeUnverified=`; the last one is for editors. */
export const listFactsQuery = paginationQuery.extend({
  includeUnverified: z.stringbool().default(false),
});
export type ListFactsQuery = z.infer<typeof listFactsQuery>;

/** Path of one claim of a village. */
export const villageClaimParams = z.strictObject({ id: z.uuid(), claimId: z.uuid() });

/** `?radiusKm=&limit=`: 0.1–100 km, at most 50 villages. */
export const nearbyQuery = z.strictObject({
  radiusKm: z.coerce.number().min(0.1).max(100).default(10),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export type NearbyQuery = z.infer<typeof nearbyQuery>;

/** The claim fields every fact response carries. `version` is the claim's, for `If-Match`. */
const claimFields = {
  claimId: z.uuid(),
  status: z.enum(CLAIM_STATUSES),
  isPreferred: z.boolean(),
  sourceId: z.uuid().nullable(),
  sourceLocator: z.string().nullable(),
  supersedesId: z.uuid().nullable(),
  createdBy: z.uuid(),
  version: z.int().min(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
};

export const villageNameResponse = z
  .strictObject({
    ...claimFields,
    name: z.string(),
    nameNormalized: z.string(),
    lang: z.string(),
    nameType: z.enum(NAME_TYPES),
    periodFromYear: z.int().nullable(),
    periodToYear: z.int().nullable(),
  })
  .meta({ id: 'VillageNameResponse' });

export const nameOriginResponse = z
  .strictObject({
    ...claimFields,
    meaning: z.string(),
    originLanguage: z.string().nullable(),
    explanation: z.string().nullable(),
  })
  .meta({ id: 'NameOriginResponse' });

export const affiliationResponse = z
  .strictObject({
    ...claimFields,
    adminUnitId: z.uuid(),
    validFrom: isoDate.nullable(),
    validTo: isoDate.nullable(),
  })
  .meta({ id: 'AffiliationResponse' });

export const locationResponse = z
  .strictObject({
    ...claimFields,
    latitude: z.number(),
    longitude: z.number(),
    precision: z.enum(LOCATION_PRECISIONS),
    description: z.string().nullable(),
  })
  .meta({ id: 'LocationResponse' });

export const measureResponse = z
  .strictObject({ ...claimFields, kind: z.enum(MEASURE_KINDS), value: z.number() })
  .meta({ id: 'MeasureResponse' });

export const relationResponse = z
  .strictObject({
    ...claimFields,
    relatedVillageId: z.uuid(),
    relationType: z.enum(RELATION_TYPES),
  })
  .meta({ id: 'RelationResponse' });

export const nearbyVillageResponse = z
  .strictObject({
    id: z.uuid(),
    slug: z.string(),
    displayNameAr: z.string(),
    displayNameEn: z.string().nullable(),
    location: z.strictObject({ latitude: z.number(), longitude: z.number() }),
    distanceMeters: z.number().min(0),
  })
  .meta({ id: 'NearbyVillage' });

export const nearbyVillagesResponse = z
  .strictObject({ content: z.array(nearbyVillageResponse) })
  .meta({ id: 'NearbyVillages' });
export type NearbyVillagesResponse = z.infer<typeof nearbyVillagesResponse>;
