import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError, toPage, type Page, type PageRequest } from '../../../shared/kernel';
import { ClaimQueries } from '../../curation';
import { PermissionChecker, Role, type AuthenticatedUser } from '../../iam';
import { VillageQueries } from '../../village';
import {
  POPULATION_REPOSITORY,
  type PopulationClaimScope,
  type PopulationRepository,
} from '../domain/population.repository';
import type { PopulationRecord } from './population-record-view';

/** Which records of a village to list. */
export interface ListPopulationRecordsInput extends PageRequest {
  villageId: string;
  includeUnverified: boolean;
  user: AuthenticatedUser | undefined;
}

/**
 * The claims a reader sees. Public: the preferred ones. `includeUnverified`
 * adds every claim for EDITOR+, and only the reader's own claims for anyone
 * else logged in (an author follows their submissions); anonymous readers
 * have no claims of their own, so they still see the preferred ones only.
 */
export function populationScope(
  includeUnverified: boolean,
  user: AuthenticatedUser | undefined,
  isEditor: boolean,
): PopulationClaimScope {
  if (!includeUnverified || !user) return { kind: 'PREFERRED' };
  return isEditor ? { kind: 'ALL' } : { kind: 'PREFERRED_OR_OWN', userId: user.id };
}

/**
 * Lists a village's population records ordered by year. Two indexed queries:
 * the page of fact rows (native SQL joined to curation's claim fragment), then
 * the provenance of exactly those claims.
 */
@Injectable()
export class ListPopulationRecords {
  constructor(
    @Inject(POPULATION_REPOSITORY) private readonly records: PopulationRepository,
    private readonly villages: VillageQueries,
    private readonly claims: ClaimQueries,
    private readonly permissions: PermissionChecker,
  ) {}

  async execute(input: ListPopulationRecordsInput): Promise<Page<PopulationRecord>> {
    if (!(await this.villages.isVisibleTo(input.villageId, input.user))) {
      throw new NotFoundError(`Village ${input.villageId} does not exist.`);
    }
    const scope = populationScope(
      input.includeUnverified,
      input.user,
      this.permissions.hasRole(input.user, Role.EDITOR),
    );
    const page = await this.records.listForVillage({
      villageId: input.villageId,
      scope,
      page: input.page,
      size: input.size,
    });
    const views = new Map(
      (await this.claims.findByIds(page.content.map((row) => row.claimId))).map((claim) => [
        claim.id,
        claim,
      ]),
    );
    const content = page.content.flatMap(({ claimId, ...value }) => {
      const claim = views.get(claimId);
      return claim ? [{ claim, value }] : [];
    });
    return toPage(content, page.page.totalElements, input);
  }
}
