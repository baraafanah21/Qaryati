import { Inject, Injectable } from '@nestjs/common';
import {
  asId,
  ForbiddenError,
  NotFoundError,
  toPage,
  type Page,
  type PageRequest,
} from '../../../shared/kernel';
import { ClaimQueries } from '../../curation';
import { PermissionChecker, Role, type AuthenticatedUser } from '../../iam';
import { VILLAGE_REPOSITORY, type VillageRepository } from '../domain/village.repository';
import {
  VILLAGE_FACT_REPOSITORY,
  type VillageFactRepository,
  type VillageFactType,
} from '../domain/village-fact.repository';
import type { VillageFact } from './village-fact-input';

/** Which facts of one type to list for one village. */
export interface ListVillageFactsInput<T extends VillageFactType> extends PageRequest {
  villageId: string;
  type: T;
  /** EDITOR+ only: every claim of the type, with its status, not just the published ones. */
  includeUnverified: boolean;
  user: AuthenticatedUser | undefined;
}

/**
 * Lists the facts of one type about a village, oldest first. Public readers
 * see the preferred (published) claims only; editors may ask for the others
 * too. Two indexed queries: the claim page from curation, then the fact rows
 * of exactly those claims.
 */
@Injectable()
export class ListVillageFacts {
  constructor(
    @Inject(VILLAGE_REPOSITORY) private readonly villages: VillageRepository,
    @Inject(VILLAGE_FACT_REPOSITORY) private readonly facts: VillageFactRepository,
    private readonly claims: ClaimQueries,
    private readonly permissions: PermissionChecker,
  ) {}

  async execute<T extends VillageFactType>(
    input: ListVillageFactsInput<T>,
  ): Promise<Page<VillageFact<T>>> {
    if (
      input.includeUnverified &&
      !(input.user && this.permissions.hasRole(input.user, Role.EDITOR))
    ) {
      throw new ForbiddenError('Only editors may list unverified facts.');
    }
    const village = await this.villages.findById(asId<'Village'>(input.villageId));
    if (!village?.isVisibleTo(input.user)) {
      throw new NotFoundError(`Village ${input.villageId} does not exist.`);
    }

    const page = await this.claims.listForVillage({
      villageId: input.villageId,
      claimType: input.type,
      preferredOnly: !input.includeUnverified,
      page: input.page,
      size: input.size,
    });
    const values = await this.facts.findByClaimIds(
      input.type,
      page.content.map((claim) => claim.id),
    );
    // Every claim of a village fact type has its row (same transaction); a
    // claim without one was not written through this module and is skipped.
    const content = page.content.flatMap((claim) => {
      const value = values.get(claim.id);
      return value ? [{ claim, value }] : [];
    });
    return toPage(content, page.page.totalElements, input);
  }
}
