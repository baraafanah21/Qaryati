import { z } from 'zod';
import { pageResponse, paginationQuery, sortQuery } from '../../../platform/http/pagination';
import { SOURCE_TYPES } from '../domain/source';

// Basic request validation.
// The domain handles the full business rules.
const sourceType = z.enum(SOURCE_TYPES);

const sourceFields = {
  sourceType,
  title: z.string().min(1).max(300),
  author: z.string().nullable(),
  publisher: z.string().nullable(),
  publishedYear: z.int().nullable(),
  url: z.string().max(2048).nullable(),
  isbn: z.string().nullable(),
  reliability: z.int().min(1).max(5),
  notes: z.string().max(2000).nullable(),
};

// Create a new source.
// Optional nullable fields become null when omitted.
export const createSourceBody = z.strictObject({
  sourceType: sourceFields.sourceType,
  title: sourceFields.title,
  author: sourceFields.author.optional().default(null),
  publisher: sourceFields.publisher.optional().default(null),
  publishedYear: sourceFields.publishedYear.optional().default(null),
  url: sourceFields.url.optional().default(null),
  isbn: sourceFields.isbn.optional().default(null),
  reliability: sourceFields.reliability,
  notes: sourceFields.notes.optional().default(null),
});

export type CreateSourceBody = z.infer<typeof createSourceBody>;

// PATCH accepts only provided fields.
// Identity, version and ownership cannot be changed here.
export const updateSourceBody = z.strictObject(sourceFields).partial();

export type UpdateSourceBody = z.infer<typeof updateSourceBody>;

// Search, filtering, sorting and pagination.
export const listSourcesQuery = paginationQuery.extend({
  q: z.string().trim().optional(),
  type: sourceType.optional(),
  sort: sortQuery(
    ['title', 'publishedYear', 'reliability', 'createdAt'],
    [{ field: 'createdAt', direction: 'desc' }],
  ),
});

export type ListSourcesQuery = z.infer<typeof listSourcesQuery>;

// Public representation of a stored source.
export const sourceResponse = z
  .strictObject({
    id: z.uuid(),
    sourceType,
    title: z.string(),
    author: z.string().nullable(),
    publisher: z.string().nullable(),
    publishedYear: z.number().int().nullable(),
    url: z.string().nullable(),
    isbn: z.string().nullable(),
    reliability: z.number().int().min(1).max(5),
    notes: z.string().nullable(),
    createdBy: z.uuid(),
    updatedBy: z.uuid(),
    version: z.int().min(1),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'SourceResponse' });

export type SourceResponse = z.infer<typeof sourceResponse>;

export const sourcePageResponse = pageResponse(sourceResponse).meta({ id: 'SourcePage' });
