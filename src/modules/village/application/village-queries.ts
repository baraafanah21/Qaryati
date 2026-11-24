import { Inject, Injectable } from '@nestjs/common';
import { asId, type Page } from '../../../shared/kernel';
import type { AuthenticatedUser } from '../../iam';
import type { GeoPoint, Village } from '../domain/village';
import { VILLAGE_REPOSITORY, type VillageRepository } from '../domain/village.repository';
import {
  VILLAGE_FACT_REPOSITORY,
  type VillageFactRepository,
  type VillageFactType,
  type VillageFactValues,
} from '../domain/village-fact.repository';
import type { VillageSearchHit } from '../domain/village-search';
import type { PublicationStatus, SettlementStatus } from '../domain/village-values';
import { GetVillage } from './get-village.use-case';
import { SearchVillages, type SearchVillagesInput } from './search-villages.use-case';

/** What other modules may know about a village: its identity and projections. */
export interface VillageView {
  id: string;
  slug: string;
  settlementStatus: SettlementStatus;
  publicationStatus: PublicationStatus;
  displayNameAr: string;
  displayNameEn: string | null;
  location: GeoPoint | null;
  createdBy: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

function toView(village: Village): VillageView {
  return {
    id: village.id,
    slug: village.slug,
    settlementStatus: village.settlementStatus,
    publicationStatus: village.publicationStatus,
    displayNameAr: village.displayNameAr,
    displayNameEn: village.displayNameEn,
    location: village.location,
    createdBy: village.createdBy,
    version: village.version,
    createdAt: village.createdAt,
    updatedAt: village.updatedAt,
  };
}

/**
 * Public read facade of the village module. Fact modules call
 * {@link VillageQueries.exists} before `ClaimWriter.submit`, so a claim for a
 * missing village is a 404 rather than a foreign key 409.
 */
@Injectable()
export class VillageQueries {
  constructor(
    @Inject(VILLAGE_REPOSITORY) private readonly villages: VillageRepository,
    @Inject(VILLAGE_FACT_REPOSITORY) private readonly facts: VillageFactRepository,
    private readonly searchVillages: SearchVillages,
    private readonly getVillage: GetVillage,
  ) {}

  /** Whether a village with this id exists, in any publication status. */
  exists(id: string): Promise<boolean> {
    return this.villages.exists(asId<'Village'>(id));
  }

  /** The village identity and projections, or `undefined` when there is none. */
  async findById(id: string): Promise<VillageView | undefined> {
    const village = await this.villages.findById(asId<'Village'>(id));
    return village && toView(village);
  }

  /**
   * The village by id or slug as `GET /villages/{idOrSlug}` resolves it: one
   * query, and a 404 `NotFoundError` when it is missing or hidden from `user`
   * (anonymous readers see published villages only).
   */
  async findVisible(idOrSlug: string, user: AuthenticatedUser | undefined): Promise<VillageView> {
    return toView(await this.getVillage.execute(idOrSlug, user));
  }

  /**
   * The villages with these ids that `user` may see, in no particular order;
   * unknown and hidden ids are absent. One query, whatever the number of ids.
   */
  async findVisibleByIds(
    ids: readonly string[],
    user: AuthenticatedUser | undefined,
  ): Promise<VillageView[]> {
    const villages = await this.villages.findByIds(ids.map((id) => asId<'Village'>(id)));
    return villages.filter((village) => village.isVisibleTo(user)).map(toView);
  }

  /**
   * The stored values of village fact claims of one type, by claim id: one
   * query per call, whatever the number of ids. Callers pass the ids of the
   * claims they may show (the profile passes preferred claims only).
   */
  factValues<T extends VillageFactType>(
    type: T,
    claimIds: readonly string[],
  ): Promise<Map<string, VillageFactValues[T]>> {
    return this.facts.findByClaimIds(type, claimIds);
  }

  /**
   * Whether `user` may see the village: anonymous readers see published
   * villages only, logged-in users see every status. False when it is missing.
   */
  async isVisibleTo(id: string, user: AuthenticatedUser | undefined): Promise<boolean> {
    const village = await this.villages.findById(asId<'Village'>(id));
    return village?.isVisibleTo(user) ?? false;
  }

  /**
   * The search of `GET /villages`, with the same parameters and rules (#30).
   * `villageIds` lets a module that owns a filter village cannot see (economy:
   * villages that produce a product) narrow the search without village
   * importing it; filtering, sorting and paging stay in one SQL statement.
   */
  search(input: SearchVillagesInput): Promise<Page<VillageSearchHit>> {
    return this.searchVillages.execute(input);
  }
}
