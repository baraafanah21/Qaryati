import { Injectable } from '@nestjs/common';
import { NotFoundError } from '../../../shared/kernel';
import { CLAIM_TYPES, ClaimQueries, type ClaimType } from '../../curation';
import { VillageQueries } from '../../village';
import { completenessOf, type Completeness } from '../domain/completeness';

/** The completeness of one village, with its id. */
export type VillageCompleteness = Completeness<ClaimType> & { villageId: string };

/**
 * Which kinds of fact a village still lacks (#39): the claim types without a
 * preferred claim, and a 0–100 score. Two queries: the village exists, then
 * the completeness query of docs/data-model.md. Every publication status
 * counts: editors use it to see what a draft still needs before publishing.
 */
@Injectable()
export class GetVillageCompleteness {
  constructor(
    private readonly villages: VillageQueries,
    private readonly claims: ClaimQueries,
  ) {}

  async execute(villageId: string): Promise<VillageCompleteness> {
    if (!(await this.villages.exists(villageId))) {
      throw new NotFoundError(`Village ${villageId} does not exist.`);
    }
    const published = await this.claims.preferredTypesFor(villageId);
    return { villageId, ...completenessOf(CLAIM_TYPES, published) };
  }
}
