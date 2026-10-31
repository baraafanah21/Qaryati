import { FieldErrorCode, ValidationError } from '../../../shared/kernel';

/** Administrative unit kinds. */
export const ADMIN_UNIT_TYPES = ['GOVERNORATE', 'SUB_DISTRICT', 'LOCAL_AUTHORITY'] as const;
export type AdminUnitType = (typeof ADMIN_UNIT_TYPES)[number];

/** Exact, case-sensitive membership: `'governorate'` is not a unit type. */
export function isAdminUnitType(value: string): value is AdminUnitType {
  return (ADMIN_UNIT_TYPES as readonly string[]).includes(value);
}

/** Authority kinds that apply only to local authorities. */
export const AUTHORITY_TYPES = [
  'MUNICIPALITY',
  'VILLAGE_COUNCIL',
  'LOCAL_COUNCIL',
  'PROJECT_COMMITTEE',
] as const;
export type AuthorityType = (typeof AUTHORITY_TYPES)[number];

/** Exact, case-sensitive membership in {@link AUTHORITY_TYPES}. */
export function isAuthorityType(value: string): value is AuthorityType {
  return (AUTHORITY_TYPES as readonly string[]).includes(value);
}

/** Historical eras represented by administrative units. */
export const ADMIN_ERAS = ['CURRENT', 'BRITISH_MANDATE', 'OTTOMAN'] as const;
export type AdminEra = (typeof ADMIN_ERAS)[number];

/** Exact, case-sensitive membership in {@link ADMIN_ERAS}. */
export function isAdminEra(value: string): value is AdminEra {
  return (ADMIN_ERAS as readonly string[]).includes(value);
}

export interface AdminUnitValidationInput {
  id: string;
  unitType: string;
  authorityType?: string | null;
  era: string;
  parentId?: string | null;
  parentEra?: string | null;
}

/**
 * Validates an administrative unit: allowed values (the table has no CHECK), then the
 * conditional authority and hierarchy rules.
 */
export function validateAdminUnit(input: AdminUnitValidationInput): void {
  if (!isAdminUnitType(input.unitType)) {
    throw new ValidationError('The administrative unit type is not allowed.', [
      {
        field: 'unitType',
        code: FieldErrorCode.INVALID_VALUE,
        message: `Use one of ${ADMIN_UNIT_TYPES.join(', ')}.`,
      },
    ]);
  }

  if (!isAdminEra(input.era)) {
    throw new ValidationError('The administrative unit era is not allowed.', [
      {
        field: 'era',
        code: FieldErrorCode.INVALID_VALUE,
        message: `Use one of ${ADMIN_ERAS.join(', ')}.`,
      },
    ]);
  }

  if (input.authorityType != null && !isAuthorityType(input.authorityType)) {
    throw new ValidationError('The authority type is not allowed.', [
      {
        field: 'authorityType',
        code: FieldErrorCode.INVALID_VALUE,
        message: `Use one of ${AUTHORITY_TYPES.join(', ')}.`,
      },
    ]);
  }

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
