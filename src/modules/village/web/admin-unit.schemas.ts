import { z } from 'zod';
import { ADMIN_ERAS, ADMIN_UNIT_TYPES, AUTHORITY_TYPES } from '../domain/admin-unit-values';

/** `GET /admin-units` filters; an unknown value or parameter is a 400. */
export const listAdminUnitsQuery = z.strictObject({
  type: z.enum(ADMIN_UNIT_TYPES).optional(),
  era: z.enum(ADMIN_ERAS).optional(),
  parentId: z.uuid().optional(),
});
export type ListAdminUnitsQuery = z.infer<typeof listAdminUnitsQuery>;

/** `{idOrCode}`: a UUID or a unit code such as `nablus`. */
export const idOrCodeParam = z.string().min(1).max(120);

/** One administrative unit. `version` is also sent as the ETag. */
export const adminUnitResponse = z
  .strictObject({
    id: z.uuid(),
    code: z.string(),
    parentId: z.uuid().nullable(),
    unitType: z.enum(ADMIN_UNIT_TYPES),
    authorityType: z.enum(AUTHORITY_TYPES).nullable(),
    era: z.enum(ADMIN_ERAS),
    nameAr: z.string(),
    nameEn: z.string().nullable(),
    version: z.int().min(1),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'AdminUnitResponse' });
export type AdminUnitResponse = z.infer<typeof adminUnitResponse>;

/** The whole filtered list: reference data, small enough to return unpaginated. */
export const adminUnitListResponse = z.array(adminUnitResponse).meta({ id: 'AdminUnitList' });
