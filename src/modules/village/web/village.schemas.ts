import { z } from 'zod';
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
