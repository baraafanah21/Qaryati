import type { Id } from '../../../shared/kernel';
import type { AdminEra, AdminUnitType, AuthorityType } from './admin-unit-values';

/**
 * An administrative unit (governorate, sub-district, local authority) of one
 * era. Reference data: seeded by migrations and read far more often than
 * written, so it is a plain read model here.
 */
export interface AdminUnit {
  id: Id<'AdminUnit'>;
  code: string;
  parentId: string | null;
  unitType: AdminUnitType;
  authorityType: AuthorityType | null;
  era: AdminEra;
  nameAr: string;
  nameEn: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Optional filters of the admin-unit list; all given filters must match. */
export interface AdminUnitFilter {
  type?: AdminUnitType;
  era?: AdminEra;
  parentId?: string;
}

/** Read port for administrative units. */
export interface AdminUnitRepository {
  /** Every matching unit, sorted by Arabic name (then id). */
  list(filter: AdminUnitFilter): Promise<AdminUnit[]>;
  findById(id: Id<'AdminUnit'>): Promise<AdminUnit | undefined>;
  findByCode(code: string): Promise<AdminUnit | undefined>;
}

/** Injection token of the {@link AdminUnitRepository} (the cached one in the app). */
export const ADMIN_UNIT_REPOSITORY = Symbol('ADMIN_UNIT_REPOSITORY');
