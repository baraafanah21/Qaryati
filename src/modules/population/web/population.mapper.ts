import { mapPage, type Page } from '../../../shared/kernel';
import type {
  PopulationRecord,
  WrittenPopulationRecord,
} from '../application/population-record-view';
import type {
  PopulationRecordResponse,
  WrittenPopulationRecordResponse,
} from './population.schemas';

/** One record as a flat response body: the claim fields, then the value. Dates become ISO strings. */
export function toRecordResponse(record: PopulationRecord): PopulationRecordResponse {
  const { claim, value } = record;
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
    population: value.population,
    referenceYear: value.referenceYear,
    countType: value.countType,
  };
}

/** A submitted or edited record, with its warnings. */
export function toWrittenResponse(
  record: WrittenPopulationRecord,
): WrittenPopulationRecordResponse {
  return { ...toRecordResponse(record), warnings: record.warnings };
}

/** A page of records. */
export function toRecordPage(page: Page<PopulationRecord>): Page<PopulationRecordResponse> {
  return mapPage(page, toRecordResponse);
}
