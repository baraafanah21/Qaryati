import { Inject, Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { NotFoundError } from '../../../shared/kernel';
import { ClaimQueries, ClaimWriter } from '../../curation';
import {
  affiliationClaim,
  locationClaim,
  measureClaim,
  nameOriginClaim,
  relationClaim,
  villageNameClaim,
  type FactClaim,
} from '../domain/fact-claims';
import { VILLAGE_REPOSITORY, type VillageRepository } from '../domain/village.repository';
import {
  VILLAGE_FACT_REPOSITORY,
  type VillageFactRepository,
  type VillageFactType,
  type VillageFactValues,
} from '../domain/village-fact.repository';
import {
  validateAffiliation,
  validateLocation,
  validateMeasure,
  validateNameOrigin,
  validateRelation,
  validateVillageName,
} from '../domain/village-facts';
import { asId } from '../../../shared/kernel';
import { AdminUnitQueries } from './admin-unit-queries';
import type { VillageFact, VillageFactInputs } from './village-fact-input';

/** A fact to submit about a village, with its provenance. */
export interface SubmitVillageFactInput<T extends VillageFactType> {
  villageId: string;
  type: T;
  value: VillageFactInputs[T];
  sourceId?: string | null;
  sourceLocator?: string | null;
  /** The claim this one corrects (same village and type). */
  supersedesId?: string | null;
}

/** A validated value and the claim it answers. */
interface PreparedFact<T extends VillageFactType> {
  value: VillageFactValues[T];
  claim: FactClaim;
}

/**
 * Submits any village fact as an `UNVERIFIED` claim: validates the value,
 * checks what it points to, then writes the claim (curation's `ClaimWriter`,
 * which records the `claim.submitted` audit entry) and the fact row in one
 * transaction. Any logged-in user may submit.
 */
@Injectable()
export class SubmitVillageFact {
  constructor(
    @Inject(VILLAGE_REPOSITORY) private readonly villages: VillageRepository,
    @Inject(VILLAGE_FACT_REPOSITORY) private readonly facts: VillageFactRepository,
    private readonly adminUnits: AdminUnitQueries,
    private readonly claimWriter: ClaimWriter,
    private readonly claims: ClaimQueries,
  ) {}

  @Transactional()
  async execute<T extends VillageFactType>(
    input: SubmitVillageFactInput<T>,
  ): Promise<VillageFact<T>> {
    if (!(await this.villages.exists(asId<'Village'>(input.villageId)))) {
      throw new NotFoundError(`Village ${input.villageId} does not exist.`);
    }
    const prepared = await this.prepare(input.villageId, input.type, input.value);

    const { id } = await this.claimWriter.submit({
      ...prepared.claim,
      villageId: input.villageId,
      sourceId: input.sourceId ?? null,
      sourceLocator: input.sourceLocator ?? null,
      supersedesId: input.supersedesId ?? null,
    });
    await this.facts.insert(input.type, id, prepared.value);

    const claim = await this.claims.findById(id);
    if (!claim) throw new Error(`Claim ${id} vanished inside its own transaction.`);
    return { claim, value: prepared.value };
  }

  /** Validates the value of `type` and builds its question and hash. */
  private async prepare<T extends VillageFactType>(
    villageId: string,
    type: T,
    raw: VillageFactInputs[T],
  ): Promise<PreparedFact<T>> {
    const prepared = await this.prepareAny(villageId, { type, raw } as AnyInput);
    return prepared as PreparedFact<T>;
  }

  private async prepareAny(
    villageId: string,
    input: AnyInput,
  ): Promise<PreparedFact<VillageFactType>> {
    switch (input.type) {
      case 'VILLAGE_NAME': {
        const value = validateVillageName(input.raw);
        return { value, claim: villageNameClaim(villageId, value) };
      }
      case 'NAME_ORIGIN': {
        const value = validateNameOrigin(input.raw);
        return { value, claim: nameOriginClaim(villageId, value) };
      }
      case 'AFFILIATION': {
        const value = validateAffiliation(input.raw);
        const unit = await this.adminUnits.findById(value.adminUnitId);
        if (!unit)
          throw new NotFoundError(`Administrative unit ${value.adminUnitId} does not exist.`);
        return {
          value,
          claim: affiliationClaim(villageId, { ...value, unitType: unit.unitType, era: unit.era }),
        };
      }
      case 'LOCATION': {
        const value = validateLocation(input.raw);
        return { value, claim: locationClaim(villageId, value) };
      }
      case 'MEASURE': {
        const value = validateMeasure(input.raw);
        return { value, claim: measureClaim(villageId, value) };
      }
      case 'RELATION': {
        const value = validateRelation(villageId, input.raw);
        if (!(await this.villages.exists(asId<'Village'>(value.relatedVillageId)))) {
          throw new NotFoundError(`Village ${value.relatedVillageId} does not exist.`);
        }
        return { value, claim: relationClaim(villageId, value) };
      }
    }
  }
}

/** The input of one type, as a discriminated union so each branch is typed. */
type AnyInput = { [T in VillageFactType]: { type: T; raw: VillageFactInputs[T] } }[VillageFactType];
