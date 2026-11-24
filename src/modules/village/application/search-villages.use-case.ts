import { Inject, Injectable } from '@nestjs/common';
import {
  asId,
  FieldErrorCode,
  toPage,
  ValidationError,
  type Page,
  type PageRequest,
  type Sort,
} from '../../../shared/kernel';
import { PermissionChecker, Role, type AuthenticatedUser } from '../../iam';
import {
  ADMIN_UNIT_REPOSITORY,
  type AdminUnit,
  type AdminUnitRepository,
} from '../domain/admin-unit';
import { normalizeName } from '../domain/name-normalizer';
import { VILLAGE_REPOSITORY, type VillageRepository } from '../domain/village.repository';
import {
  resolveVillageSort,
  visiblePublicationStatus,
  type VillageSearchHit,
  type VillageSortField,
} from '../domain/village-search';
import type { PublicationStatus, SettlementStatus } from '../domain/village-values';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Parameters of a village search, from `GET /villages` or from another module's facade call. */
export interface SearchVillagesInput extends PageRequest {
  /** Free text; normalized with `normalizeName` before it reaches SQL. */
  q?: string;
  /** Id or code of a `GOVERNORATE` admin unit. */
  governorate?: string;
  settlementStatus?: SettlementStatus;
  /** Honoured for editors only; everyone else searches published villages. */
  publicationStatus?: PublicationStatus;
  /** Only these villages (at most 100): `?ids=`, and economy's product filter. */
  villageIds?: readonly string[];
  /** Empty means the default: relevance with `q`, otherwise the Arabic name. */
  sort: Sort<VillageSortField>[];
  viewer: AuthenticatedUser | undefined;
}

/**
 * Searches, filters, sorts and pages villages (#30) in one SQL statement plus
 * its count. Read-only, so no transaction: the two statements may see
 * different snapshots, which only skews the total by a concurrent write.
 */
@Injectable()
export class SearchVillages {
  constructor(
    @Inject(VILLAGE_REPOSITORY) private readonly villages: VillageRepository,
    @Inject(ADMIN_UNIT_REPOSITORY) private readonly units: AdminUnitRepository,
    private readonly permissions: PermissionChecker,
  ) {}

  async execute(input: SearchVillagesInput): Promise<Page<VillageSearchHit>> {
    const q = input.q === undefined ? undefined : normalizeName(input.q);
    // Nothing can match: punctuation-only text, or an empty id list from a caller.
    if (q === '' || input.villageIds?.length === 0) return toPage([], 0, input);

    const governorate =
      input.governorate === undefined ? undefined : await this.governorate(input.governorate);

    return this.villages.search({
      q,
      governorateId: governorate?.id,
      settlementStatus: input.settlementStatus,
      publicationStatus: visiblePublicationStatus(
        this.permissions.hasRole(input.viewer, Role.EDITOR),
        input.publicationStatus,
      ),
      villageIds: input.villageIds,
      sort: resolveVillageSort(input.sort, q !== undefined),
      page: input.page,
      size: input.size,
    });
  }

  /** The governorate by id or code; anything else is a 422 on the field, not an empty page. */
  private async governorate(idOrCode: string): Promise<AdminUnit> {
    const unit = UUID.test(idOrCode)
      ? await this.units.findById(asId<'AdminUnit'>(idOrCode.toLowerCase()))
      : await this.units.findByCode(idOrCode);
    if (unit?.unitType !== 'GOVERNORATE') {
      throw new ValidationError('The governorate does not exist.', [
        {
          field: 'governorate',
          code: FieldErrorCode.INVALID_VALUE,
          message:
            'Use the id or code of a governorate (GET /api/v1/admin-units?type=GOVERNORATE).',
        },
      ]);
    }
    return unit;
  }
}
