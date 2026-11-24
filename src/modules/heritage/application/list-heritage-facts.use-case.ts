import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError, toPage, type Page, type PageRequest } from '../../../shared/kernel';
import { ClaimQueries } from '../../curation';
import { PermissionChecker, Role, type AuthenticatedUser } from '../../iam';
import { VillageQueries } from '../../village';
import {
  HERITAGE_FACT_REPOSITORY,
  type HeritageClaimScope,
  type HeritageFactRepository,
} from '../domain/heritage-fact.repository';
import type { HeritageFactFilters, HeritageFactType } from '../domain/heritage-fact-types';
import type { HeritageFact } from './heritage-fact-view';

/** Which facts of one type to list for one village. */
export interface ListHeritageFactsInput<T extends HeritageFactType> extends PageRequest {
  villageId: string;
  type: T;
  filter: HeritageFactFilters[T];
  includeUnverified: boolean;
  user: AuthenticatedUser | undefined;
}

/**
 * The claims a reader sees. Public: the preferred ones. `includeUnverified`
 * adds every claim for EDITOR+, and only the reader's own claims for anyone
 * else logged in (an author follows their submissions); anonymous readers
 * still see the preferred ones only.
 */
export function heritageScope(
  includeUnverified: boolean,
  user: AuthenticatedUser | undefined,
  isEditor: boolean,
): HeritageClaimScope {
  if (!includeUnverified || !user) return { kind: 'PREFERRED' };
  return isEditor ? { kind: 'ALL' } : { kind: 'PREFERRED_OR_OWN', userId: user.id };
}

/**
 * Lists one type of heritage fact of a village, in its own order (events by
 * start date). Two indexed queries: the page of fact rows (native SQL joined
 * to curation's claim fragment), then the provenance of exactly those claims.
 */
@Injectable()
export class ListHeritageFacts {
  constructor(
    @Inject(HERITAGE_FACT_REPOSITORY) private readonly facts: HeritageFactRepository,
    private readonly villages: VillageQueries,
    private readonly claims: ClaimQueries,
    private readonly permissions: PermissionChecker,
  ) {}

  async execute<T extends HeritageFactType>(
    input: ListHeritageFactsInput<T>,
  ): Promise<Page<HeritageFact<T>>> {
    if (!(await this.villages.isVisibleTo(input.villageId, input.user))) {
      throw new NotFoundError(`Village ${input.villageId} does not exist.`);
    }
    const scope = heritageScope(
      input.includeUnverified,
      input.user,
      this.permissions.hasRole(input.user, Role.EDITOR),
    );
    const page = await this.facts.list({
      type: input.type,
      villageId: input.villageId,
      scope,
      filter: input.filter,
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
      return claim ? [{ claim, value } as unknown as HeritageFact<T>] : [];
    });
    return toPage(content, page.page.totalElements, input);
  }
}
