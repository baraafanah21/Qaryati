import { Inject, Injectable } from '@nestjs/common';
import { NotFoundError } from '../../../shared/kernel';
import { VillageQueries } from '../../village';
import { GEOCODING_PORT, type GeocodeCandidate, type GeocodingPort } from './geocoding.port';

/**
 * Looks up where a village may be: its preferred Arabic name, then its English
 * name when the Arabic finds nothing. Nothing is stored; an editor picks one
 * candidate and accepts it. No transaction: an external call never holds one.
 */
@Injectable()
export class SuggestVillageLocations {
  constructor(
    private readonly villages: VillageQueries,
    @Inject(GEOCODING_PORT) private readonly geocoder: GeocodingPort,
  ) {}

  async execute(villageId: string): Promise<GeocodeCandidate[]> {
    const village = await this.villages.findById(villageId);
    if (!village) throw new NotFoundError(`Village ${villageId} does not exist.`);
    return this.geocoder.search({
      name: village.displayNameAr,
      nameAlt: village.displayNameEn ?? undefined,
    });
  }
}
