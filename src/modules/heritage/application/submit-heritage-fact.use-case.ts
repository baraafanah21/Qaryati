import { Inject, Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { CLOCK, NotFoundError, type Clock } from '../../../shared/kernel';
import { ClaimQueries, ClaimWriter } from '../../curation';
import { VillageQueries } from '../../village';
import {
  HERITAGE_FACT_REPOSITORY,
  type HeritageFactRepository,
} from '../domain/heritage-fact.repository';
import type { HeritageFactType } from '../domain/heritage-fact-types';
import { prepareHeritageFact, type HeritageFactInputs } from '../domain/prepare-heritage-fact';
import type { HeritageFact } from './heritage-fact-view';

/** A heritage fact to submit about a village, with its provenance. */
export interface SubmitHeritageFactInput<T extends HeritageFactType> {
  villageId: string;
  type: T;
  value: HeritageFactInputs[T];
  sourceId?: string | null;
  sourceLocator?: string | null;
  /** The claim this one corrects (same village and type). */
  supersedesId?: string | null;
}

/** Today as `YYYY-MM-DD` in UTC, from the `Clock`. */
export const isoToday = (clock: Clock): string => clock.now().toISOString().slice(0, 10);

/**
 * Submits any heritage fact as an `UNVERIFIED` claim: the village must exist
 * (404), the value is validated (422), then the claim (curation's
 * `ClaimWriter`: source checks, `HISTORICAL_EVENT` needs one, 409 for a
 * duplicate, `claim.submitted` audit entry with the village id) and the fact
 * row are written in one transaction. Any logged-in user may submit.
 */
@Injectable()
export class SubmitHeritageFact {
  constructor(
    @Inject(HERITAGE_FACT_REPOSITORY) private readonly facts: HeritageFactRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly villages: VillageQueries,
    private readonly claimWriter: ClaimWriter,
    private readonly claims: ClaimQueries,
  ) {}

  @Transactional()
  async execute<T extends HeritageFactType>(
    input: SubmitHeritageFactInput<T>,
  ): Promise<HeritageFact<T>> {
    if (!(await this.villages.exists(input.villageId))) {
      throw new NotFoundError(`Village ${input.villageId} does not exist.`);
    }
    const prepared = prepareHeritageFact(
      input.type,
      input.villageId,
      input.value,
      isoToday(this.clock),
    );

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
    return { claim, value: prepared.value };
  }
}
