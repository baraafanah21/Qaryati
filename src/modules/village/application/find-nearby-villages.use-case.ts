import { Inject, Injectable } from '@nestjs/common';
import { asId, BusinessRuleViolationError, NotFoundError } from '../../../shared/kernel';
import type { AuthenticatedUser } from '../../iam';
import { VILLAGE_REPOSITORY, type VillageRepository } from '../domain/village.repository';
import {
  VILLAGE_FACT_REPOSITORY,
  type NearbyVillage,
  type VillageFactRepository,
} from '../domain/village-fact.repository';

/**
 * Published villages near one village, nearest first, from the `location`
 * projection (GiST index, native SQL). The starting village must be visible to
 * the caller and have a published location.
 */
@Injectable()
export class FindNearbyVillages {
  constructor(
    @Inject(VILLAGE_REPOSITORY) private readonly villages: VillageRepository,
    @Inject(VILLAGE_FACT_REPOSITORY) private readonly facts: VillageFactRepository,
  ) {}

  async execute(input: {
    villageId: string;
    radiusKm: number;
    limit: number;
    user: AuthenticatedUser | undefined;
  }): Promise<NearbyVillage[]> {
    const village = await this.villages.findById(asId<'Village'>(input.villageId));
    if (!village?.isVisibleTo(input.user)) {
      throw new NotFoundError(`Village ${input.villageId} does not exist.`);
    }
    if (!village.location) {
      throw new BusinessRuleViolationError(
        'This village has no published location yet, so nothing can be measured from it.',
      );
    }
    return this.facts.findNearby({
      origin: village.location,
      excludeVillageId: village.id,
      radiusMeters: input.radiusKm * 1000,
      limit: input.limit,
    });
  }
}
