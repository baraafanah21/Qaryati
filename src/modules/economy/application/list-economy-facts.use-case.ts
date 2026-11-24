import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError, toPage, type Page, type PageRequest } from '../../../shared/kernel';
import { ClaimQueries } from '../../curation';
import { PermissionChecker, Role, type AuthenticatedUser } from '../../iam';
import { VillageQueries } from '../../village';
import {
  ECONOMY_FACT_REPOSITORY,
  type EconomyClaimScope,
  type EconomyFactRepository,
} from '../domain/economy-fact.repository';
import type { EconomyFactFilters, EconomyFactType } from '../domain/economy-facts';
import type { EconomyFact } from './economy-fact-view';
import { ProductCatalog } from './product-catalog';

/** Which facts of one type to list for one village. */
export interface ListEconomyFactsInput<T extends EconomyFactType> extends PageRequest {
  villageId: string;
  type: T;
  filter: EconomyFactFilters[T];
  includeUnverified: boolean;
  user: AuthenticatedUser | undefined;
}

/**
 * The claims a reader sees. Public: the preferred ones. `includeUnverified`
 * adds every claim for EDITOR+, and only the reader's own claims for anyone
 * else logged in; anonymous readers still see the preferred ones only.
 */
export function economyScope(
  includeUnverified: boolean,
  user: AuthenticatedUser | undefined,
  isEditor: boolean,
): EconomyClaimScope {
  if (!includeUnverified || !user) return { kind: 'PREFERRED' };
  return isEditor ? { kind: 'ALL' } : { kind: 'PREFERRED_OR_OWN', userId: user.id };
}

/**
 * Lists a village's products or facilities. Two indexed queries: the page of
 * fact rows (native SQL joined to curation's claim fragment), then the
 * provenance of exactly those claims; products come from the cached catalog.
 */
@Injectable()
export class ListEconomyFacts {
  constructor(
    @Inject(ECONOMY_FACT_REPOSITORY) private readonly facts: EconomyFactRepository,
    private readonly villages: VillageQueries,
    private readonly claims: ClaimQueries,
    private readonly products: ProductCatalog,
    private readonly permissions: PermissionChecker,
  ) {}

  async execute<T extends EconomyFactType>(
    input: ListEconomyFactsInput<T>,
  ): Promise<Page<EconomyFact<T>>> {
    if (!(await this.villages.isVisibleTo(input.villageId, input.user))) {
      throw new NotFoundError(`Village ${input.villageId} does not exist.`);
    }
    const scope = economyScope(
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
    const [views, products] = await Promise.all([
      this.claims.findByIds(page.content.map((row) => row.claimId)),
      input.type === 'VILLAGE_PRODUCT' ? this.products.byId() : undefined,
    ]);
    const claims = new Map(views.map((claim) => [claim.id, claim]));
    const content = page.content.flatMap(({ claimId, ...value }) => {
      const claim = claims.get(claimId);
      if (!claim) return [];
      const product =
        'productId' in value
          ? products?.get((value as { productId: string }).productId)
          : undefined;
      return [{ claim, value, product } as unknown as EconomyFact<T>];
    });
    return toPage(content, page.page.totalElements, input);
  }
}
