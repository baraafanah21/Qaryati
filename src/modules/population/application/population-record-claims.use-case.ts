import { Inject, Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { asId, CLOCK, NotFoundError, type Clock } from '../../../shared/kernel';
import { ClaimQueries, ClaimWriter, type ClaimView } from '../../curation';
import { populationWarnings } from '../domain/population-anomaly';
import { populationClaim } from '../domain/population-claim';
import { validatePopulation, type PopulationValue } from '../domain/population-record';
import { POPULATION_REPOSITORY, type PopulationRepository } from '../domain/population.repository';
import type { WrittenPopulationRecord } from './population-record-view';

/** Fields the author may change while the record is unverified; `undefined` keeps the value. */
export interface PopulationRecordChanges {
  population?: number;
  referenceYear?: number;
  countType?: string;
  sourceId?: string | null;
  sourceLocator?: string | null;
}

/** The value as the audit trail keeps it around an edit (the claim keeps only its hash). */
const snapshot = (value: PopulationValue): Record<string, unknown> => ({ ...value });

/**
 * The author's own corrections to an unverified population record: edit
 * (PATCH) and withdraw (DELETE). Curation's `ClaimWriter` enforces "author
 * only, while `UNVERIFIED`" (403 / 422), the source (rule 1), the version
 * (412) and records the audit entry.
 */
@Injectable()
export class PopulationRecordClaims {
  constructor(
    @Inject(POPULATION_REPOSITORY) private readonly records: PopulationRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly claimWriter: ClaimWriter,
    private readonly claims: ClaimQueries,
  ) {}

  @Transactional()
  async edit(input: {
    villageId: string;
    claimId: string;
    expectedVersion: number;
    changes: PopulationRecordChanges;
  }): Promise<WrittenPopulationRecord> {
    const current = await this.load(input.villageId, input.claimId);
    const { sourceId, sourceLocator, ...valueChanges } = input.changes;
    const value = validatePopulation(
      { ...current, ...valueChanges },
      this.clock.now().getUTCFullYear(),
    );
    const question = populationClaim(input.villageId, value);

    await this.claimWriter.edit(
      asId<'Claim'>(input.claimId),
      input.expectedVersion,
      { groupKey: question.groupKey, valueHash: question.valueHash, sourceId, sourceLocator },
      { before: snapshot(current), after: snapshot(value) },
    );
    await this.records.update(input.claimId, value);

    const preferred = await this.records.preferredHistory(input.villageId);
    return {
      claim: await this.view(input.claimId),
      value,
      warnings: populationWarnings(value, preferred),
    };
  }

  @Transactional()
  async withdraw(input: {
    villageId: string;
    claimId: string;
    expectedVersion: number;
  }): Promise<void> {
    await this.load(input.villageId, input.claimId);
    await this.claimWriter.withdraw(asId<'Claim'>(input.claimId), input.expectedVersion);
  }

  /** The current value; 404 unless the claim is a population record of this village. */
  private async load(villageId: string, claimId: string): Promise<PopulationValue> {
    const claim = await this.claims.findById(claimId);
    const current =
      claim?.villageId === villageId && claim.claimType === 'POPULATION'
        ? await this.records.findByClaimId(claimId)
        : undefined;
    if (!current) {
      throw new NotFoundError(`Village ${villageId} has no population record ${claimId}.`);
    }
    return current;
  }

  private async view(claimId: string): Promise<ClaimView> {
    const claim = await this.claims.findById(claimId);
    if (!claim) throw new Error(`Claim ${claimId} vanished inside its own transaction.`);
    return claim;
  }
}
