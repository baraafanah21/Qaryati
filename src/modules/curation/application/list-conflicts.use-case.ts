import { Inject, Injectable } from '@nestjs/common';
import type { Page } from '../../../shared/kernel';
import {
  CLAIM_REPOSITORY,
  type ClaimConflict,
  type ClaimRepository,
  type ConflictQuery,
} from '../domain/claim.repository';

/**
 * The editors' conflict inbox: questions whose live claims disagree. Nothing
 * is marked automatically; an editor resolves a conflict by verifying or
 * preferring one claim and rejecting or disputing the others, with a note.
 */
@Injectable()
export class ListConflicts {
  constructor(@Inject(CLAIM_REPOSITORY) private readonly claims: ClaimRepository) {}

  execute(query: ConflictQuery): Promise<Page<ClaimConflict>> {
    return this.claims.listConflicts(query);
  }
}
