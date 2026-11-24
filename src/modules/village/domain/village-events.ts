import type { DomainEvent } from '../../../shared/kernel';
import type { GeoPoint } from './village';

/** Name listeners subscribe to: `@OnDomainEvent(VILLAGE_LOCATION_CHANGED)`. */
export const VILLAGE_LOCATION_CHANGED = 'village.locationChanged';

/**
 * The `location` projection of a village changed because its preferred
 * `LOCATION` claim changed. `location` is null when the village no longer has
 * a published location. Delivered after the review transaction commits.
 */
export type VillageLocationChanged = DomainEvent<
  typeof VILLAGE_LOCATION_CHANGED,
  { location: GeoPoint | null }
>;

/** Builds the event for one village. */
export function villageLocationChanged(
  villageId: string,
  location: GeoPoint | null,
  occurredAt: Date,
): VillageLocationChanged {
  return {
    name: VILLAGE_LOCATION_CHANGED,
    occurredAt,
    aggregateId: villageId,
    payload: { location },
  };
}
