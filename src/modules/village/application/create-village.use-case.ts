import { Inject, Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import {
  AUDIT_RECORDER,
  CLOCK,
  ConflictError,
  ID_GENERATOR,
  type AuditRecorder,
  type Clock,
  type IdGenerator,
} from '../../../shared/kernel';
import type { AuthenticatedUser } from '../../iam';
import { Village } from '../domain/village';
import { VILLAGE_REPOSITORY, type VillageRepository } from '../domain/village.repository';

/** Creates a `DRAFT` village owned by the caller. */
@Injectable()
export class CreateVillage {
  constructor(
    @Inject(VILLAGE_REPOSITORY) private readonly villages: VillageRepository,
    @Inject(AUDIT_RECORDER) private readonly audit: AuditRecorder,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
  ) {}

  @Transactional()
  async execute(input: {
    slug: string;
    settlementStatus: string;
    displayNameAr: string;
    displayNameEn?: string | null;
    actor: AuthenticatedUser;
  }): Promise<Village> {
    const village = Village.create({
      id: this.ids.next<'Village'>(),
      slug: input.slug,
      settlementStatus: input.settlementStatus,
      displayNameAr: input.displayNameAr,
      displayNameEn: input.displayNameEn,
      createdBy: input.actor.id,
      now: this.clock.now(),
    });
    // A clear 409 for the common case; the unique index still decides a race (also 409).
    if (await this.villages.existsBySlug(village.slug)) {
      throw new ConflictError(`The slug ${village.slug} is already taken.`);
    }
    const stored = await this.villages.insert(village);
    await this.audit.record({
      action: 'village.created',
      entityType: 'Village',
      entityId: stored.id,
      villageId: stored.id,
      after: stored.snapshot(),
    });
    return stored;
  }
}
