import type { Source } from '../domain/source';
import type { SourceResponse } from './source.schemas';

/** Converts a source aggregate into an explicit API response DTO. */
export function toSourceResponse(source: Source): SourceResponse {
  const data = source.data;

  return {
    id: source.id,
    sourceType: data.sourceType,
    title: data.title,
    author: data.author,
    publisher: data.publisher,
    publishedYear: data.publishedYear,
    url: data.url,
    isbn: data.isbn,
    reliability: data.reliability,
    notes: data.notes,
    createdBy: source.createdBy,
    version: source.version,
    createdAt: source.createdAt.toISOString(),
    updatedAt: source.updatedAt.toISOString(),
  };
}
