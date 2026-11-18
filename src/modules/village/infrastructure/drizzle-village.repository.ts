import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { InjectModuleDb } from '../../../platform/database/database';
import { deleteWithVersion, updateWithVersion } from '../../../platform/database/versioning';
import { asId, CLOCK, type Clock, type Id } from '../../../shared/kernel';
import { Village } from '../domain/village';
import type { VillageRepository } from '../domain/village.repository';
import { isPublicationStatus, isSettlementStatus } from '../domain/village-values';
import { village } from './persistence/schema';
import type { VillageDb } from './persistence/village-db';

type VillageRow = Omit<typeof village.$inferSelect, 'location'>;

// The geography projection is read as plain coordinates; everything else as stored.
const columns = {
  id: village.id,
  slug: village.slug,
  settlementStatus: village.settlementStatus,
  publicationStatus: village.publicationStatus,
  displayNameAr: village.displayNameAr,
  displayNameEn: village.displayNameEn,
  createdBy: village.createdBy,
  version: village.version,
  createdAt: village.createdAt,
  updatedAt: village.updatedAt,
  latitude: sql<number | null>`ST_Y(${village.location}::geometry)`,
  longitude: sql<number | null>`ST_X(${village.location}::geometry)`,
};

function toDomain(
  row: VillageRow & { latitude?: number | null; longitude?: number | null },
): Village {
  // The columns are plain text: an unknown value is a bug or a bad manual edit, not data to serve.
  if (!isSettlementStatus(row.settlementStatus) || !isPublicationStatus(row.publicationStatus)) {
    throw new Error(`Village ${row.id} has an unknown status value.`);
  }
  return Village.restore({
    id: asId<'Village'>(row.id),
    slug: row.slug,
    settlementStatus: row.settlementStatus,
    publicationStatus: row.publicationStatus,
    displayNameAr: row.displayNameAr,
    displayNameEn: row.displayNameEn,
    location:
      row.latitude != null && row.longitude != null
        ? { latitude: row.latitude, longitude: row.longitude }
        : null,
    createdBy: row.createdBy,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

/** Drizzle implementation of {@link VillageRepository}. */
@Injectable()
export class DrizzleVillageRepository implements VillageRepository {
  // Public so `this` can be passed to the versioned-write helpers.
  constructor(
    @InjectModuleDb() readonly db: VillageDb,
    @Inject(CLOCK) readonly clock: Clock,
  ) {}

  async insert(entity: Village): Promise<Village> {
    await this.db.insert(village).values({
      id: entity.id,
      slug: entity.slug,
      settlementStatus: entity.settlementStatus,
      publicationStatus: entity.publicationStatus,
      displayNameAr: entity.displayNameAr,
      displayNameEn: entity.displayNameEn,
      createdBy: entity.createdBy,
      version: entity.version,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    });
    return entity;
  }

  async findById(id: Id<'Village'>): Promise<Village | undefined> {
    const [row] = await this.db.select(columns).from(village).where(eq(village.id, id)).limit(1);
    return row && toDomain(row);
  }

  async findBySlug(slug: string): Promise<Village | undefined> {
    const [row] = await this.db
      .select(columns)
      .from(village)
      .where(eq(village.slug, slug))
      .limit(1);
    return row && toDomain(row);
  }

  async existsBySlug(slug: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: village.id })
      .from(village)
      .where(eq(village.slug, slug))
      .limit(1);
    return row !== undefined;
  }

  async exists(id: Id<'Village'>): Promise<boolean> {
    const [row] = await this.db
      .select({ id: village.id })
      .from(village)
      .where(eq(village.id, id))
      .limit(1);
    return row !== undefined;
  }

  async update(entity: Village, expectedVersion: number): Promise<Village> {
    const row = await updateWithVersion(this, village, entity.id, expectedVersion, {
      settlementStatus: entity.settlementStatus,
      publicationStatus: entity.publicationStatus,
      displayNameAr: entity.displayNameAr,
      displayNameEn: entity.displayNameEn,
    });
    // The location projection is not written here, so the one already read stays correct.
    return toDomain({
      ...row,
      latitude: entity.location?.latitude,
      longitude: entity.location?.longitude,
    });
  }

  async delete(id: Id<'Village'>, expectedVersion: number): Promise<Village> {
    return toDomain(await deleteWithVersion(this, village, id, expectedVersion));
  }
}
