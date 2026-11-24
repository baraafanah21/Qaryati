import { Inject, Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { NotFoundError } from '../../../shared/kernel';
import { SourceWriter } from '../../curation';
import { VillageFactWriter, VillageQueries, type VillageFact } from '../../village';
import { GEOCODING_SOURCES, type GeocodingSources } from './geocoding-sources';
import type { GeocodeCandidate } from './geocoding.port';

/**
 * Turns a chosen candidate into a `LOCATION` claim: `APPROXIMATE` precision,
 * cited to the provider's `EXTERNAL_API` source, `providerRef` as the locator.
 * One transaction: the source (created on first use) and the claim commit
 * together, each audited by its owner. The claim stays `UNVERIFIED` until
 * another editor verifies it (four eyes); a machine answer is never published
 * on its own.
 */
@Injectable()
export class AcceptGeocodeSuggestion {
  constructor(
    private readonly villages: VillageQueries,
    private readonly sources: SourceWriter,
    private readonly facts: VillageFactWriter,
    @Inject(GEOCODING_SOURCES) private readonly providerSources: GeocodingSources,
  ) {}

  @Transactional()
  async execute(villageId: string, candidate: GeocodeCandidate): Promise<VillageFact<'LOCATION'>> {
    // Before the source, so an unknown village creates nothing.
    if (!(await this.villages.exists(villageId))) {
      throw new NotFoundError(`Village ${villageId} does not exist.`);
    }
    const cited = this.providerSources[candidate.provider];
    const source = await this.sources.findOrCreateExternalApiSource({
      provider: candidate.provider,
      url: cited.url,
      title: cited.title,
    });
    return this.facts.submitLocation(
      villageId,
      {
        latitude: candidate.latitude,
        longitude: candidate.longitude,
        precision: 'APPROXIMATE',
        description: candidate.displayName,
      },
      { sourceId: source.id, sourceLocator: candidate.providerRef },
    );
  }
}
