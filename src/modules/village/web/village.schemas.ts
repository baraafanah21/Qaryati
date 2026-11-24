import { z } from 'zod';
import { pageResponse, paginationQuery, sortQuery } from '../../../platform/http/pagination';
import { FieldErrorCode } from '../../../shared/kernel';
import { MAX_SEARCH_VILLAGE_IDS, VILLAGE_SORT_FIELDS } from '../domain/village-search';
import { PUBLICATION_STATUSES, SETTLEMENT_STATUSES } from '../domain/village-values';

// Shape limits only; the domain owns the rules (slug format, trimmed name length, allowed values).
const slug = z.string().min(1).max(120);
const displayName = z.string().min(1).max(200);

export const createVillageBody = z.strictObject({
  slug,
  settlementStatus: z.enum(SETTLEMENT_STATUSES),
  displayNameAr: displayName,
  displayNameEn: displayName.optional(),
});
export type CreateVillageBody = z.infer<typeof createVillageBody>;

/** Identity fields a PATCH may change. The slug is stable: it is the public URL. */
export const updateVillageBody = z.strictObject({
  settlementStatus: z.enum(SETTLEMENT_STATUSES).optional(),
  displayNameAr: displayName.optional(),
  displayNameEn: displayName.nullable().optional(),
});
export type UpdateVillageBody = z.infer<typeof updateVillageBody>;

/** `{idOrSlug}`: a UUID or a slug; the domain never issues a UUID-shaped slug. */
export const idOrSlugParam = z.string().min(1).max(120);

/** What the API returns for a village identity. `version` is also sent as the ETag. */
export const villageResponse = z
  .strictObject({
    id: z.uuid(),
    slug: z.string(),
    settlementStatus: z.enum(SETTLEMENT_STATUSES),
    publicationStatus: z.enum(PUBLICATION_STATUSES),
    displayNameAr: z.string(),
    displayNameEn: z.string().nullable(),
    location: z.strictObject({ latitude: z.number(), longitude: z.number() }).nullable(),
    createdBy: z.uuid(),
    version: z.int().min(1),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'VillageResponse' });
export type VillageResponse = z.infer<typeof villageResponse>;

/** `?ids=a,b,c`: comma-separated village ids, at most {@link MAX_SEARCH_VILLAGE_IDS}. */
const villageIds = z
  .string()
  .meta({ description: `Comma-separated village ids, at most ${MAX_SEARCH_VILLAGE_IDS}.` })
  .transform((raw) => raw.split(',').map((id) => id.trim().toLowerCase()))
  .pipe(z.array(z.uuid()).min(1).max(MAX_SEARCH_VILLAGE_IDS));

/**
 * `GET /villages` (#30). The default sort is resolved by the use case (best
 * match with `q`, Arabic name without), so the schema has none; `relevance`
 * only exists with `q`.
 */
export const searchVillagesQuery = paginationQuery
  .extend({
    q: z.string().trim().min(1).max(100).optional(),
    governorate: z
      .string()
      .min(1)
      .max(120)
      .meta({ description: 'Id or code of a GOVERNORATE admin unit.' })
      .optional(),
    settlementStatus: z.enum(SETTLEMENT_STATUSES).optional(),
    publicationStatus: z
      .enum(PUBLICATION_STATUSES)
      .meta({ description: 'EDITOR and ADMIN only; ignored for everyone else (published only).' })
      .optional(),
    ids: villageIds.optional(),
    sort: sortQuery(VILLAGE_SORT_FIELDS),
  })
  .superRefine((query, ctx) => {
    if (query.q === undefined && query.sort.some((sort) => sort.field === 'relevance')) {
      ctx.addIssue({
        code: 'custom',
        path: ['sort'],
        params: { code: FieldErrorCode.NOT_ALLOWED },
        message: 'Sorting by relevance needs q.',
      });
    }
  });
export type SearchVillagesQuery = z.infer<typeof searchVillagesQuery>;

/** One village in a search result; `relevance` (0–1) is set only when `q` was given. */
export const villageSummary = z
  .strictObject({
    id: z.uuid(),
    slug: z.string(),
    settlementStatus: z.enum(SETTLEMENT_STATUSES),
    publicationStatus: z.enum(PUBLICATION_STATUSES),
    displayNameAr: z.string(),
    displayNameEn: z.string().nullable(),
    location: z.strictObject({ latitude: z.number(), longitude: z.number() }).nullable(),
    createdAt: z.iso.datetime(),
    relevance: z.number().min(0).max(1).nullable(),
  })
  .meta({ id: 'VillageSummary' });
export type VillageSummary = z.infer<typeof villageSummary>;

/** A page of {@link villageSummary}. */
export const villageSummaryPage = pageResponse(villageSummary).meta({ id: 'VillageSummaryPage' });
