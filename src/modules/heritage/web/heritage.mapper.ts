import { mapPage, type Page } from '../../../shared/kernel';
import type { HeritageFact } from '../application/heritage-fact-view';
import type { HeritageFactType, HeritageFactValues } from '../domain/heritage-fact-types';

/** One fact as a flat response body: the claim fields, then the value. Dates become ISO strings. */
export type HeritageFactResponse<T extends HeritageFactType> = HeritageFactValues[T] & {
  claimId: string;
  status: string;
  isPreferred: boolean;
  sourceId: string | null;
  sourceLocator: string | null;
  supersedesId: string | null;
  createdBy: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export function toFactResponse<T extends HeritageFactType>(
  fact: HeritageFact<T>,
): HeritageFactResponse<T> {
  const { claim, value } = fact;
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
    ...value,
  };
}

export function toFactPage<T extends HeritageFactType>(
  page: Page<HeritageFact<T>>,
): Page<HeritageFactResponse<T>> {
  return mapPage(page, toFactResponse);
}
