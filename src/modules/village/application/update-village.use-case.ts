import { Inject, Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import {
  AUDIT_RECORDER,
  ForbiddenError,
  type AuditRecorder,
  type Id,
} from '../../../shared/kernel';
import { PermissionChecker, Role, type AuthenticatedUser } from '../../iam';
import type { Village, VillageChanges } from '../domain/village';
import { VILLAGE_REPOSITORY, type VillageRepository } from '../domain/village.repository';
import { loadVillage } from './load-village';
import { PublishedCurrentNamesReader } from './published-current-names';

/** Edits the identity fields of a village (EDITOR+, or its creator while it is a draft). */
@Injectable()
export class UpdateVillage {
  constructor(
    @Inject(VILLAGE_REPOSITORY) private readonly villages: VillageRepository,
    @Inject(AUDIT_RECORDER) private readonly audit: AuditRecorder,
    private readonly permissions: PermissionChecker,
    private readonly names: PublishedCurrentNamesReader,
  ) {}

  @Transactional()
  async execute(input: {
    id: Id<'Village'>;
    expectedVersion: number;
    changes: VillageChanges;
    actor: AuthenticatedUser;
  }): Promise<Village> {
    const current = await loadVillage(this.villages, input.id);
    const isEditor = this.permissions.hasRole(input.actor, Role.EDITOR);
    if (!current.canBeEditedBy({ id: input.actor.id, isEditor })) {
      throw new ForbiddenError('Only editors, or the creator of a draft, may edit this village.');
    }
    const published = await this.names.read(current.id);
    // update() checks the version in the same statement (412), so `current` is the right `before`.
    const updated = await this.villages.update(
      current.applyChanges(input.changes, published),
      input.expectedVersion,
    );
    await this.audit.record({
      action: 'village.updated',
      entityType: 'Village',
      entityId: updated.id,
      villageId: updated.id,
      before: current.snapshot(),
      after: updated.snapshot(),
    });
    return updated;
  }
}
