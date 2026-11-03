import { Inject, Injectable } from '@nestjs/common';
import { Transactional } from '@nestjs-cls/transactional';

import { RequestContext } from '../../../platform/context/request-context';
import {
  asId,
  AUDIT_RECORDER,
  CLOCK,
  ID_GENERATOR,
  BusinessRuleViolationError,
  NotFoundError,
  UnauthenticatedError,
  type AuditRecorder,
  type Clock,
  type Id,
  type IdGenerator,
} from '../../../shared/kernel';

import { Claim } from '../domain/claim';
import type { ClaimType } from '../domain/claim-values';
import { CLAIM_REPOSITORY, type ClaimRepository } from '../domain/claim.repository';

import { SourceQueries } from './source-queries';

export interface SubmitClaimInput {
  claimType: ClaimType;
  villageId: string;
  groupKey: string;
  valueHash: string;
  sourceId?: string | null;
  sourceLocator?: string | null;
  supersedesId?: string | null;
}

export interface EditClaimInput {
  groupKey: string;
  valueHash: string;
  sourceId?: string | null;
  sourceLocator?: string | null;
}

/**
 * Public application facade for submitting, editing,
 * withdrawing, and reading claims.
 */
@Injectable()
export class ClaimWriter {
  constructor(
    @Inject(CLAIM_REPOSITORY)
    private readonly claims: ClaimRepository,
    private readonly sources: SourceQueries,
    private readonly context: RequestContext,
    @Inject(AUDIT_RECORDER)
    private readonly audit: AuditRecorder,
    @Inject(CLOCK)
    private readonly clock: Clock,
    @Inject(ID_GENERATOR)
    private readonly ids: IdGenerator,
  ) {}

  private actorId(): string {
    const actorId = this.context.actorId;

    if (!actorId) {
      throw new UnauthenticatedError('An authenticated user is required to modify claims.');
    }

    return actorId;
  }

  private async assertSourceExists(sourceId: string | null | undefined): Promise<void> {
    if (sourceId && !(await this.sources.exists(sourceId))) {
      throw new NotFoundError(`Source ${sourceId} does not exist.`);
    }
  }

  private async findClaim(id: Id<'Claim'>): Promise<Claim> {
    const current = await this.claims.findById(id);

    if (!current) {
      throw new NotFoundError(`Claim ${id} does not exist.`);
    }

    return current;
  }

  /**
   * Submits a claim.
   * The caller must validate village existence.
   */
  @Transactional()
  async submit(input: SubmitClaimInput): Promise<{ id: Id<'Claim'>; version: number }> {
    const actorId = this.actorId();
    const id = this.ids.next<'Claim'>();

    await this.assertSourceExists(input.sourceId);

    if (input.supersedesId) {
      const previous = await this.findClaim(asId<'Claim'>(input.supersedesId));

      if (
        previous.data.villageId !== input.villageId ||
        previous.data.claimType !== input.claimType
      ) {
        throw new BusinessRuleViolationError(
          'A superseded claim must belong to the same village and claim type.',
        );
      }
    }

    const created = Claim.create({
      ...input,
      id,
      actorId,
      now: this.clock.now(),
    });

    const stored = await this.claims.insert(created);

    await this.audit.record({
      action: 'claim.submitted',
      entityType: 'Claim',
      entityId: stored.id,
      villageId: stored.data.villageId,
      after: stored.snapshot(),
    });

    return {
      id: stored.id,
      version: stored.version,
    };
  }

  /** Edits an unverified claim owned by the current user. */
  @Transactional()
  async edit(id: Id<'Claim'>, expectedVersion: number, changes: EditClaimInput): Promise<Claim> {
    const actorId = this.actorId();
    const current = await this.findClaim(id);

    await this.assertSourceExists(changes.sourceId);

    const changed = current.edit(actorId, changes);

    const stored = await this.claims.update(changed, expectedVersion);

    await this.audit.record({
      action: 'claim.edited',
      entityType: 'Claim',
      entityId: stored.id,
      villageId: stored.data.villageId,
      before: current.snapshot(),
      after: stored.snapshot(),
    });

    return stored;
  }

  /** Withdraws an unverified claim owned by the current user. */
  @Transactional()
  async withdraw(id: Id<'Claim'>, expectedVersion: number): Promise<Claim> {
    const actorId = this.actorId();
    const current = await this.findClaim(id);

    const changed = current.withdraw(actorId);

    const stored = await this.claims.update(changed, expectedVersion);

    await this.audit.record({
      action: 'claim.withdrawn',
      entityType: 'Claim',
      entityId: stored.id,
      villageId: stored.data.villageId,
      before: current.snapshot(),
      after: stored.snapshot(),
    });

    return stored;
  }

  /** Returns a claim or throws NotFoundError. */
  async get(id: Id<'Claim'>): Promise<Claim> {
    return this.findClaim(id);
  }
}
