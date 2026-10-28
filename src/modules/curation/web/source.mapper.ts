import type { Source } from '../domain/source';
import type { SourceResponse } from './source.schemas';

/** Converts a source aggregate into an API response DTO. */
export function toSourceResponse(source: Source): SourceResponse {
  return {
    id: source.id,
    ...source.data,
    createdBy: source.createdBy,
    updatedBy: source.updatedBy,
    version: source.version,
    createdAt: source.createdAt.toISOString(),
    updatedAt: source.updatedAt.toISOString(),
  };
}
