import { Inject, Injectable } from '@nestjs/common';
import { CLAIM_REPOSITORY, type ClaimRepository } from '../domain/claim.repository';

/** Public read-only claim queries for other modules. */
@Injectable()
export class ClaimQueries {
  constructor(@Inject(CLAIM_REPOSITORY) private readonly claims: ClaimRepository) {}

  /**
   * Whether the question `groupKey` (built by the owning module with
   * `buildGroupKey`) already has a preferred, published claim.
   */
  hasPreferredForGroup(groupKey: string): Promise<boolean> {
    return this.claims.hasPreferredForGroup(groupKey);
  }
}
