import { NotFoundError, type Id } from '../../../shared/kernel';
import type { Village } from '../domain/village';
import type { VillageRepository } from '../domain/village.repository';

/** Loads a village for a write or throws 404. */
export async function loadVillage(
  villages: VillageRepository,
  id: Id<'Village'>,
): Promise<Village> {
  const village = await villages.findById(id);
  if (!village) throw new NotFoundError(`Village ${id} does not exist.`);
  return village;
}
