import { Inject, Injectable } from '@nestjs/common';
import type { Page } from '../../../shared/kernel';
import type { Claim } from '../domain/claim';
import {
  CLAIM_REPOSITORY,
  type ClaimRepository,
  type ReviewQueueQuery,
} from '../domain/claim.repository';

/** The editors' review queue: unverified or disputed claims, oldest first. */
@Injectable()
export class ListReviewQueue {
  constructor(@Inject(CLAIM_REPOSITORY) private readonly claims: ClaimRepository) {}

  execute(query: ReviewQueueQuery): Promise<Page<Claim>> {
    return this.claims.listReviewQueue(query);
  }
}
