import { Inject, Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { CLOCK, NotFoundError, type Clock } from '../../../shared/kernel';
import { ClaimQueries, ClaimWriter } from '../../curation';
import { VillageQueries } from '../../village';
import { populationWarnings } from '../domain/population-anomaly';
import { populationClaim } from '../domain/population-claim';
import { validatePopulation } from '../domain/population-record';
import { POPULATION_REPOSITORY, type PopulationRepository } from '../domain/population.repository';
import type { WrittenPopulationRecord } from './population-record-view';

/** A population record to submit, with its provenance. */
export interface SubmitPopulationRecordInput {
  villageId: string;
  population: number;
  referenceYear: number;
  countType: string;
  sourceId?: string | null;
  sourceLocator?: string | null;
  /** The claim this one corrects (same village, `POPULATION`). */
  supersedesId?: string | null;
}

/**
 * Submits a population record as an `UNVERIFIED` claim and its fact row in one
 * transaction. Curation's `ClaimWriter` requires the source (rule 1, 422),
 * refuses the same value from the same source for the same question (rule 2,
 * 409 from `claim_no_duplicate`) and records `claim.submitted` with the
 * village id. Rule 3 (no future year) is `validatePopulation`; rule 4 needs no
 * code: another value for the same question is just another claim, and shows up
 * in `/curation/conflicts`; rule 5 adds `ANOMALY_SUSPECTED` to the response.
 */
@Injectable()
export class SubmitPopulationRecord {
  constructor(
    @Inject(POPULATION_REPOSITORY) private readonly records: PopulationRepository,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly villages: VillageQueries,
    private readonly claimWriter: ClaimWriter,
    private readonly claims: ClaimQueries,
  ) {}

  @Transactional()
  async execute(input: SubmitPopulationRecordInput): Promise<WrittenPopulationRecord> {
    if (!(await this.villages.exists(input.villageId))) {
      throw new NotFoundError(`Village ${input.villageId} does not exist.`);
    }
    const value = validatePopulation(input, this.clock.now().getUTCFullYear());

    const { id } = await this.claimWriter.submit({
      ...populationClaim(input.villageId, value),
      villageId: input.villageId,
      sourceId: input.sourceId ?? null,
      sourceLocator: input.sourceLocator ?? null,
      supersedesId: input.supersedesId ?? null,
    });
    await this.records.insert(id, value);

    const claim = await this.claims.findById(id);
    if (!claim) throw new Error(`Claim ${id} vanished inside its own transaction.`);
    const preferred = await this.records.preferredHistory(input.villageId);
    return { claim, value, warnings: populationWarnings(value, preferred) };
  }
}
