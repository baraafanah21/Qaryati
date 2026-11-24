import type { ClaimProvenance } from '../../curation';
import type {
  CulturalItemValue,
  HistoricalEventValue,
  HistoryOverviewValue,
  LandmarkValue,
} from '../../heritage';
import type { FacilityValue, Product, ProductSignificance } from '../../economy';
import type { CountType } from '../../population';
import type {
  AdminEra,
  AdminUnitType,
  LocationValue,
  MeasureValue,
  NameOriginValue,
  NameType,
  RelationType,
  VillageView,
} from '../../village';

/** Where a published fact comes from, so a reader can check it. */
export interface Provenance {
  claimId: string;
  source: ClaimProvenance['source'];
  sourceLocator: string | null;
  verifiedAt: Date | null;
}

/** A published fact: its value and its provenance. */
export type ProfileFact<V> = V & Provenance;

/** The identity of the village, as `GET /villages/{idOrSlug}` returns it. */
export type ProfileVillage = Omit<VillageView, 'createdBy'>;

export interface ProfileName {
  name: string;
  lang: string;
  nameType: NameType;
  periodFromYear: number | null;
  periodToYear: number | null;
}

export interface ProfileAffiliation {
  adminUnit: {
    id: string;
    code: string;
    unitType: AdminUnitType;
    era: AdminEra;
    nameAr: string;
    nameEn: string | null;
  };
  validFrom: string | null;
  validTo: string | null;
}

export interface ProfileRelation {
  relationType: RelationType;
  relatedVillage: { id: string; slug: string; displayNameAr: string; displayNameEn: string | null };
}

export interface ProfilePopulation {
  population: number;
  referenceYear: number;
  countType: CountType;
}

export interface ProfileProduct {
  product: Pick<Product, 'id' | 'code' | 'category' | 'nameAr' | 'nameEn'>;
  significance: ProductSignificance;
}

/**
 * Everything published about one village (#39): only preferred claims, each
 * with its provenance. Sections without a published claim are empty or null.
 */
export interface VillageProfile {
  village: ProfileVillage;
  names: ProfileFact<ProfileName>[];
  origin: ProfileFact<NameOriginValue> | null;
  affiliations: ProfileFact<ProfileAffiliation>[];
  location: ProfileFact<LocationValue> | null;
  measures: ProfileFact<MeasureValue>[];
  relations: ProfileFact<ProfileRelation>[];
  population: {
    /** The latest record; on equal years a census beats a register beats an estimate. */
    latest: ProfileFact<ProfilePopulation> | null;
    /** By year. */
    history: ProfileFact<ProfilePopulation>[];
  };
  heritage: {
    history: ProfileFact<HistoryOverviewValue> | null;
    events: ProfileFact<HistoricalEventValue>[];
    landmarks: ProfileFact<LandmarkValue>[];
    culturalItems: ProfileFact<CulturalItemValue>[];
  };
  economy: {
    products: ProfileFact<ProfileProduct>[];
    facilities: ProfileFact<FacilityValue>[];
  };
}
