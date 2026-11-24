import type { GeoPoint } from './village';
import type {
  AffiliationValue,
  LocationValue,
  MeasureValue,
  NameOriginValue,
  RelationValue,
  VillageNameValue,
} from './village-facts';

/** The value of each village fact, by claim type. */
export interface VillageFactValues {
  VILLAGE_NAME: VillageNameValue;
  NAME_ORIGIN: NameOriginValue;
  AFFILIATION: AffiliationValue;
  LOCATION: LocationValue;
  MEASURE: MeasureValue;
  RELATION: RelationValue;
}

/** A claim type whose value the village module stores. */
export type VillageFactType = keyof VillageFactValues;

/** The claim types of the village module, in the order of docs/data-model.md. */
export const VILLAGE_FACT_TYPES = [
  'VILLAGE_NAME',
  'NAME_ORIGIN',
  'AFFILIATION',
  'LOCATION',
  'MEASURE',
  'RELATION',
] as const satisfies readonly VillageFactType[];

/** A village found by distance from another one. */
export interface NearbyVillage {
  id: string;
  slug: string;
  displayNameAr: string;
  displayNameEn: string | null;
  location: GeoPoint;
  distanceMeters: number;
}

/**
 * Persistence port of the village fact tables and of the projections they
 * feed. Writes run in the caller's transaction.
 */
export interface VillageFactRepository {
  /** Stores the fact row of a claim that was just submitted. */
  insert<T extends VillageFactType>(
    type: T,
    claimId: string,
    value: VillageFactValues[T],
  ): Promise<void>;

  /** Replaces the value of an unverified name claim (its author edited it). */
  updateName(claimId: string, value: VillageNameValue): Promise<void>;

  /** Fact rows of the given claims, by claim id; claims without a row are absent. */
  findByClaimIds<T extends VillageFactType>(
    type: T,
    claimIds: readonly string[],
  ): Promise<Map<string, VillageFactValues[T]>>;

  /** Sets a display-name projection (`ar` or `en`) and bumps the village version. */
  setDisplayName(villageId: string, lang: 'ar' | 'en', name: string): Promise<void>;

  /** Sets (or clears, with null) the location projection and bumps the village version. */
  setLocation(villageId: string, location: GeoPoint | null): Promise<void>;

  /**
   * Published villages within `radiusMeters` of `origin`, nearest first,
   * without `excludeVillageId` (the village the search starts from).
   */
  findNearby(query: {
    origin: GeoPoint;
    excludeVillageId: string;
    radiusMeters: number;
    limit: number;
  }): Promise<NearbyVillage[]>;
}

/** Injection token of the {@link VillageFactRepository}. */
export const VILLAGE_FACT_REPOSITORY = Symbol('VILLAGE_FACT_REPOSITORY');
