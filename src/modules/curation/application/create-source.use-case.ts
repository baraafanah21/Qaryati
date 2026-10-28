import { Inject, Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';
import {
  AUDIT_RECORDER,
  CLOCK,
  ID_GENERATOR,
  type AuditRecorder,
  type Clock,
  type IdGenerator,
} from '../../../shared/kernel';
import { Source, type SourceData } from '../domain/source';
import { SOURCE_REPOSITORY, type SourceRepository } from '../domain/source.repository';

/**
 * Creates a new information source and records the action
 * in the audit trail within the same transaction.
 */
@Injectable()
export class CreateSource {
  constructor(
    @Inject(SOURCE_REPOSITORY)
    private readonly sources: SourceRepository,
    @Inject(AUDIT_RECORDER)
    private readonly audit: AuditRecorder,
    @Inject(CLOCK)
    private readonly clock: Clock,
    @Inject(ID_GENERATOR)
    private readonly ids: IdGenerator,
  ) {}

  @Transactional()
  async execute(input: { data: SourceData; actorId: string }): Promise<Source> {
    const now = this.clock.now();

    const created = Source.create({
      id: this.ids.next<'Source'>(),
      data: input.data,
      actorId: input.actorId,
      now,
    });

    const stored = await this.sources.insert(created);

    await this.audit.record({
      action: 'source.created',
      entityType: 'Source',
      entityId: stored.id,
      after: stored.snapshot(),
    });

    return stored;
  }
}
