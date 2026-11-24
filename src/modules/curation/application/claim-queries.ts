import { Inject, Injectable } from '@nestjs/common';
import { asId, mapPage, type Page, type PageRequest } from '../../../shared/kernel';
import type { Claim } from '../domain/claim';
import type { ClaimStatus, ClaimType } from '../domain/claim-values';
import {
  CLAIM_REPOSITORY,
  type ClaimProvenance,
  type ClaimRepository,
} from '../domain/claim.repository';

/** What other modules may know about a claim: provenance and review state, no value. */
export interface ClaimView {
  id: string;
  claimType: ClaimType;
  villageId: string;
  groupKey: string;
  status: ClaimStatus;
  isPreferred: boolean;
  sourceId: string | null;
  sourceLocator: string | null;
  supersedesId: string | null;
  createdBy: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** The public view of a claim. */
export function toClaimView(claim: Claim): ClaimView {
  const data = claim.data;
  return {
    id: claim.id,
    claimType: data.claimType,
    villageId: data.villageId,
    groupKey: data.groupKey,
    status: data.status,
    isPreferred: data.isPreferred,
    sourceId: data.sourceId,
    sourceLocator: data.sourceLocator,
    supersedesId: data.supersedesId,
    createdBy: claim.createdBy,
    version: claim.version,
    createdAt: claim.createdAt,
    updatedAt: claim.updatedAt,
  };
}

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

  /**
   * The claims of one type about one village, oldest first. Owning modules
   * join their fact rows to this page by claim id, so they never read the
   * `claim` table themselves. `preferredOnly` is what public readers see.
   */
  async listForVillage(
    query: PageRequest & { villageId: string; claimType: ClaimType; preferredOnly: boolean },
  ): Promise<Page<ClaimView>> {
    return mapPage(await this.claims.listForVillage(query), toClaimView);
  }

  /**
   * The claims with these ids, in the order of `ids`; unknown ids are skipped.
   * For an owner that pages its fact rows itself (population orders by year)
   * and needs the provenance of exactly that page in one query.
   */
  async findByIds(ids: readonly string[]): Promise<ClaimView[]> {
    const found = await this.claims.findByIds(ids.map((id) => asId<'Claim'>(id)));
    const byId = new Map(found.map((claim) => [claim.id as string, toClaimView(claim)]));
    return ids.flatMap((id) => {
      const view = byId.get(id);
      return view ? [view] : [];
    });
  }

  /**
   * Every preferred (published) claim of a village with its source and
   * verification time, in one query, whatever the number of facts. The profile
   * (#39) joins it to the owners' fact rows by claim id.
   */
  preferredProvenanceFor(villageId: string): Promise<ClaimProvenance[]> {
    return this.claims.preferredProvenance(villageId);
  }

  /** The claim types with at least one preferred claim for a village, in no order. */
  preferredTypesFor(villageId: string): Promise<ClaimType[]> {
    return this.claims.preferredTypes(villageId);
  }

  /** One claim, or `undefined` when there is none. */
  async findById(id: string): Promise<ClaimView | undefined> {
    const claim = await this.claims.findById(asId<'Claim'>(id));
    return claim && toClaimView(claim);
  }
}
