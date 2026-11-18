import { Injectable } from '@nestjs/common';
import { buildGroupKey, ClaimQueries } from '../../curation';
import type { PublishedCurrentNames } from '../domain/village';

/**
 * Finds which display names of a village already come from a published
 * `CURRENT` name claim. The question of each is the group key
 * `name|<villageId>|<lang>|current` (docs/data-model.md, "Claim types").
 */
@Injectable()
export class PublishedCurrentNamesReader {
  constructor(private readonly claims: ClaimQueries) {}

  async read(villageId: string): Promise<PublishedCurrentNames> {
    const [ar, en] = await Promise.all([
      this.claims.hasPreferredForGroup(buildGroupKey('VILLAGE_NAME', villageId, 'ar', 'current')),
      this.claims.hasPreferredForGroup(buildGroupKey('VILLAGE_NAME', villageId, 'en', 'current')),
    ]);
    return { ar, en };
  }
}
