import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError } from '../../../shared/kernel';
import type { AuthenticatedUser } from '../../iam';
import { VillageQueries } from '../../village';
import { POPULATION_REPOSITORY, type PopulationRepository } from '../domain/population.repository';
import {
  summarizePopulation,
  type PopulationChange,
  type PopulationSummary,
} from '../domain/population-stats';

/** Population statistics of one village, computed from its preferred records only. */
export interface PopulationStats {
  villageId: string;
  series: PopulationChange[];
  /** `null` when the village has no published population record. */
  summary: PopulationSummary | null;
}

/**
 * `GET /villages/{id}/population/stats`: the `lag()` series of the preferred
 * records and its summary. Readers see what the public sees: no unverified data.
 */
@Injectable()
export class GetPopulationStats {
  constructor(
    @Inject(POPULATION_REPOSITORY) private readonly records: PopulationRepository,
    private readonly villages: VillageQueries,
  ) {}

  async execute(villageId: string, user: AuthenticatedUser | undefined): Promise<PopulationStats> {
    if (!(await this.villages.isVisibleTo(villageId, user))) {
      throw new NotFoundError(`Village ${villageId} does not exist.`);
    }
    const series = await this.records.changes(villageId);
    return { villageId, series, summary: summarizePopulation(series) ?? null };
  }
}
