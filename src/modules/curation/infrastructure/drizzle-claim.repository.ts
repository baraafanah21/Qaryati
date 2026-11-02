import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { InjectModuleDb } from '../../../platform/database/database';
import { updateWithVersion } from '../../../platform/database/versioning';

import { asId, CLOCK, type Clock, type Id } from '../../../shared/kernel';

import { Claim } from '../domain/claim';
import type { ClaimRepository } from '../domain/claim.repository';

import { claim } from './persistence/schema';
import type { SourceDb } from './persistence/source-db';

type ClaimRow = typeof claim.$inferSelect;

/** Converts a persisted claim into a domain entity. */
function toDomain(row: ClaimRow): Claim {
  return Claim.restore({
    id: asId<'Claim'>(row.id),
    claimType: row.claimType as Claim['data']['claimType'],
    villageId: row.villageId,
    groupKey: row.groupKey,
    valueHash: row.valueHash,
    sourceId: row.sourceId,
    sourceLocator: row.sourceLocator,
    status: row.status as Claim['data']['status'],
    isPreferred: row.isPreferred,
    supersedesId: row.supersedesId,
    createdBy: row.createdBy,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt,
    reviewNote: row.reviewNote,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

/** Drizzle persistence adapter for claims. */
@Injectable()
export class DrizzleClaimRepository implements ClaimRepository {
  constructor(
    @InjectModuleDb() readonly db: SourceDb,
    @Inject(CLOCK) readonly clock: Clock,
  ) {}

  /** Inserts a new claim into the database. */
  async insert(entity: Claim): Promise<Claim> {
    const now = this.clock.now();

    const [row] = await this.db
      .insert(claim)
      .values({
        id: entity.id,
        ...entity.data,
        createdBy: entity.createdBy,
        version: entity.version,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return toDomain(row as ClaimRow);
  }

  /** Finds a claim by its identifier. */
  async findById(id: Id<'Claim'>): Promise<Claim | undefined> {
    const [row] = await this.db.select().from(claim).where(eq(claim.id, id)).limit(1);

    return row ? toDomain(row) : undefined;
  }

  /**
   * Updates a claim with optimistic locking.
   * The shared versioning helper handles version changes and conflicts.
   */
  async update(entity: Claim, expectedVersion: number): Promise<Claim> {
    const row = await updateWithVersion(this, claim, entity.id, expectedVersion, {
      ...entity.data,
    });

    return toDomain(row);
  }
}
