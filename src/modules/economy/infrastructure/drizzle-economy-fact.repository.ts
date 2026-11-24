import { Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { InjectModuleDb } from '../../../platform/database/database';
import { toPage, type Page } from '../../../shared/kernel';
import type {
  EconomyFactRepository,
  EconomyFactRow,
  EconomyListQuery,
} from '../domain/economy-fact.repository';
import type { EconomyFactType, EconomyFactValues, FacilityValue } from '../domain/economy-facts';
import { isFacilityType, isProductSignificance } from '../domain/economy-values';
import {
  findFactQuery,
  listFactsQueries,
  pointSql,
  preferredFactsQuery,
  villageIdsWithProductQuery,
} from './economy.sql';
import type { EconomyDb } from './persistence/economy-db';
import { villageProduct } from './persistence/schema';

type Raw = Record<string, unknown> & { claimId: string };

/** A stored value outside its list is a bug or a bad manual edit, not data to serve. */
function known<T>(value: unknown, guard: (v: unknown) => v is T, claimId: string): T {
  if (!guard(value)) {
    throw new Error(`Economy fact ${claimId} has an unknown value "${String(value)}".`);
  }
  return value;
}

/** A row of `type` as its typed value, with its claim id. */
function toRow<T extends EconomyFactType>(type: T, raw: Raw): EconomyFactRow<T> {
  const { claimId } = raw;
  const value: EconomyFactValues[EconomyFactType] =
    type === 'VILLAGE_PRODUCT'
      ? {
          productId: raw.productId as string,
          significance: known(raw.significance, isProductSignificance, claimId),
        }
      : {
          facilityType: known(raw.facilityType, isFacilityType, claimId),
          name: raw.name as string,
          location:
            raw.latitude == null
              ? null
              : { latitude: Number(raw.latitude), longitude: Number(raw.longitude) },
          establishedYear: raw.establishedYear == null ? null : Number(raw.establishedYear),
        };
  return { claimId, ...value } as unknown as EconomyFactRow<T>;
}

/**
 * Drizzle implementation of {@link EconomyFactRepository}. The product row
 * uses the query builder; the facility point and every read are native SQL
 * (`economy.sql.ts`), on purpose: `ST_MakePoint` / `ST_X` / `ST_Y`, and lists
 * joined to curation's claim fragments in their own order.
 */
@Injectable()
export class DrizzleEconomyFactRepository implements EconomyFactRepository {
  constructor(@InjectModuleDb() private readonly db: EconomyDb) {}

  async insert<T extends EconomyFactType>(
    type: T,
    claimId: string,
    value: EconomyFactValues[T],
  ): Promise<void> {
    const facts: unknown = value;
    if (type === 'VILLAGE_PRODUCT') {
      await this.db
        .insert(villageProduct)
        .values({ claimId, ...(facts as EconomyFactValues['VILLAGE_PRODUCT']) });
      return;
    }
    const f = facts as FacilityValue;
    await this.db.execute(sql`
      INSERT INTO facility (claim_id, facility_type, name, location, established_year)
      VALUES (${claimId}, ${f.facilityType}, ${f.name}, ${pointSql(f.location)},
              ${f.establishedYear})`);
  }

  async update<T extends EconomyFactType>(
    type: T,
    claimId: string,
    value: EconomyFactValues[T],
  ): Promise<void> {
    const facts: unknown = value;
    if (type === 'VILLAGE_PRODUCT') {
      await this.db
        .update(villageProduct)
        .set(facts as EconomyFactValues['VILLAGE_PRODUCT'])
        .where(eq(villageProduct.claimId, claimId));
      return;
    }
    const f = facts as FacilityValue;
    await this.db.execute(sql`
      UPDATE facility
      SET facility_type = ${f.facilityType}, name = ${f.name}, location = ${pointSql(f.location)},
          established_year = ${f.establishedYear}
      WHERE claim_id = ${claimId}`);
  }

  async findByClaimId<T extends EconomyFactType>(
    type: T,
    claimId: string,
  ): Promise<EconomyFactValues[T] | undefined> {
    const result = await this.db.execute<Raw>(findFactQuery(type, claimId));
    const raw = result.rows[0];
    if (!raw) return undefined;
    const row: Partial<EconomyFactRow<T>> = toRow(type, raw);
    delete row.claimId;
    return row as unknown as EconomyFactValues[T];
  }

  async list<T extends EconomyFactType>(
    query: EconomyListQuery<T>,
  ): Promise<Page<EconomyFactRow<T>>> {
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

  async preferred<T extends EconomyFactType>(
    type: T,
    villageId: string,
  ): Promise<EconomyFactRow<T>[]> {
    const result = await this.db.execute<Raw>(preferredFactsQuery(type, villageId));
    return result.rows.map((raw) => toRow(type, raw));
  }

  async villageIdsWithProduct(productId: string): Promise<string[]> {
    const result = await this.db.execute<{ villageId: string }>(
      villageIdsWithProductQuery(productId),
    );
    return result.rows.map((row) => row.villageId);
  }
}
