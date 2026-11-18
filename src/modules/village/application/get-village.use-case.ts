import { Inject, Injectable } from '@nestjs/common';
import { asId, NotFoundError } from '../../../shared/kernel';
import type { AuthenticatedUser } from '../../iam';
import type { Village } from '../domain/village';
import { VILLAGE_REPOSITORY, type VillageRepository } from '../domain/village.repository';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads one village by id or slug, as visible to `user` (anonymous: published only). */
@Injectable()
export class GetVillage {
  constructor(@Inject(VILLAGE_REPOSITORY) private readonly villages: VillageRepository) {}

  async execute(idOrSlug: string, user: AuthenticatedUser | undefined): Promise<Village> {
    const village = UUID.test(idOrSlug)
      ? await this.villages.findById(asId<'Village'>(idOrSlug.toLowerCase()))
      : await this.villages.findBySlug(idOrSlug);
    // A hidden draft answers like a missing one, so its existence does not leak.
    if (!village?.isVisibleTo(user)) {
      throw new NotFoundError(`Village ${idOrSlug} does not exist.`);
    }
    return village;
  }
}
