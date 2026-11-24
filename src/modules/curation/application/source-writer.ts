import { Inject, Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { RequestContext } from '../../../platform/context/request-context';
import { ConflictError, UnauthenticatedError } from '../../../shared/kernel';
import { SOURCE_REPOSITORY, type SourceRepository } from '../domain/source.repository';
import { CreateSource } from './create-source.use-case';

/** An external API that facts can cite, identified by its URL. */
export interface ExternalApiSourceInput {
  /** Short provider name, kept as the source's publisher (for example `nominatim`). */
  provider: string;
  /** Base URL of the API; unique among sources. */
  url: string;
  /** Human-readable title, for example "OpenStreetMap Nominatim". */
  title: string;
}

/** Reliability of a machine answer nobody has checked yet (1 = weakest, 5 = strongest). */
export const EXTERNAL_API_RELIABILITY = 2;

/**
 * Public write facade for sources that other modules need. Joins the caller's
 * transaction, so the source and whatever cites it commit or roll back together.
 */
@Injectable()
export class SourceWriter {
  constructor(
    @Inject(SOURCE_REPOSITORY) private readonly sources: SourceRepository,
    private readonly createSource: CreateSource,
    private readonly context: RequestContext,
  ) {}

  /**
   * The `EXTERNAL_API` source with this URL, created on first use by the
   * current user (audited as `source.created`, like any source). Two first uses
   * at the same moment: the URL is unique, so one gets 409 and may retry.
   */
  @Transactional()
  async findOrCreateExternalApiSource(
    input: ExternalApiSourceInput,
  ): Promise<{ id: string; created: boolean }> {
    const existing = await this.sources.findByUrl(input.url);
    if (existing) {
      if (existing.data.sourceType !== 'EXTERNAL_API') {
        throw new ConflictError(
          `A source with the URL ${input.url} exists but is not an external API.`,
        );
      }
      return { id: existing.id, created: false };
    }

    const actorId = this.context.actorId;
    if (!actorId) throw new UnauthenticatedError('An authenticated user is required.');

    const created = await this.createSource.execute({
      actorId,
      data: {
        sourceType: 'EXTERNAL_API',
        title: input.title,
        author: null,
        publisher: input.provider,
        publishedYear: null,
        url: input.url,
        isbn: null,
        reliability: EXTERNAL_API_RELIABILITY,
        notes: 'Created automatically when a geocoding suggestion was accepted.',
      },
    });
    return { id: created.id, created: true };
  }
}
