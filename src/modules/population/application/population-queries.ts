import { Inject, Injectable } from '@nestjs/common';
import { ValidationError, FieldErrorCode } from '../../../shared/kernel';
import {
  POPULATION_REPOSITORY,
  type PopulationRecordRow,
  type PopulationRepository,
} from '../domain/population.repository';
import { MAX_LATEST_VILLAGE_IDS } from '../domain/population-values';

/** A published population record, as other modules see it. */
export type PopulationRecordView = PopulationRecordRow;

/**
 * Public read facade of the population module (profile, #39). Only preferred
 * (published) records, so callers never have to filter by review state.
 */
@Injectable()
export class PopulationQueries {
  constructor(@Inject(POPULATION_REPOSITORY) private readonly records: PopulationRepository) {}

  /**
   * The latest published record of each village, by village id; villages
   * without one are absent. One `DISTINCT ON (village_id)` statement for the
   * whole list; on equal years a census beats a register beats an estimate.
   * At most {@link MAX_LATEST_VILLAGE_IDS} ids (one page of villages).
   */
  latestFor(villageIds: readonly string[]): Promise<Map<string, PopulationRecordView>> {
    if (villageIds.length > MAX_LATEST_VILLAGE_IDS) {
      throw new ValidationError('Too many villages.', [
        {
          field: 'villageIds',
          code: FieldErrorCode.TOO_MANY,
          message: `At most ${MAX_LATEST_VILLAGE_IDS} villages.`,
        },
      ]);
    }
    return this.records.latestPreferred([...new Set(villageIds)]);
  }

  /** Every published record of a village, ordered by year. */
  historyFor(villageId: string): Promise<PopulationRecordView[]> {
    return this.records.preferredHistory(villageId);
  }
}
