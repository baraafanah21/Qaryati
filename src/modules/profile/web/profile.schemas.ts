import { z } from 'zod';
import { CLAIM_TYPES } from '../../curation';
import { FACILITY_TYPES, PRODUCT_CATEGORIES, PRODUCT_SIGNIFICANCES } from '../../economy';
import {
  CULTURAL_CATEGORIES,
  DATE_PRECISIONS,
  LANDMARK_ERAS,
  LANDMARK_TYPES,
} from '../../heritage';
import { COUNT_TYPES } from '../../population';
import {
  ADMIN_ERAS,
  ADMIN_UNIT_TYPES,
  LOCATION_PRECISIONS,
  MEASURE_KINDS,
  NAME_TYPES,
  PUBLICATION_STATUSES,
  RELATION_TYPES,
  SETTLEMENT_STATUSES,
} from '../../village';

// Response schemas only: they document the profile in OpenAPI. The allowed
// values come from the owning modules' `as const` lists.

/** A village id (UUID) or slug, as `GET /villages/{idOrSlug}` takes it. */
export const idOrSlugParam = z.string().min(1).max(120);

const point = z.strictObject({ latitude: z.number(), longitude: z.number() });

/** Where a published fact comes from; part of every fact in the profile. */
const provenance = {
  claimId: z.uuid(),
  source: z
    .strictObject({ id: z.uuid(), title: z.string(), reliability: z.int() })
    .meta({ id: 'ProfileSource' }),
  sourceLocator: z.string().nullable(),
  verifiedAt: z.iso.datetime().nullable(),
};

const fact = <S extends z.ZodRawShape>(id: string, shape: S) =>
  z.strictObject({ ...provenance, ...shape }).meta({ id });

const name = fact('ProfileName', {
  name: z.string(),
  lang: z.string(),
  nameType: z.enum(NAME_TYPES),
  periodFromYear: z.int().nullable(),
  periodToYear: z.int().nullable(),
});
const origin = fact('ProfileNameOrigin', {
  meaning: z.string(),
  originLanguage: z.string().nullable(),
  explanation: z.string().nullable(),
});
const affiliation = fact('ProfileAffiliation', {
  adminUnit: z.strictObject({
    id: z.uuid(),
    code: z.string(),
    unitType: z.enum(ADMIN_UNIT_TYPES),
    era: z.enum(ADMIN_ERAS),
    nameAr: z.string(),
    nameEn: z.string().nullable(),
  }),
  validFrom: z.iso.date().nullable(),
  validTo: z.iso.date().nullable(),
});
const location = fact('ProfileLocation', {
  latitude: z.number(),
  longitude: z.number(),
  precision: z.enum(LOCATION_PRECISIONS),
  description: z.string().nullable(),
});
const measure = fact('ProfileMeasure', { kind: z.enum(MEASURE_KINDS), value: z.number() });
const relation = fact('ProfileRelation', {
  relationType: z.enum(RELATION_TYPES),
  relatedVillage: z.strictObject({
    id: z.uuid(),
    slug: z.string(),
    displayNameAr: z.string(),
    displayNameEn: z.string().nullable(),
  }),
});
const population = fact('ProfilePopulation', {
  population: z.int(),
  referenceYear: z.int(),
  countType: z.enum(COUNT_TYPES),
});
const history = fact('ProfileHistoryOverview', { summary: z.string() });
const event = fact('ProfileHistoricalEvent', {
  title: z.string(),
  description: z.string(),
  startDate: z.iso.date(),
  endDate: z.iso.date().nullable(),
  datePrecision: z.enum(DATE_PRECISIONS),
});
const landmark = fact('ProfileLandmark', {
  name: z.string(),
  landmarkType: z.enum(LANDMARK_TYPES),
  description: z.string().nullable(),
  location: point.nullable(),
  era: z.enum(LANDMARK_ERAS).nullable(),
});
const culturalItem = fact('ProfileCulturalItem', {
  category: z.enum(CULTURAL_CATEGORIES),
  name: z.string(),
  description: z.string(),
});
const product = fact('ProfileProduct', {
  product: z.strictObject({
    id: z.uuid(),
    code: z.string(),
    category: z.enum(PRODUCT_CATEGORIES),
    nameAr: z.string(),
    nameEn: z.string(),
  }),
  significance: z.enum(PRODUCT_SIGNIFICANCES),
});
const facility = fact('ProfileFacility', {
  facilityType: z.enum(FACILITY_TYPES),
  name: z.string(),
  location: point.nullable(),
  establishedYear: z.int().nullable(),
});

export const villageProfileResponse = z
  .strictObject({
    village: z.strictObject({
      id: z.uuid(),
      slug: z.string(),
      settlementStatus: z.enum(SETTLEMENT_STATUSES),
      publicationStatus: z.enum(PUBLICATION_STATUSES),
      displayNameAr: z.string(),
      displayNameEn: z.string().nullable(),
      location: point.nullable(),
      version: z.int().min(1),
      createdAt: z.iso.datetime(),
      updatedAt: z.iso.datetime(),
    }),
    names: z.array(name),
    origin: origin.nullable(),
    affiliations: z.array(affiliation),
    location: location.nullable(),
    measures: z.array(measure),
    relations: z.array(relation),
    population: z.strictObject({ latest: population.nullable(), history: z.array(population) }),
    heritage: z.strictObject({
      history: history.nullable(),
      events: z.array(event),
      landmarks: z.array(landmark),
      culturalItems: z.array(culturalItem),
    }),
    economy: z.strictObject({ products: z.array(product), facilities: z.array(facility) }),
  })
  .meta({ id: 'VillageProfileResponse' });

export const completenessResponse = z
  .strictObject({
    villageId: z.uuid(),
    score: z.int().min(0).max(100),
    present: z.array(z.enum(CLAIM_TYPES)),
    missing: z.array(z.enum(CLAIM_TYPES)),
  })
  .meta({ id: 'VillageCompletenessResponse' });
