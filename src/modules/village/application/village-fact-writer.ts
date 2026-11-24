import { Injectable } from '@nestjs/common';
import type { VillageFact } from './village-fact-input';
import { SubmitVillageFact } from './submit-village-fact.use-case';

/** Where a submitted fact comes from. */
export interface FactProvenance {
  sourceId: string | null;
  sourceLocator: string | null;
}

/** A location as another module submits it, before the village domain validates it. */
export interface LocationInput {
  latitude: number;
  longitude: number;
  precision: string;
  description?: string | null;
}

/**
 * Public write facade for village facts that other modules submit. It runs the
 * same use case as `PUT /villages/{id}/location`: domain rules, `ClaimWriter`
 * (with its `claim.submitted` audit entry) and the fact row, joining the
 * caller's transaction. The claim starts `UNVERIFIED`.
 */
@Injectable()
export class VillageFactWriter {
  constructor(private readonly submitFact: SubmitVillageFact) {}

  /** Submits a `LOCATION` claim; 404 for an unknown village, 422 for an invalid value. */
  submitLocation(
    villageId: string,
    location: LocationInput,
    provenance: FactProvenance,
  ): Promise<VillageFact<'LOCATION'>> {
    return this.submitFact.execute({
      villageId,
      type: 'LOCATION',
      value: location,
      sourceId: provenance.sourceId,
      sourceLocator: provenance.sourceLocator,
    });
  }
}
