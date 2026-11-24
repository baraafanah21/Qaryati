import { Inject, Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { asId, CLOCK, NotFoundError, type Clock } from '../../../shared/kernel';
import { ClaimQueries, ClaimWriter, type ClaimView } from '../../curation';
import {
  HERITAGE_FACT_REPOSITORY,
  type HeritageFactRepository,
} from '../domain/heritage-fact.repository';
import type { HeritageFactType, HeritageFactValues } from '../domain/heritage-fact-types';
import { prepareHeritageFact, type HeritageFactInputs } from '../domain/prepare-heritage-fact';
import type { HeritageFact } from './heritage-fact-view';
import { isoToday } from './submit-heritage-fact.use-case';

/** Fields the author may change while the fact is unverified; an absent field keeps its value. */
export type HeritageFactChanges<T extends HeritageFactType> = Partial<HeritageFactInputs[T]> & {
  sourceId?: string | null;
  sourceLocator?: string | null;
};

/**
 * The author's own corrections to an unverified heritage fact: edit (PATCH)
 * and withdraw (DELETE). Curation's `ClaimWriter` enforces "author only, while
 * `UNVERIFIED`" (403 / 422), the source rule, the version (412) and records
 * the audit entry; an edit keeps the value before and after as `fact`.
 */
@Injectable()
export class HeritageFactClaims {
  constructor(
    @Inject(HERITAGE_FACT_REPOSITORY) private readonly facts: HeritageFactRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly claimWriter: ClaimWriter,
    private readonly claims: ClaimQueries,
  ) {}

  @Transactional()
  async edit<T extends HeritageFactType>(input: {
    villageId: string;
    type: T;
    claimId: string;
    expectedVersion: number;
    changes: HeritageFactChanges<T>;
  }): Promise<HeritageFact<T>> {
    const current = await this.load(input.villageId, input.type, input.claimId);
    const { sourceId, sourceLocator, ...valueChanges } = input.changes;
    const prepared = prepareHeritageFact(
      input.type,
      input.villageId,
      { ...current, ...valueChanges },
      isoToday(this.clock),
    );

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
    return { claim, value: prepared.value };
  }

  @Transactional()
  async withdraw(input: {
    villageId: string;
    type: HeritageFactType;
    claimId: string;
    expectedVersion: number;
  }): Promise<void> {
    await this.load(input.villageId, input.type, input.claimId);
    await this.claimWriter.withdraw(asId<'Claim'>(input.claimId), input.expectedVersion);
  }

  /** The current value; 404 unless the claim is a fact of `type` about this village. */
  private async load<T extends HeritageFactType>(
    villageId: string,
    type: T,
    claimId: string,
  ): Promise<HeritageFactValues[T]> {
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
