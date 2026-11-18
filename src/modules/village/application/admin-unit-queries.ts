import { Inject, Injectable } from '@nestjs/common';
import { asId } from '../../../shared/kernel';
import {
  ADMIN_UNIT_REPOSITORY,
  type AdminUnit,
  type AdminUnitFilter,
  type AdminUnitRepository,
} from '../domain/admin-unit';

/**
 * Administrative units for other modules (and this module's controller).
 * Reads go through the in-process cache.
 */
@Injectable()
export class AdminUnitQueries {
  constructor(@Inject(ADMIN_UNIT_REPOSITORY) private readonly units: AdminUnitRepository) {}

  /** Whether an administrative unit with this id exists. */
  async exists(id: string): Promise<boolean> {
    return (await this.findById(id)) !== undefined;
  }

  /** One unit by id, or `undefined`. */
  findById(id: string): Promise<AdminUnit | undefined> {
    return this.units.findById(asId<'AdminUnit'>(id));
  }

  /** One unit by its stable code (e.g. `nablus`), or `undefined`. */
  findByCode(code: string): Promise<AdminUnit | undefined> {
    return this.units.findByCode(code);
  }

  /** Every unit that matches all given filters, sorted by Arabic name. */
  list(filter: AdminUnitFilter): Promise<AdminUnit[]> {
    return this.units.list(filter);
  }
}
