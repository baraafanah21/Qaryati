import { Inject, Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { asId, NotFoundError, type Id } from '../../../shared/kernel';
import { ClaimQueries, ClaimWriter, type ClaimView } from '../../curation';
import { villageNameClaim } from '../domain/fact-claims';
import {
  VILLAGE_FACT_REPOSITORY,
  type VillageFactRepository,
} from '../domain/village-fact.repository';
import { validateVillageName, type VillageNameValue } from '../domain/village-facts';
import type { VillageFact, VillageFactInputs } from './village-fact-input';

/** Fields of a name the author may change while it is unverified; `undefined` keeps the value. */
export type VillageNameChanges = Partial<VillageFactInputs['VILLAGE_NAME']> & {
  sourceId?: string | null;
  sourceLocator?: string | null;
};

/** The fields of a name the audit trail keeps around an edit. */
function nameSnapshot(value: VillageNameValue): Record<string, unknown> {
  return {
    name: value.name,
    lang: value.lang,
    nameType: value.nameType,
    periodFromYear: value.periodFromYear,
    periodToYear: value.periodToYear,
  };
}

/**
 * The author's own corrections to an unverified name claim: edit (PATCH) and
 * withdraw (DELETE). Curation's `ClaimWriter` enforces "author only, while
 * `UNVERIFIED`" (403 / 422), the version (412) and records the audit entry.
 */
@Injectable()
export class VillageNameClaims {
  constructor(
    @Inject(VILLAGE_FACT_REPOSITORY) private readonly facts: VillageFactRepository,
    private readonly claimWriter: ClaimWriter,
    private readonly claims: ClaimQueries,
  ) {}

  @Transactional()
  async edit(input: {
    villageId: string;
    claimId: string;
    expectedVersion: number;
    changes: VillageNameChanges;
  }): Promise<VillageFact<'VILLAGE_NAME'>> {
    const { current } = await this.load(input.villageId, input.claimId);
    const { sourceId, sourceLocator, ...valueChanges } = input.changes;
    const value = validateVillageName({ ...current, ...valueChanges });
    const question = villageNameClaim(input.villageId, value);

    await this.claimWriter.edit(
      asId<'Claim'>(input.claimId),
      input.expectedVersion,
      { groupKey: question.groupKey, valueHash: question.valueHash, sourceId, sourceLocator },
      // The claim keeps only the hash: the audit entry keeps the name before and after.
      { before: nameSnapshot(current), after: nameSnapshot(value) },
    );
    await this.facts.updateName(input.claimId, value);
    return { claim: await this.view(input.claimId), value };
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

  /** The name claim and its value; 404 unless it is a name of this village. */
  private async load(
    villageId: string,
    claimId: string,
  ): Promise<{ claim: ClaimView; current: VillageNameValue }> {
    const claim = await this.claims.findById(claimId);
    const current =
      claim?.villageId === villageId && claim.claimType === 'VILLAGE_NAME'
        ? (await this.facts.findByClaimIds('VILLAGE_NAME', [claimId])).get(claimId)
        : undefined;
    if (!claim || !current) {
      throw new NotFoundError(`Village ${villageId} has no name claim ${claimId}.`);
    }
    return { claim, current };
  }

  private async view(claimId: Id<'Claim'> | string): Promise<ClaimView> {
    const claim = await this.claims.findById(claimId);
    if (!claim) throw new Error(`Claim ${claimId} vanished inside its own transaction.`);
    return claim;
  }
}
