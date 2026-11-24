import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError, type Id } from '../../../shared/kernel';
import type { Claim } from '../domain/claim';
import { CLAIM_REPOSITORY, type ClaimRepository } from '../domain/claim.repository';

/** Returns one claim with its review state, for editors. */
@Injectable()
export class GetClaim {
  constructor(@Inject(CLAIM_REPOSITORY) private readonly claims: ClaimRepository) {}

  async execute(id: Id<'Claim'>): Promise<Claim> {
    const found = await this.claims.findById(id);

    if (!found) {
      throw new NotFoundError(`Claim ${id} does not exist.`);
    }

    return found;
  }
}
