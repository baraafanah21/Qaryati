import { Inject, Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import { AUDIT_RECORDER, type AuditRecorder, type Id } from '../../../shared/kernel';
import type { PublicationAction } from '../domain/publication-rules';
import type { Village } from '../domain/village';
import { VILLAGE_REPOSITORY, type VillageRepository } from '../domain/village.repository';
import { loadVillage } from './load-village';

/** Publishes or archives a village (EDITOR+, checked by the route's role guard). */
@Injectable()
export class ChangeVillagePublication {
  constructor(
    @Inject(VILLAGE_REPOSITORY) private readonly villages: VillageRepository,
    @Inject(AUDIT_RECORDER) private readonly audit: AuditRecorder,
  ) {}

  @Transactional()
  async execute(input: {
    id: Id<'Village'>;
    expectedVersion: number;
    action: PublicationAction;
  }): Promise<Village> {
    const current = await loadVillage(this.villages, input.id);
    const updated = await this.villages.update(
      current.transition(input.action),
      input.expectedVersion,
    );
    await this.audit.record({
      action: input.action === 'publish' ? 'village.published' : 'village.archived',
      entityType: 'Village',
      entityId: updated.id,
      villageId: updated.id,
      before: current.snapshot(),
      after: updated.snapshot(),
    });
    return updated;
  }
}
