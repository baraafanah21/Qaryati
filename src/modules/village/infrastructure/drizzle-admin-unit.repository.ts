import { Injectable } from '@nestjs/common';
import { and, asc, eq, type SQL } from 'drizzle-orm';
import { InjectModuleDb } from '../../../platform/database/database';
import { asId, type Id } from '../../../shared/kernel';
import type { AdminUnit, AdminUnitFilter, AdminUnitRepository } from '../domain/admin-unit';
import { isAdminEra, isAdminUnitType, isAuthorityType } from '../domain/admin-unit-values';
import { adminUnit } from './persistence/schema';
import type { VillageDb } from './persistence/village-db';

type AdminUnitRow = typeof adminUnit.$inferSelect;

function toDomain(row: AdminUnitRow): AdminUnit {
  // Plain text columns without CHECK: an unknown value is a bad edit, not data to serve.
  if (
    !isAdminUnitType(row.unitType) ||
    !isAdminEra(row.era) ||
    (row.authorityType !== null && !isAuthorityType(row.authorityType))
  ) {
    throw new Error(`Administrative unit ${row.id} has an unknown type, era or authority type.`);
  }
  return {
    id: asId<'AdminUnit'>(row.id),
    code: row.code,
    parentId: row.parentId,
    unitType: row.unitType,
    authorityType: row.authorityType,
    era: row.era,
    nameAr: row.nameAr,
    nameEn: row.nameEn,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Reads administrative units from PostgreSQL (wrapped by the in-process cache in the app). */
@Injectable()
export class DrizzleAdminUnitRepository implements AdminUnitRepository {
  constructor(@InjectModuleDb() private readonly db: VillageDb) {}

  async list(filter: AdminUnitFilter): Promise<AdminUnit[]> {
    const conditions: SQL[] = [];
    if (filter.type) conditions.push(eq(adminUnit.unitType, filter.type));
    if (filter.era) conditions.push(eq(adminUnit.era, filter.era));
    if (filter.parentId) conditions.push(eq(adminUnit.parentId, filter.parentId));
    const rows = await this.db
      .select()
      .from(adminUnit)
      .where(and(...conditions))
      .orderBy(asc(adminUnit.nameAr), asc(adminUnit.id));
    return rows.map(toDomain);
  }

  async findById(id: Id<'AdminUnit'>): Promise<AdminUnit | undefined> {
    const [row] = await this.db.select().from(adminUnit).where(eq(adminUnit.id, id)).limit(1);
    return row && toDomain(row);
  }

  async findByCode(code: string): Promise<AdminUnit | undefined> {
    const [row] = await this.db.select().from(adminUnit).where(eq(adminUnit.code, code)).limit(1);
    return row && toDomain(row);
  }
}
