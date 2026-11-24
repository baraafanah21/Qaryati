import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { InjectModuleDb } from '../../../platform/database/database';
import { toPage, type Page, type PageRequest } from '../../../shared/kernel';
import type { PopulationValue } from '../domain/population-record';
import type {
  PopulationClaimScope,
  PopulationRecordRow,
  PopulationRepository,
} from '../domain/population.repository';
import type { PopulationChange } from '../domain/population-stats';
import { isCountType, type CountType } from '../domain/population-values';
import {
  latestPreferredQuery,
  listRecordsQueries,
  populationChangesQuery,
  preferredHistoryQuery,
} from './population.sql';
import { populationRecord } from './persistence/schema';
import type { PopulationDb } from './persistence/population-db';

interface RawRecord extends Record<string, unknown> {
  claimId: string;
  population: number;
  referenceYear: number;
  countType: string;
}

/** A stored count type outside the list is a bug or a bad manual edit, not data to serve. */
function countType(value: string, claimId: string): CountType {
  if (!isCountType(value)) {
    throw new Error(`Population record ${claimId} has an unknown count type "${value}".`);
  }
  return value;
}

const toRow = (raw: RawRecord): PopulationRecordRow => ({
  claimId: raw.claimId,
  population: raw.population,
  referenceYear: raw.referenceYear,
  countType: countType(raw.countType, raw.claimId),
});

/**
 * Drizzle implementation of {@link PopulationRepository}. Single-row writes and
 * reads use the query builder; lists, `DISTINCT ON` and the `lag()` statistics
 * are native SQL from `population.sql.ts`, on purpose.
 */
@Injectable()
export class DrizzlePopulationRepository implements PopulationRepository {
  constructor(@InjectModuleDb() private readonly db: PopulationDb) {}

  async insert(claimId: string, value: PopulationValue): Promise<void> {
    await this.db.insert(populationRecord).values({ claimId, ...value });
  }

  async update(claimId: string, value: PopulationValue): Promise<void> {
    await this.db.update(populationRecord).set(value).where(eq(populationRecord.claimId, claimId));
  }

  async findByClaimId(claimId: string): Promise<PopulationValue | undefined> {
    const [row] = await this.db
      .select({
        population: populationRecord.population,
        referenceYear: populationRecord.referenceYear,
        countType: populationRecord.countType,
      })
      .from(populationRecord)
      .where(eq(populationRecord.claimId, claimId))
      .limit(1);
    return row && { ...row, countType: countType(row.countType, claimId) };
  }

  async listForVillage(
    query: PageRequest & { villageId: string; scope: PopulationClaimScope },
  ): Promise<Page<PopulationRecordRow>> {
    const statements = listRecordsQueries(query);
    const [rows, totals] = await Promise.all([
      this.db.execute<RawRecord>(statements.page),
      this.db.execute<{ total: number }>(statements.count),
    ]);
    return toPage(rows.rows.map(toRow), totals.rows[0]?.total ?? 0, query);
  }

  async preferredHistory(villageId: string): Promise<PopulationRecordRow[]> {
    const result = await this.db.execute<RawRecord>(preferredHistoryQuery(villageId));
    return result.rows.map(toRow);
  }

  async latestPreferred(villageIds: readonly string[]): Promise<Map<string, PopulationRecordRow>> {
    const latest = new Map<string, PopulationRecordRow>();
    if (villageIds.length === 0) return latest;
    const result = await this.db.execute<RawRecord & { villageId: string }>(
      latestPreferredQuery(villageIds),
    );
    for (const { villageId, ...raw } of result.rows) latest.set(villageId, toRow(raw));
    return latest;
  }

  async changes(villageId: string): Promise<PopulationChange[]> {
    const result = await this.db.execute<
      RawRecord & Omit<PopulationChange, keyof PopulationRecordRow>
    >(populationChangesQuery(villageId));
    return result.rows.map((raw) => ({
      ...toRow(raw),
      previousYear: raw.previousYear,
      previousPopulation: raw.previousPopulation,
      absoluteChange: raw.absoluteChange,
      percentChange: raw.percentChange,
      averageYearlyGrowthPercent: raw.averageYearlyGrowthPercent,
    }));
  }
}
