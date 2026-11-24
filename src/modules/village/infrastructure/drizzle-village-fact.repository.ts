import { Inject, Injectable } from '@nestjs/common';
import { eq, inArray, sql } from 'drizzle-orm';
import { InjectModuleDb } from '../../../platform/database/database';
import { CLOCK, type Clock } from '../../../shared/kernel';
import {
  isLocationPrecision,
  isMeasureKind,
  isNameType,
  isRelationType,
} from '../domain/fact-values';
import type { GeoPoint } from '../domain/village';
import type {
  NearbyVillage,
  VillageFactRepository,
  VillageFactType,
  VillageFactValues,
} from '../domain/village-fact.repository';
import type { VillageNameValue } from '../domain/village-facts';
import {
  nameOrigin,
  village,
  villageAffiliation,
  villageLocation,
  villageMeasure,
  villageName,
  villageRelation,
} from './persistence/schema';
import type { VillageDb } from './persistence/village-db';

/** A stored value outside its allowed list is a bug or a bad manual edit, not data to serve. */
function known<T>(value: string, guard: (v: unknown) => v is T, claimId: string): T {
  if (!guard(value)) throw new Error(`Fact of claim ${claimId} has an unknown value "${value}".`);
  return value;
}

/** The value columns of each fact table, without the constant `claim_type`. */
const villageNameColumns = {
  claimId: villageName.claimId,
  name: villageName.name,
  nameNormalized: villageName.nameNormalized,
  lang: villageName.lang,
  nameType: villageName.nameType,
  periodFromYear: villageName.periodFromYear,
  periodToYear: villageName.periodToYear,
};
const nameOriginColumns = {
  claimId: nameOrigin.claimId,
  meaning: nameOrigin.meaning,
  originLanguage: nameOrigin.originLanguage,
  explanation: nameOrigin.explanation,
};
const villageAffiliationColumns = {
  claimId: villageAffiliation.claimId,
  adminUnitId: villageAffiliation.adminUnitId,
  validFrom: villageAffiliation.validFrom,
  validTo: villageAffiliation.validTo,
};
const villageMeasureColumns = {
  claimId: villageMeasure.claimId,
  kind: villageMeasure.kind,
  value: villageMeasure.value,
};
const villageRelationColumns = {
  claimId: villageRelation.claimId,
  relatedVillageId: villageRelation.relatedVillageId,
  relationType: villageRelation.relationType,
};

interface RawNearbyRow extends Record<string, unknown> {
  id: string;
  slug: string;
  display_name_ar: string;
  display_name_en: string | null;
  latitude: number;
  longitude: number;
  distance_meters: number;
}

/**
 * Drizzle implementation of {@link VillageFactRepository}. Plain columns go
 * through the query builder; every write or read of a geography goes through
 * native SQL (`ST_MakePoint`, `ST_DWithin`, KNN `<->`), on purpose.
 */
@Injectable()
export class DrizzleVillageFactRepository implements VillageFactRepository {
  constructor(
    @InjectModuleDb() private readonly db: VillageDb,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async insert<T extends VillageFactType>(
    type: T,
    claimId: string,
    value: VillageFactValues[T],
  ): Promise<void> {
    // `T` does not narrow `value`, so each branch names the type it stores.
    const facts: unknown = value;
    switch (type) {
      case 'VILLAGE_NAME':
        await this.db.insert(villageName).values({ claimId, ...(facts as VillageNameValue) });
        return;
      case 'NAME_ORIGIN':
        await this.db
          .insert(nameOrigin)
          .values({ claimId, ...(facts as VillageFactValues['NAME_ORIGIN']) });
        return;
      case 'AFFILIATION':
        await this.db
          .insert(villageAffiliation)
          .values({ claimId, ...(facts as VillageFactValues['AFFILIATION']) });
        return;
      case 'LOCATION': {
        const location = facts as VillageFactValues['LOCATION'];
        await this.db.execute(sql`
          INSERT INTO village_location (claim_id, point, precision, description)
          VALUES (
            ${claimId},
            ST_SetSRID(ST_MakePoint(${location.longitude}, ${location.latitude}), 4326)::geography,
            ${location.precision},
            ${location.description}
          )`);
        return;
      }
      case 'MEASURE':
        await this.db
          .insert(villageMeasure)
          .values({ claimId, ...(facts as VillageFactValues['MEASURE']) });
        return;
      case 'RELATION':
        await this.db
          .insert(villageRelation)
          .values({ claimId, ...(facts as VillageFactValues['RELATION']) });
        return;
    }
  }

  async updateName(claimId: string, value: VillageNameValue): Promise<void> {
    await this.db.update(villageName).set(value).where(eq(villageName.claimId, claimId));
  }

  async findByClaimIds<T extends VillageFactType>(
    type: T,
    claimIds: readonly string[],
  ): Promise<Map<string, VillageFactValues[T]>> {
    const values = new Map<string, VillageFactValues[T]>();
    if (claimIds.length === 0) return values;
    const ids = [...claimIds];
    const put = (claimId: string, value: VillageFactValues[VillageFactType]) =>
      values.set(claimId, value as VillageFactValues[T]);

    switch (type) {
      case 'VILLAGE_NAME': {
        const rows = await this.db
          .select(villageNameColumns)
          .from(villageName)
          .where(inArray(villageName.claimId, ids));
        for (const { claimId, ...row } of rows) {
          put(claimId, { ...row, nameType: known(row.nameType, isNameType, claimId) });
        }
        break;
      }
      case 'NAME_ORIGIN': {
        const rows = await this.db
          .select(nameOriginColumns)
          .from(nameOrigin)
          .where(inArray(nameOrigin.claimId, ids));
        for (const { claimId, ...row } of rows) put(claimId, row);
        break;
      }
      case 'AFFILIATION': {
        const rows = await this.db
          .select(villageAffiliationColumns)
          .from(villageAffiliation)
          .where(inArray(villageAffiliation.claimId, ids));
        for (const { claimId, ...row } of rows) put(claimId, row);
        break;
      }
      case 'LOCATION': {
        const rows = await this.db
          .select({
            claimId: villageLocation.claimId,
            latitude: sql<number>`ST_Y(${villageLocation.point}::geometry)`,
            longitude: sql<number>`ST_X(${villageLocation.point}::geometry)`,
            precision: villageLocation.precision,
            description: villageLocation.description,
          })
          .from(villageLocation)
          .where(inArray(villageLocation.claimId, ids));
        for (const { claimId, ...row } of rows) {
          put(claimId, { ...row, precision: known(row.precision, isLocationPrecision, claimId) });
        }
        break;
      }
      case 'MEASURE': {
        const rows = await this.db
          .select(villageMeasureColumns)
          .from(villageMeasure)
          .where(inArray(villageMeasure.claimId, ids));
        for (const { claimId, ...row } of rows) {
          put(claimId, { ...row, kind: known(row.kind, isMeasureKind, claimId) });
        }
        break;
      }
      case 'RELATION': {
        const rows = await this.db
          .select(villageRelationColumns)
          .from(villageRelation)
          .where(inArray(villageRelation.claimId, ids));
        for (const { claimId, ...row } of rows) {
          put(claimId, {
            ...row,
            relationType: known(row.relationType, isRelationType, claimId),
          });
        }
        break;
      }
    }
    return values;
  }

  async setDisplayName(villageId: string, lang: 'ar' | 'en', name: string): Promise<void> {
    await this.db
      .update(village)
      .set({
        ...(lang === 'ar' ? { displayNameAr: name } : { displayNameEn: name }),
        version: sql`${village.version} + 1`,
        updatedAt: this.clock.now(),
      })
      .where(eq(village.id, villageId));
  }

  async setLocation(villageId: string, location: GeoPoint | null): Promise<void> {
    const point =
      location === null
        ? sql`NULL`
        : sql`ST_SetSRID(ST_MakePoint(${location.longitude}, ${location.latitude}), 4326)::geography`;
    await this.db.execute(sql`
      UPDATE village
      SET location = ${point}, version = version + 1, updated_at = ${this.clock.now()}
      WHERE id = ${villageId}`);
  }

  /**
   * docs/data-model.md, "nearby villages": `ST_DWithin` filters with the GiST
   * index `village_location_gist`, `<->` orders nearest first with the same
   * index (KNN), and `ST_Distance` reports metres on the spheroid. The origin
   * is a bound point, so the planner sees a constant on the right of `<->`.
   */
  async findNearby(query: {
    origin: GeoPoint;
    excludeVillageId: string;
    radiusMeters: number;
    limit: number;
  }): Promise<NearbyVillage[]> {
    const origin = sql`ST_SetSRID(ST_MakePoint(${query.origin.longitude}, ${query.origin.latitude}), 4326)::geography`;
    const result = await this.db.execute<RawNearbyRow>(sql`
      SELECT id, slug, display_name_ar, display_name_en,
             ST_Y(location::geometry) AS latitude,
             ST_X(location::geometry) AS longitude,
             ST_Distance(location, ${origin}) AS distance_meters
      FROM village
      WHERE publication_status = 'PUBLISHED'
        AND id <> ${query.excludeVillageId}
        AND ST_DWithin(location, ${origin}, ${query.radiusMeters})
      ORDER BY location <-> ${origin}
      LIMIT ${query.limit}`);
    return result.rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      displayNameAr: row.display_name_ar,
      displayNameEn: row.display_name_en,
      location: { latitude: Number(row.latitude), longitude: Number(row.longitude) },
      distanceMeters: Math.round(Number(row.distance_meters) * 10) / 10,
    }));
  }
}
