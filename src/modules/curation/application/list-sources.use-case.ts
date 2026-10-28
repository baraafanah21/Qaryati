import { Inject, Injectable } from '@nestjs/common';
import type { Page } from '../../../shared/kernel';
import type { Source } from '../domain/source';
import {
  SOURCE_REPOSITORY,
  type SourceListQuery,
  type SourceRepository,
} from '../domain/source.repository';

/** Retrieves a paginated list of active information sources. */
@Injectable()
export class ListSources {
  constructor(
    @Inject(SOURCE_REPOSITORY)
    private readonly sources: SourceRepository,
  ) {}

  async execute(query: SourceListQuery): Promise<Page<Source>> {
    return this.sources.list(query);
  }
}
