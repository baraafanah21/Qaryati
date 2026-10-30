// Reference: copy the repository adapter: module handle, row↔aggregate mapping, sort allow-list as columns, versioned writes, native SQL via the sql template.
import { Inject, Injectable } from '@nestjs/common';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { InjectModuleDb } from '../../../src/platform/database/database';
import { deleteWithVersion, updateWithVersion } from '../../../src/platform/database/versioning';
import {
  asId,
  CLOCK,
  pageOffset,
  toPage,
  type Clock,
  type Id,
  type Page,
} from '../../../src/shared/kernel';
import { Widget } from '../domain/widget';
import type { WidgetListQuery, WidgetRepository } from '../domain/widget.repository';
import { widget } from './persistence/schema';
import type { WidgetDb } from './persistence/widget-db';

type WidgetRow = typeof widget.$inferSelect;

// The sort allow-list again, now as columns: the only way a sort field reaches SQL.
const SORT_COLUMNS = { name: widget.name, createdAt: widget.createdAt } as const;

function toDomain(row: WidgetRow): Widget {
  return Widget.restore({
    id: asId<'Widget'>(row.id),
    name: row.name,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

/**
 * Drizzle implementation of {@link WidgetRepository}. It never sees a
 * transaction: inside a `@Transactional()` use case the module handle runs
 * every query on the transaction's client by itself.
 */
@Injectable()
export class DrizzleWidgetRepository implements WidgetRepository {
  // `db` and `clock` are public so `this` can be passed to the versioned-write helpers.
  constructor(
    @InjectModuleDb() readonly db: WidgetDb,
    @Inject(CLOCK) readonly clock: Clock,
  ) {}

  async insert(entity: Widget): Promise<Widget> {
    const [row] = await this.db
      .insert(widget)
      .values({
        id: entity.id,
        name: entity.name,
        version: entity.version,
        createdAt: entity.createdAt,
        updatedAt: entity.updatedAt,
      })
      .returning();
    return toDomain(row as WidgetRow);
  }

  async findById(id: Id<'Widget'>): Promise<Widget | undefined> {
    const row = await this.db.query.widget.findFirst({ where: eq(widget.id, id) });
    return row && toDomain(row);
  }

  async list(query: WidgetListQuery): Promise<Page<Widget>> {
    const order = query.sort.map((s) =>
      (s.direction === 'asc' ? asc : desc)(SORT_COLUMNS[s.field]),
    );
    const [rows, totals] = await Promise.all([
      this.db
        .select()
        .from(widget)
        // id last, so rows with equal sort keys keep a stable order across pages.
        .orderBy(...order, asc(widget.id))
        .limit(query.size)
        .offset(pageOffset(query)),
      // Native SQL through the sql template: tables, columns and values are
      // interpolated as identifiers and parameters, never concatenated.
      this.db.execute<{ total: number }>(sql`SELECT count(*)::int AS total FROM ${widget}`),
    ]);
    return toPage(rows.map(toDomain), totals.rows[0]?.total ?? 0, query);
  }

  async update(entity: Widget, expectedVersion: number): Promise<Widget> {
    const row = await updateWithVersion(this, widget, entity.id, expectedVersion, {
      name: entity.name,
    });
    return toDomain(row);
  }

  async delete(id: Id<'Widget'>, expectedVersion: number): Promise<Widget> {
    return toDomain(await deleteWithVersion(this, widget, id, expectedVersion));
  }
}
