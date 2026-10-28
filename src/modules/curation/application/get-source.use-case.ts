import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError, type Id } from '../../../shared/kernel';
import { Source } from '../domain/source';
import { SOURCE_REPOSITORY, type SourceRepository } from '../domain/source.repository';

/** Retrieves an active source by its identifier. */
@Injectable()
export class GetSource {
  constructor(
    @Inject(SOURCE_REPOSITORY)
    private readonly sources: SourceRepository,
  ) {}

  async execute(id: Id<'Source'>): Promise<Source> {
    const source = await this.sources.findById(id);

    if (!source) {
      throw new NotFoundError(`Source ${id} does not exist.`);
    }

    return source;
  }
}
