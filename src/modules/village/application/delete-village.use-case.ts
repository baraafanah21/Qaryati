import { Inject, Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { AUDIT_RECORDER, type AuditRecorder, type Id } from '../../../shared/kernel';
import { VILLAGE_REPOSITORY, type VillageRepository } from '../domain/village.repository';

/**
 * Hard-deletes a village (ADMIN only, for spam or personal data). Archiving is
 * the normal way to hide one. A village that still has claims fails with 409
 * `REFERENCE_CONFLICT` from the `claim.village_id` foreign key (`RESTRICT`).
 */
@Injectable()
export class DeleteVillage {
  constructor(
    @Inject(VILLAGE_REPOSITORY) private readonly villages: VillageRepository,
    @Inject(AUDIT_RECORDER) private readonly audit: AuditRecorder,
  ) {}

  @Transactional()
  async execute(input: { id: Id<'Village'>; expectedVersion: number }): Promise<void> {
    const deleted = await this.villages.delete(input.id, input.expectedVersion);
    await this.audit.record({
      action: 'village.deleted',
      entityType: 'Village',
      entityId: input.id,
      villageId: input.id,
      before: deleted.snapshot(),
    });
  }
}
