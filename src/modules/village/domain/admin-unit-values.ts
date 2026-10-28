import { FieldErrorCode, ValidationError } from '../../../shared/kernel';

/** Administrative unit kinds. */
export const ADMIN_UNIT_TYPES = ['GOVERNORATE', 'SUB_DISTRICT', 'LOCAL_AUTHORITY'] as const;
export type AdminUnitType = (typeof ADMIN_UNIT_TYPES)[number];

/** Authority kinds that apply only to local authorities. */
export const AUTHORITY_TYPES = [
  'MUNICIPALITY',
  'VILLAGE_COUNCIL',
  'LOCAL_COUNCIL',
  'PROJECT_COMMITTEE',
] as const;
export type AuthorityType = (typeof AUTHORITY_TYPES)[number];

/** Historical eras represented by administrative units. */
export const ADMIN_ERAS = ['CURRENT', 'BRITISH_MANDATE', 'OTTOMAN'] as const;
export type AdminEra = (typeof ADMIN_ERAS)[number];

export interface AdminUnitValidationInput {
  id: string;
  unitType: string;
  authorityType?: string | null;
  era: string;
  parentId?: string | null;
  parentEra?: string | null;
}

/** Validates conditional authority and hierarchy rules for an administrative unit. */
export function validateAdminUnit(input: AdminUnitValidationInput): void {
  if (input.unitType === 'LOCAL_AUTHORITY' && !input.authorityType) {
    throw new ValidationError('A local authority requires an authority type.', [
      {
        field: 'authorityType',
        code: FieldErrorCode.REQUIRED,
        message: 'Authority type is required.',
      },
    ]);
  }

  if (input.unitType !== 'LOCAL_AUTHORITY' && input.authorityType != null) {
    throw new ValidationError('Only local authorities may have an authority type.', [
      {
        field: 'authorityType',
        code: FieldErrorCode.NOT_ALLOWED,
        message: 'Authority type is not allowed.',
      },
    ]);
  }

  if (input.parentId != null && input.parentId === input.id) {
    throw new ValidationError('An administrative unit cannot be its own parent.', [
      {
        field: 'parentId',
        code: FieldErrorCode.NOT_ALLOWED,
        message: 'Parent must be another unit.',
      },
    ]);
  }

  if (input.parentId != null && input.parentEra != null && input.parentEra !== input.era) {
    throw new ValidationError('An administrative unit must share its era with its parent.', [
      {
        field: 'parentId',
        code: FieldErrorCode.NOT_ALLOWED,
        message: 'Parent must belong to the same era.',
      },
    ]);
  }
}
