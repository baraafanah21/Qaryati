import { Inject, Injectable } from '@nestjs/common';
import { asId, type Page } from '../../../shared/kernel';
import type { AuthenticatedUser } from '../../iam';
import type { GeoPoint } from '../domain/village';
import { VILLAGE_REPOSITORY, type VillageRepository } from '../domain/village.repository';
import type { VillageSearchHit } from '../domain/village-search';
import type { PublicationStatus, SettlementStatus } from '../domain/village-values';
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

/**
 * Public read facade of the village module. Fact modules call
 * {@link VillageQueries.exists} before `ClaimWriter.submit`, so a claim for a
 * missing village is a 404 rather than a foreign key 409.
 */
@Injectable()
export class VillageQueries {
  constructor(
    @Inject(VILLAGE_REPOSITORY) private readonly villages: VillageRepository,
    private readonly searchVillages: SearchVillages,
  ) {}

  /** Whether a village with this id exists, in any publication status. */
  exists(id: string): Promise<boolean> {
    return this.villages.exists(asId<'Village'>(id));
  }

  /** The village identity and projections, or `undefined` when there is none. */
  async findById(id: string): Promise<VillageView | undefined> {
    const village = await this.villages.findById(asId<'Village'>(id));
    if (!village) return undefined;
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
