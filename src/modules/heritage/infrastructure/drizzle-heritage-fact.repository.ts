import { Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { InjectModuleDb } from '../../../platform/database/database';
import { toPage, type Page } from '../../../shared/kernel';
import type {
  HeritageFactRepository,
  HeritageFactRow,
  HeritageListQuery,
} from '../domain/heritage-fact.repository';
import type { HeritageFactType, HeritageFactValues } from '../domain/heritage-fact-types';
import type { LandmarkValue } from '../domain/heritage-facts';
import {
  isCulturalCategory,
  isDatePrecision,
  isLandmarkEra,
  isLandmarkType,
} from '../domain/heritage-values';
import { findFactQuery, listFactsQueries, pointSql, preferredFactsQuery } from './heritage.sql';
import type { HeritageDb } from './persistence/heritage-db';
import { culturalItem, historicalEvent, historyOverview } from './persistence/schema';

type Raw = Record<string, unknown> & { claimId: string };

/** A stored value outside its list is a bug or a bad manual edit, not data to serve. */
function known<T>(value: unknown, guard: (v: unknown) => v is T, claimId: string): T {
  if (!guard(value)) {
    throw new Error(`Heritage fact ${claimId} has an unknown value "${String(value)}".`);
  }
  return value;
}

/** A row of `type` as its typed value, with its claim id. */
function toRow<T extends HeritageFactType>(type: T, raw: Raw): HeritageFactRow<T> {
  const { claimId } = raw;
  const text = (key: string) => raw[key] as string;
  const optional = (key: string) => (raw[key] ?? null) as string | null;
  let value: HeritageFactValues[HeritageFactType];
  switch (type) {
    case 'HISTORY_OVERVIEW':
      value = { summary: text('summary') };
      break;
    case 'HISTORICAL_EVENT':
      value = {
        title: text('title'),
        description: text('description'),
        startDate: text('startDate'),
        endDate: optional('endDate'),
        datePrecision: known(raw.datePrecision, isDatePrecision, claimId),
      };
      break;
    case 'LANDMARK': {
      const era = optional('era');
      value = {
        name: text('name'),
        landmarkType: known(raw.landmarkType, isLandmarkType, claimId),
        description: optional('description'),
        location:
          raw.latitude == null
            ? null
            : { latitude: Number(raw.latitude), longitude: Number(raw.longitude) },
        era: era === null ? null : known(era, isLandmarkEra, claimId),
      };
      break;
    }
    default:
      value = {
        category: known(raw.category, isCulturalCategory, claimId),
        name: text('name'),
        description: text('description'),
      };
  }
  return { claimId, ...value } as unknown as HeritageFactRow<T>;
}

/**
 * Drizzle implementation of {@link HeritageFactRepository}. Plain-column writes
 * use the query builder; the landmark point and every read are native SQL
 * (`heritage.sql.ts`), on purpose: `ST_MakePoint` / `ST_X` / `ST_Y`, and lists
 * joined to curation's claim fragments in their own order.
 */
@Injectable()
export class DrizzleHeritageFactRepository implements HeritageFactRepository {
  constructor(@InjectModuleDb() private readonly db: HeritageDb) {}

  async insert<T extends HeritageFactType>(
    type: T,
    claimId: string,
    value: HeritageFactValues[T],
  ): Promise<void> {
    const facts: unknown = value;
    switch (type) {
      case 'HISTORY_OVERVIEW':
        await this.db
          .insert(historyOverview)
          .values({ claimId, ...(facts as HeritageFactValues['HISTORY_OVERVIEW']) });
        return;
      case 'HISTORICAL_EVENT':
        await this.db
          .insert(historicalEvent)
          .values({ claimId, ...(facts as HeritageFactValues['HISTORICAL_EVENT']) });
        return;
      case 'LANDMARK': {
        const l = facts as LandmarkValue;
        await this.db.execute(sql`
          INSERT INTO landmark (claim_id, name, landmark_type, description, location, era)
          VALUES (${claimId}, ${l.name}, ${l.landmarkType}, ${l.description},
                  ${pointSql(l.location)}, ${l.era})`);
        return;
      }
      case 'CULTURAL_ITEM':
        await this.db
          .insert(culturalItem)
          .values({ claimId, ...(facts as HeritageFactValues['CULTURAL_ITEM']) });
        return;
    }
  }

  async update<T extends HeritageFactType>(
    type: T,
    claimId: string,
    value: HeritageFactValues[T],
  ): Promise<void> {
    const facts: unknown = value;
    switch (type) {
      case 'HISTORY_OVERVIEW':
        await this.db
          .update(historyOverview)
          .set(facts as HeritageFactValues['HISTORY_OVERVIEW'])
          .where(eq(historyOverview.claimId, claimId));
        return;
      case 'HISTORICAL_EVENT':
        await this.db
          .update(historicalEvent)
          .set(facts as HeritageFactValues['HISTORICAL_EVENT'])
          .where(eq(historicalEvent.claimId, claimId));
        return;
      case 'LANDMARK': {
        const l = facts as LandmarkValue;
        await this.db.execute(sql`
          UPDATE landmark
          SET name = ${l.name}, landmark_type = ${l.landmarkType}, description = ${l.description},
              location = ${pointSql(l.location)}, era = ${l.era}
          WHERE claim_id = ${claimId}`);
        return;
      }
      case 'CULTURAL_ITEM':
        await this.db
          .update(culturalItem)
          .set(facts as HeritageFactValues['CULTURAL_ITEM'])
          .where(eq(culturalItem.claimId, claimId));
        return;
    }
  }

  async findByClaimId<T extends HeritageFactType>(
    type: T,
    claimId: string,
  ): Promise<HeritageFactValues[T] | undefined> {
    const result = await this.db.execute<Raw>(findFactQuery(type, claimId));
    const raw = result.rows[0];
    if (!raw) return undefined;
    const row: Partial<HeritageFactRow<T>> = toRow(type, raw);
    delete row.claimId;
    return row as unknown as HeritageFactValues[T];
  }

  async list<T extends HeritageFactType>(
    query: HeritageListQuery<T>,
  ): Promise<Page<HeritageFactRow<T>>> {
    const statements = listFactsQueries(query);
    const [rows, totals] = await Promise.all([
      this.db.execute<Raw>(statements.page),
      this.db.execute<{ total: number }>(statements.count),
    ]);
    return toPage(
      rows.rows.map((raw) => toRow(query.type, raw)),
      totals.rows[0]?.total ?? 0,
      query,
    );
  }

  async preferred<T extends HeritageFactType>(
    type: T,
    villageId: string,
  ): Promise<HeritageFactRow<T>[]> {
    const result = await this.db.execute<Raw>(preferredFactsQuery(type, villageId));
    return result.rows.map((raw) => toRow(type, raw));
  }
}
