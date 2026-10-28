import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { InjectModuleDb } from '../../../platform/database/database';
import { updateWithVersion } from '../../../platform/database/versioning';
import {
  asId,
  CLOCK,
  pageOffset,
  toPage,
  type Clock,
  type Id,
  type Page,
} from '../../../shared/kernel';
import { Source } from '../domain/source';
import type {
  SourceListQuery,
  SourceRepository,
  SourceSortField,
} from '../domain/source.repository';
import { source } from './persistence/schema';
import type { SourceDb } from './persistence/source-db';

type SourceRow = typeof source.$inferSelect;

const live = isNull(source.deletedAt);

const SORT_COLUMNS = {
  title: source.title,
  publishedYear: source.publishedYear,
  reliability: source.reliability,
  createdAt: source.createdAt,
} as const satisfies Record<SourceSortField, unknown>;

function toDomain(row: SourceRow): Source {
  return Source.restore({
    id: asId<'Source'>(row.id),
    sourceType: row.sourceType as Source['data']['sourceType'],
    title: row.title,
    author: row.author,
    publisher: row.publisher,
    publishedYear: row.publishedYear,
    url: row.url,
    isbn: row.isbn,
    reliability: row.reliability,
    notes: row.notes,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  });
}

/** Drizzle persistence adapter for the sources aggregate. */
@Injectable()
export class DrizzleSourceRepository implements SourceRepository {
  constructor(
    @InjectModuleDb() readonly db: SourceDb,
    @Inject(CLOCK) readonly clock: Clock,
  ) {}

  /** Inserts a new source into the database. */
  async insert(entity: Source): Promise<Source> {
    const now = this.clock.now();

    const [row] = await this.db
      .insert(source)
      .values({
        id: entity.id,
        ...entity.data,
        createdBy: entity.createdBy,
        updatedBy: entity.updatedBy,
        version: entity.version,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return toDomain(row as SourceRow);
  }

  /** Finds a source by ID, excluding soft-deleted sources. */
  async findById(id: Id<'Source'>): Promise<Source | undefined> {
    const row = await this.db.query.source.findFirst({
      where: and(eq(source.id, id), live),
    });

    return row ? toDomain(row) : undefined;
  }

  /** Checks whether an active source exists. */
  async exists(id: Id<'Source'>): Promise<boolean> {
    const [row] = await this.db
      .select({ id: source.id })
      .from(source)
      .where(and(eq(source.id, id), live))
      .limit(1);

    return row !== undefined;
  }

  /** Lists sources with search, filtering, sorting and pagination. */
  async list(query: SourceListQuery): Promise<Page<Source>> {
    const filters = [live];

    if (query.type) {
      filters.push(eq(source.sourceType, query.type));
    }

    // Supports both substring search and fuzzy trigram matching.
    if (query.q?.trim()) {
      const searchTerm = query.q.trim();

      filters.push(
        sql`(
          ${source.title} ILIKE ${'%' + searchTerm + '%'}
          OR ${source.title} % ${searchTerm}
        )`,
      );
    }

    const where = and(...filters);

    // Only allow sorting by explicitly supported columns.
    const order = query.sort.map((item) =>
      (item.direction === 'asc' ? asc : desc)(SORT_COLUMNS[item.field]),
    );

    const [rows, totals] = await Promise.all([
      this.db
        .select()
        .from(source)
        .where(where)
        .orderBy(...order, asc(source.id))
        .limit(query.size)
        .offset(pageOffset(query)),

      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(source)
        .where(where),
    ]);

    return toPage(rows.map(toDomain), totals[0]?.total ?? 0, query);
  }

  /**
   * Updates a source with optimistic locking.
   * The kernel handles version increment and conflict detection.
   */
  async update(entity: Source, expectedVersion: number): Promise<Source> {
    const row = await updateWithVersion(this, source, entity.id, expectedVersion, {
      ...entity.data,
      updatedBy: entity.updatedBy,
    });

    return toDomain(row);
  }
}
