import { Inject, Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { asId, CLOCK, NotFoundError, type Clock } from '../../../shared/kernel';
import { ClaimQueries, ClaimWriter, type ClaimView } from '../../curation';
import { prepareEconomyFact } from '../domain/economy-claims';
import {
  ECONOMY_FACT_REPOSITORY,
  type EconomyFactRepository,
} from '../domain/economy-fact.repository';
import type {
  EconomyFactInputs,
  EconomyFactType,
  EconomyFactValues,
} from '../domain/economy-facts';
import type { EconomyFact } from './economy-fact-view';
import { ProductCatalog } from './product-catalog';
import { currentYear } from './submit-economy-fact.use-case';

/** Fields the author may change while the fact is unverified; an absent field keeps its value. */
export type EconomyFactChanges<T extends EconomyFactType> = Partial<EconomyFactInputs[T]> & {
  sourceId?: string | null;
  sourceLocator?: string | null;
};

/**
 * The author's own corrections to an unverified village product or facility:
 * edit (PATCH) and withdraw (DELETE). Curation's `ClaimWriter` enforces
 * "author only, while `UNVERIFIED`" (403 / 422), the version (412) and records
 * the audit entry; an edit keeps the value before and after as `fact`.
 */
@Injectable()
export class EconomyFactClaims {
  constructor(
    @Inject(ECONOMY_FACT_REPOSITORY) private readonly facts: EconomyFactRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly products: ProductCatalog,
    private readonly claimWriter: ClaimWriter,
    private readonly claims: ClaimQueries,
  ) {}

  @Transactional()
  async edit<T extends EconomyFactType>(input: {
    villageId: string;
    type: T;
    claimId: string;
    expectedVersion: number;
    changes: EconomyFactChanges<T>;
  }): Promise<EconomyFact<T>> {
    const current = await this.load(input.villageId, input.type, input.claimId);
    const { sourceId, sourceLocator, ...valueChanges } = input.changes;
    const prepared = prepareEconomyFact(
      input.type,
      input.villageId,
      { ...current, ...valueChanges },
      currentYear(this.clock),
    );
    const product =
      input.type === 'VILLAGE_PRODUCT'
        ? await this.products.get((prepared.value as { productId: string }).productId)
        : undefined;

    await this.claimWriter.edit(
      asId<'Claim'>(input.claimId),
      input.expectedVersion,
      {
        groupKey: prepared.claim.groupKey,
        valueHash: prepared.claim.valueHash,
        sourceId,
        sourceLocator,
      },
      { before: { ...current }, after: { ...prepared.value } },
    );
    await this.facts.update(input.type, input.claimId, prepared.value);

    const claim = await this.claims.findById(input.claimId);
    if (!claim) throw new Error(`Claim ${input.claimId} vanished inside its own transaction.`);
    return { claim, value: prepared.value, product };
  }

  @Transactional()
  async withdraw(input: {
    villageId: string;
    type: EconomyFactType;
    claimId: string;
    expectedVersion: number;
  }): Promise<void> {
    await this.load(input.villageId, input.type, input.claimId);
    await this.claimWriter.withdraw(asId<'Claim'>(input.claimId), input.expectedVersion);
  }

  /** The current value; 404 unless the claim is a fact of `type` about this village. */
  private async load<T extends EconomyFactType>(
    villageId: string,
    type: T,
    claimId: string,
  ): Promise<EconomyFactValues[T]> {
    const claim: ClaimView | undefined = await this.claims.findById(claimId);
    const current =
      claim?.villageId === villageId && claim.claimType === type
        ? await this.facts.findByClaimId(type, claimId)
        : undefined;
    if (!current) {
      throw new NotFoundError(`Village ${villageId} has no ${type} claim ${claimId}.`);
    }
    return current;
  }
}
