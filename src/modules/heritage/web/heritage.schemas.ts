import { z } from 'zod';
import { CLAIM_STATUSES } from '../../curation';
import { paginationQuery } from '../../../platform/http/pagination';
import {
  CULTURAL_CATEGORIES,
  DATE_PRECISIONS,
  HERITAGE_TEXT_LIMITS,
  LANDMARK_ERAS,
  LANDMARK_TYPES,
} from '../domain/heritage-values';

// Shape limits only. The domain owns the rules: lengths after normalization (so
// the caps here are twice the domain limits), dates against their precision,
// start not in the future, end after start, coordinate ranges (all 422).

const text = (limit: number) =>
  z
    .string()
    .min(1)
    .max(limit * 2);
const name = text(HERITAGE_TEXT_LIMITS.name);
const description = text(HERITAGE_TEXT_LIMITS.description);

/** Where a fact comes from. */
const source = {
  sourceId: z.uuid().nullable().optional(),
  sourceLocator: z.string().min(1).max(500).nullable().optional(),
};
/** ... and, on submit, the claim it corrects. */
const provenance = { ...source, supersedesId: z.uuid().nullable().optional() };

const point = z.strictObject({ latitude: z.number(), longitude: z.number() });

const historyFields = { summary: text(HERITAGE_TEXT_LIMITS.summary) };
const eventFields = {
  title: name,
  description,
  startDate: z.iso.date(),
  endDate: z.iso.date().nullable().optional(),
  datePrecision: z.enum(DATE_PRECISIONS),
};
const landmarkFields = {
  name,
  landmarkType: z.enum(LANDMARK_TYPES),
  description: description.nullable().optional(),
  location: point.nullable().optional(),
  era: z.enum(LANDMARK_ERAS).nullable().optional(),
};
const culturalFields = {
  category: z.enum(CULTURAL_CATEGORIES),
  name,
  description,
};

/** Every field optional: a PATCH changes only what it names. */
const partial = <S extends z.ZodRawShape>(shape: S) =>
  z.strictObject({ ...shape, ...source }).partial();

export const putHistoryBody = z.strictObject({ ...historyFields, ...provenance });
export type PutHistoryBody = z.infer<typeof putHistoryBody>;
export const updateHistoryBody = partial(historyFields);
export type UpdateHistoryBody = z.infer<typeof updateHistoryBody>;

export const createEventBody = z.strictObject({ ...eventFields, ...provenance });
export type CreateEventBody = z.infer<typeof createEventBody>;
export const updateEventBody = partial(eventFields);
export type UpdateEventBody = z.infer<typeof updateEventBody>;

export const createLandmarkBody = z.strictObject({ ...landmarkFields, ...provenance });
export type CreateLandmarkBody = z.infer<typeof createLandmarkBody>;
export const updateLandmarkBody = partial(landmarkFields);
export type UpdateLandmarkBody = z.infer<typeof updateLandmarkBody>;

export const createCulturalItemBody = z.strictObject({ ...culturalFields, ...provenance });
export type CreateCulturalItemBody = z.infer<typeof createCulturalItemBody>;
export const updateCulturalItemBody = partial(culturalFields);
export type UpdateCulturalItemBody = z.infer<typeof updateCulturalItemBody>;

/** `?page=&size=&includeUnverified=`. */
export const listHeritageQuery = paginationQuery.extend({
  includeUnverified: z
    .stringbool()
    .default(false)
    .describe('EDITOR+: every claim with its status; other logged-in users: their own claims too.'),
});
export type ListHeritageQuery = z.infer<typeof listHeritageQuery>;

export const listLandmarksQuery = listHeritageQuery.extend({
  type: z.enum(LANDMARK_TYPES).optional(),
});
export type ListLandmarksQuery = z.infer<typeof listLandmarksQuery>;

export const listCulturalItemsQuery = listHeritageQuery.extend({
  category: z.enum(CULTURAL_CATEGORIES).optional(),
});
export type ListCulturalItemsQuery = z.infer<typeof listCulturalItemsQuery>;

/** The claim's provenance and review state, first in every response. */
const claimFields = {
  claimId: z.uuid(),
  status: z.enum(CLAIM_STATUSES),
  isPreferred: z.boolean(),
  sourceId: z.uuid().nullable(),
  sourceLocator: z.string().nullable(),
  supersedesId: z.uuid().nullable(),
  createdBy: z.uuid(),
  /** The claim's version, for `If-Match`. */
  version: z.int().min(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
};

export const historyResponse = z
  .strictObject({ ...claimFields, summary: z.string() })
  .meta({ id: 'HistoryOverviewResponse' });

export const eventResponse = z
  .strictObject({
    ...claimFields,
    title: z.string(),
    description: z.string(),
    startDate: z.iso.date(),
    endDate: z.iso.date().nullable(),
    datePrecision: z.enum(DATE_PRECISIONS),
  })
  .meta({ id: 'HistoricalEventResponse' });

export const landmarkResponse = z
  .strictObject({
    ...claimFields,
    name: z.string(),
    landmarkType: z.enum(LANDMARK_TYPES),
    description: z.string().nullable(),
    location: point.nullable(),
    era: z.enum(LANDMARK_ERAS).nullable(),
  })
  .meta({ id: 'LandmarkResponse' });

export const culturalItemResponse = z
  .strictObject({
    ...claimFields,
    category: z.enum(CULTURAL_CATEGORIES),
    name: z.string(),
    description: z.string(),
  })
  .meta({ id: 'CulturalItemResponse' });
