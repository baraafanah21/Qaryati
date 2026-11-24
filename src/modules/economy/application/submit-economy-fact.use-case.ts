import { Inject, Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { CLOCK, NotFoundError, type Clock } from '../../../shared/kernel';
import { ClaimQueries, ClaimWriter } from '../../curation';
import { VillageQueries } from '../../village';
import { prepareEconomyFact } from '../domain/economy-claims';
import {
  ECONOMY_FACT_REPOSITORY,
  type EconomyFactRepository,
} from '../domain/economy-fact.repository';
import type { EconomyFactInputs, EconomyFactType } from '../domain/economy-facts';
import type { EconomyFact } from './economy-fact-view';
import { ProductCatalog } from './product-catalog';

/** An economy fact to submit about a village, with its provenance. */
export interface SubmitEconomyFactInput<T extends EconomyFactType> {
  villageId: string;
  type: T;
  value: EconomyFactInputs[T];
  sourceId?: string | null;
  sourceLocator?: string | null;
  /** The claim this one corrects (same village and type). */
  supersedesId?: string | null;
}

/** The current UTC year, from the `Clock` (latest allowed `established_year`). */
export const currentYear = (clock: Clock): number => clock.now().getUTCFullYear();

/**
 * Submits a village product or a facility as an `UNVERIFIED` claim: the
 * village must exist (404), a product must exist (404), the value is
 * validated (422), then the claim (curation's `ClaimWriter`: source checks,
 * 409 for a duplicate, `claim.submitted` audit entry with the village id) and
 * the fact row are written in one transaction. Any logged-in user may submit.
 */
@Injectable()
export class SubmitEconomyFact {
  constructor(
    @Inject(ECONOMY_FACT_REPOSITORY) private readonly facts: EconomyFactRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly villages: VillageQueries,
    private readonly products: ProductCatalog,
    private readonly claimWriter: ClaimWriter,
    private readonly claims: ClaimQueries,
  ) {}

  @Transactional()
  async execute<T extends EconomyFactType>(
    input: SubmitEconomyFactInput<T>,
  ): Promise<EconomyFact<T>> {
    if (!(await this.villages.exists(input.villageId))) {
      throw new NotFoundError(`Village ${input.villageId} does not exist.`);
    }
    const prepared = prepareEconomyFact(
      input.type,
      input.villageId,
      input.value,
      currentYear(this.clock),
    );
    const product =
      input.type === 'VILLAGE_PRODUCT'
        ? await this.products.get((prepared.value as { productId: string }).productId)
        : undefined;

    const { id } = await this.claimWriter.submit({
      ...prepared.claim,
      villageId: input.villageId,
      sourceId: input.sourceId ?? null,
      sourceLocator: input.sourceLocator ?? null,
      supersedesId: input.supersedesId ?? null,
    });
    await this.facts.insert(input.type, id, prepared.value);

    const claim = await this.claims.findById(id);
    if (!claim) throw new Error(`Claim ${id} vanished inside its own transaction.`);
    return { claim, value: prepared.value, product };
  }
}
