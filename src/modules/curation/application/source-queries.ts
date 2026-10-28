import { Inject, Injectable } from '@nestjs/common';
import { asId } from '../../../shared/kernel';
import { SOURCE_REPOSITORY, type SourceRepository } from '../domain/source.repository';

/** Public read-only queries exposed by the curation module. */
@Injectable()
export class SourceQueries {
  constructor(
    @Inject(SOURCE_REPOSITORY)
    private readonly repository: SourceRepository,
  ) {}

  /** Returns false when the source is missing or soft-deleted. */
  async exists(id: string): Promise<boolean> {
    return this.repository.exists(asId<'Source'>(id));
  }
}
