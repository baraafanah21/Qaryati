import { Inject, Injectable } from '@nestjs/common';
import {
  CLOCK,
  DOMAIN_EVENT_PUBLISHER,
  type Clock,
  type DomainEventPublisher,
} from '../../../shared/kernel';
import type { PreferredClaimChange } from '../../curation';
import { currentNameLangOf } from '../domain/fact-claims';
import type { GeoPoint } from '../domain/village';
import { villageLocationChanged } from '../domain/village-events';
import {
  VILLAGE_FACT_REPOSITORY,
  type VillageFactRepository,
  type VillageFactType,
  type VillageFactValues,
} from '../domain/village-fact.repository';

/**
 * Keeps the `village` projections equal to their preferred claims
 * (docs/data-model.md, "Identity and reference tables"). Curation calls it
 * through the `ClaimTypeRegistry` **inside the review transaction**, so a
 * throw here rolls the review back and the projection never disagrees.
 */
@Injectable()
export class VillageProjector {
  constructor(
    @Inject(VILLAGE_FACT_REPOSITORY) private readonly facts: VillageFactRepository,
    @Inject(DOMAIN_EVENT_PUBLISHER) private readonly events: DomainEventPublisher,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * The preferred `CURRENT` name in `ar` or `en` changed: copy it to
   * `display_name_ar/en`. Without a replacement the name stays as it is
   * (`display_name_ar` is NOT NULL, and an empty English name helps nobody).
   */
  async nameChanged(change: PreferredClaimChange): Promise<void> {
    const lang = currentNameLangOf(change.groupKey);
    if ((lang !== 'ar' && lang !== 'en') || change.newPreferredClaimId === null) return;
    const name = await this.value('VILLAGE_NAME', change.newPreferredClaimId);
    await this.facts.setDisplayName(change.villageId, lang, name.name);
  }

  /**
   * The preferred `LOCATION` changed: copy the point to `village.location`, or
   * clear it when the question has no published answer any more, and announce
   * `village.locationChanged` (delivered after commit).
   */
  async locationChanged(change: PreferredClaimChange): Promise<void> {
    let location: GeoPoint | null = null;
    if (change.newPreferredClaimId !== null) {
      const { latitude, longitude } = await this.value('LOCATION', change.newPreferredClaimId);
      location = { latitude, longitude };
    }
    await this.facts.setLocation(change.villageId, location);
    await this.events.publish(villageLocationChanged(change.villageId, location, this.clock.now()));
  }

  /** The fact row of a preferred claim; its absence is a broken invariant, so the review rolls back. */
  private async value<T extends VillageFactType>(
    type: T,
    claimId: string,
  ): Promise<VillageFactValues[T]> {
    const value = (await this.facts.findByClaimIds(type, [claimId])).get(claimId);
    if (!value) throw new Error(`Preferred ${type} claim ${claimId} has no fact row.`);
    return value;
  }
}
