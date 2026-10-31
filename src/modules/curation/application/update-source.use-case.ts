import { Inject, Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import {
  AUDIT_RECORDER,
  CLOCK,
  NotFoundError,
  type AuditRecorder,
  type Clock,
  type Id,
} from '../../../shared/kernel';
import type { AuthenticatedUser } from '../../iam';
import { Source, type SourceData } from '../domain/source';
import { SourcePolicy } from '../domain/source.policy';
import { SOURCE_REPOSITORY, type SourceRepository } from '../domain/source.repository';

/** Updates a source with authorization and optimistic locking. */
@Injectable()
export class UpdateSource {
  constructor(
    @Inject(SOURCE_REPOSITORY)
    private readonly sources: SourceRepository,
    @Inject(AUDIT_RECORDER)
    private readonly audit: AuditRecorder,
    @Inject(CLOCK)
    private readonly clock: Clock,
  ) {}

  @Transactional()
  async execute(input: {
    id: Id<'Source'>;
    expectedVersion: number;
    changes: Partial<SourceData>;
    actor: AuthenticatedUser;
  }): Promise<Source> {
    const current = await this.sources.findById(input.id);

    if (!current) {
      throw new NotFoundError(`Source ${input.id} does not exist.`);
    }

    // Only the creator, editor, or admin may modify the source.
    SourcePolicy.assertCanEdit(current, input.actor);

    // PATCH updates only the provided fields.
    const updatedData: SourceData = {
      ...current.data,
      ...input.changes,
    };

    const changed = current.update(updatedData, input.actor.id, this.clock.now());

    // The kernel checks the expected version and increments it.
    const stored = await this.sources.update(changed, input.expectedVersion);

    await this.audit.record({
      action: 'source.updated',
      entityType: 'Source',
      entityId: stored.id,
      before: current.snapshot(),
      after: stored.snapshot(),
    });

    return stored;
  }
}
