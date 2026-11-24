import type { Page } from '../../../shared/kernel';
import { mapPage } from '../../../shared/kernel';
import type { VillageFact } from '../application/village-fact-input';
import type { VillageFactType, VillageFactValues } from '../domain/village-fact.repository';

/** One fact as a flat response body: the claim fields, then the value fields. */
export type VillageFactResponse<T extends VillageFactType> = {
  claimId: string;
  status: VillageFact['claim']['status'];
  isPreferred: boolean;
  sourceId: string | null;
  sourceLocator: string | null;
  supersedesId: string | null;
  createdBy: string;
  version: number;
  createdAt: string;
  updatedAt: string;
} & VillageFactValues[T];

/** The response body for one fact. Dates become ISO strings here. */
export function toFactResponse<T extends VillageFactType>(
  fact: VillageFact<T>,
): VillageFactResponse<T> {
  const { claim } = fact;
  return {
    claimId: claim.id,
    status: claim.status,
    isPreferred: claim.isPreferred,
    sourceId: claim.sourceId,
    sourceLocator: claim.sourceLocator,
    supersedesId: claim.supersedesId,
    createdBy: claim.createdBy,
    version: claim.version,
    createdAt: claim.createdAt.toISOString(),
    updatedAt: claim.updatedAt.toISOString(),
    ...fact.value,
  };
}

/** A page of facts. */
export function toFactPage<T extends VillageFactType>(
  page: Page<VillageFact<T>>,
): Page<VillageFactResponse<T>> {
  return mapPage(page, toFactResponse);
}
