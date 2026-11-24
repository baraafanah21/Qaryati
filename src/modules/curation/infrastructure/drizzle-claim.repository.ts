import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, sql, type SQL } from 'drizzle-orm';

import { InjectModuleDb } from '../../../platform/database/database';
import { updateWithVersion } from '../../../platform/database/versioning';
import { findPgError } from '../../../platform/http/problem-details';

import {
  asId,
  CLOCK,
  ConflictError,
  ErrorCode,
  pageOffset,
  toPage,
  type Clock,
  type Id,
  type Page,
} from '../../../shared/kernel';

import { Claim } from '../domain/claim';
import type { ClaimType } from '../domain/claim-values';
import type {
  ClaimConflict,
  ClaimRepository,
  ConflictQuery,
  ReviewQueueQuery,
  VillageClaimsQuery,
} from '../domain/claim.repository';

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

/**
 * A `claim` row as native SQL returns it: snake_case columns, and timestamps
 * as text (Drizzle's node-postgres driver turns off pg's date parsing).
 */
interface RawClaimRow extends Record<string, unknown> {
  id: string;
  claim_type: string;
  village_id: string;
  group_key: string;
  value_hash: string;
  source_id: string | null;
  source_locator: string | null;
  status: string;
  is_preferred: boolean;
  supersedes_id: string | null;
  created_by: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

function rawToDomain(row: RawClaimRow): Claim {
  return toDomain({
    id: row.id,
    claimType: row.claim_type,
    villageId: row.village_id,
    groupKey: row.group_key,
    valueHash: row.value_hash,
    sourceId: row.source_id,
    sourceLocator: row.source_locator,
    status: row.status,
    isPreferred: row.is_preferred,
    supersedesId: row.supersedes_id,
    createdBy: row.created_by,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at === null ? null : new Date(row.reviewed_at),
    reviewNote: row.review_note,
    version: row.version,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  });
}

interface RawConflictRow extends Record<string, unknown> {
  group_key: string;
  village_id: string;
  claim_type: string;
  distinct_values: number;
  claim_count: number;
  claim_ids: string[];
}

/** Optional `claim_type` and `village_id` filters, ANDed onto `base`. */
function claimFilters(base: SQL, query: { claimType?: ClaimType; villageId?: string }): SQL {
  const filters = [base];

  if (query.claimType) {
    filters.push(sql`claim_type = ${query.claimType}`);
  }

  if (query.villageId) {
    filters.push(sql`village_id = ${query.villageId}`);
  }

  return sql.join(filters, sql` AND `);
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

  /** Uses the partial unique index `claim_one_preferred (group_key) WHERE is_preferred`. */
  async hasPreferredForGroup(groupKey: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: claim.id })
      .from(claim)
      .where(and(eq(claim.groupKey, groupKey), eq(claim.isPreferred, true)))
      .limit(1);

    return row !== undefined;
  }

  /** Reads `claim_one_preferred`; at most one row per question. */
  async findPreferredForGroup(groupKey: string): Promise<Claim | undefined> {
    const [row] = await this.db
      .select()
      .from(claim)
      .where(and(eq(claim.groupKey, groupKey), eq(claim.isPreferred, true)))
      .limit(1);

    return row ? toDomain(row) : undefined;
  }

  /**
   * Oldest first. A preferred-only read repeats the predicate of the partial
   * index `claim_village_published (village_id, claim_type) WHERE is_preferred`.
   */
  async listForVillage(query: VillageClaimsQuery): Promise<Page<Claim>> {
    const filters = [eq(claim.villageId, query.villageId), eq(claim.claimType, query.claimType)];
    if (query.preferredOnly) {
      filters.push(eq(claim.isPreferred, true));
    }
    const where = and(...filters);

    const [rows, [totals]] = await Promise.all([
      this.db
        .select()
        .from(claim)
        .where(where)
        .orderBy(asc(claim.createdAt), asc(claim.id))
        .limit(query.size)
        .offset(pageOffset(query)),
      this.db.select({ total: count() }).from(claim).where(where),
    ]);

    return toPage(rows.map(toDomain), totals?.total ?? 0, query);
  }

  /**
   * Oldest first. The literal `status IN (...)` repeats the predicate of the
   * partial index `claim_review_queue (status, created_at)` so the planner can
   * always use it, whatever plan it builds for the bound status.
   */
  async listReviewQueue(query: ReviewQueueQuery): Promise<Page<Claim>> {
    const where = claimFilters(
      sql`status IN ('UNVERIFIED', 'DISPUTED') AND status = ${query.status}`,
      query,
    );

    const [rows, totals] = await Promise.all([
      this.db.execute<RawClaimRow>(sql`
        SELECT * FROM claim
        WHERE ${where}
        ORDER BY created_at, id
        LIMIT ${query.size} OFFSET ${pageOffset(query)}`),
      this.db.execute<{ total: number }>(sql`
        SELECT count(*)::int AS total FROM claim WHERE ${where}`),
    ]);

    return toPage(rows.rows.map(rawToDomain), totals.rows[0]?.total ?? 0, query);
  }

  /**
   * "Conflicts are computed, never stored" (docs/data-model.md): questions
   * with more than one distinct value among live claims. `group_key` starts
   * with the type prefix and the village id, so grouping also by village and
   * type does not split a question.
   */
  async listConflicts(query: ConflictQuery): Promise<Page<ClaimConflict>> {
    const where = claimFilters(sql`status IN ('UNVERIFIED', 'VERIFIED', 'DISPUTED')`, query);

    const conflicts = sql`
      SELECT group_key, village_id, claim_type,
             count(DISTINCT value_hash)::int AS distinct_values,
             count(*)::int AS claim_count,
             array_agg(id::text ORDER BY created_at, id) AS claim_ids
      FROM claim
      WHERE ${where}
      GROUP BY group_key, village_id, claim_type
      HAVING count(DISTINCT value_hash) > 1`;

    const [rows, totals] = await Promise.all([
      this.db.execute<RawConflictRow>(sql`
        ${conflicts}
        ORDER BY group_key
        LIMIT ${query.size} OFFSET ${pageOffset(query)}`),
      this.db.execute<{ total: number }>(sql`
        SELECT count(*)::int AS total FROM (${conflicts}) AS conflict`),
    ]);

    const content = rows.rows.map((row): ClaimConflict => ({
      groupKey: row.group_key,
      villageId: row.village_id,
      claimType: row.claim_type as ClaimType,
      distinctValues: row.distinct_values,
      claimCount: row.claim_count,
      claimIds: row.claim_ids,
    }));

    return toPage(content, totals.rows[0]?.total ?? 0, query);
  }

  /**
   * Updates a claim with optimistic locking.
   * The shared versioning helper handles version changes and conflicts.
   */
  async update(entity: Claim, expectedVersion: number): Promise<Claim> {
    try {
      const row = await updateWithVersion(this, claim, entity.id, expectedVersion, {
        ...entity.data,
      });

      return toDomain(row);
    } catch (error) {
      const pg = findPgError(error);

      // Another editor published a different answer to this question first.
      if (pg?.code === '23505' && pg.constraint === 'claim_one_preferred') {
        throw new ConflictError(
          'Another claim of this question became preferred at the same time. Reload and retry.',
          { code: ErrorCode.VERSION_CONFLICT, cause: error },
        );
      }

      throw error;
    }
  }
}
