jest.mock('@nestjs-cls/transactional', () => ({
  Transactional: () => (_target: object, _propertyKey: string, descriptor: PropertyDescriptor) =>
    descriptor,
}));

import type { RequestContext } from '../../../platform/context/request-context';
import {
  BusinessRuleViolationError,
  ForbiddenError,
  NotFoundError,
  PreconditionFailedError,
  UnauthenticatedError,
  asId,
  type AuditRecorder,
  type Clock,
  type IdGenerator,
} from '../../../shared/kernel';

import { Claim } from '../domain/claim';
import type { ClaimRepository } from '../domain/claim.repository';
import { ClaimWriter } from './claim-writer';
import type { SourceQueries } from './source-queries';

describe('ClaimWriter', () => {
  const now = new Date('2026-11-02T12:00:00Z');
  const claimId = asId<'Claim'>('019a0000-0000-7000-8000-000000000001');
  const actorId = '019a0000-0000-7000-8000-000000000002';
  const otherActorId = '019a0000-0000-7000-8000-000000000003';
  const villageId = '019a0000-0000-7000-8000-000000000004';
  const sourceId = '019a0000-0000-7000-8000-000000000005';

  let writer: ClaimWriter;
  let repository: jest.Mocked<ClaimRepository>;
  let sources: jest.Mocked<Pick<SourceQueries, 'exists'>>;
  let audit: jest.Mocked<Pick<AuditRecorder, 'record'>>;
  let context: { actorId: string | undefined };

  const makeClaim = () =>
    Claim.create({
      id: claimId,
      claimType: 'VILLAGE_NAME',
      villageId,
      groupKey: `name|${villageId}`,
      valueHash: 'hash-1',
      sourceId,
      actorId,
      now,
    });

  beforeEach(() => {
    repository = {
      insert: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
    };

    sources = {
      exists: jest.fn().mockResolvedValue(true),
    };

    audit = {
      record: jest.fn().mockResolvedValue(undefined),
    };

    context = { actorId };

    const clock: Pick<Clock, 'now'> = {
      now: jest.fn().mockReturnValue(now),
    };

    const ids: Pick<IdGenerator, 'next'> = {
      next: jest.fn().mockReturnValue(claimId),
    };

    writer = new ClaimWriter(
      repository,
      sources as unknown as SourceQueries,
      context as RequestContext,
      audit,
      clock,
      ids,
    );
  });

  it('submits an unverified claim and records an audit entry', async () => {
    repository.insert.mockImplementation((claim) => Promise.resolve(claim));

    const result = await writer.submit({
      claimType: 'VILLAGE_NAME',
      villageId,
      groupKey: `name|${villageId}`,
      valueHash: 'hash-1',
      sourceId,
    });

    expect(result).toEqual({ id: claimId, version: 1 });
    expect(repository.insert.mock.calls).toHaveLength(1);
    expect(sources.exists.mock.calls).toContainEqual([sourceId]);

    expect(audit.record.mock.calls[0]?.[0]).toMatchObject({
      action: 'claim.submitted',
      entityType: 'Claim',
      entityId: claimId,
    });
  });

  it('rejects submission when the source does not exist', async () => {
    sources.exists.mockResolvedValue(false);

    await expect(
      writer.submit({
        claimType: 'VILLAGE_NAME',
        villageId,
        groupKey: `name|${villageId}`,
        valueHash: 'hash-1',
        sourceId,
      }),
    ).rejects.toThrow(NotFoundError);

    expect(repository.insert.mock.calls).toHaveLength(0);
  });

  it('rejects a population claim without a source', async () => {
    await expect(
      writer.submit({
        claimType: 'POPULATION',
        villageId,
        groupKey: `population|${villageId}|2020`,
        valueHash: 'hash-1',
      }),
    ).rejects.toThrow(BusinessRuleViolationError);
  });

  it('rejects a superseded claim from another village', async () => {
    repository.findById.mockResolvedValue(makeClaim());

    await expect(
      writer.submit({
        claimType: 'VILLAGE_NAME',
        villageId: 'different-village',
        groupKey: 'name|different-village',
        valueHash: 'hash-2',
        supersedesId: claimId,
      }),
    ).rejects.toThrow(BusinessRuleViolationError);

    expect(repository.insert.mock.calls).toHaveLength(0);
  });

  it('edits an unverified claim and records before/after audit', async () => {
    repository.findById.mockResolvedValue(makeClaim());
    repository.update.mockImplementation((claim) => Promise.resolve(claim));

    const result = await writer.edit(claimId, 1, {
      groupKey: `name|${villageId}`,
      valueHash: 'hash-2',
      sourceId,
    });

    expect(result.data.valueHash).toBe('hash-2');
    expect(repository.update.mock.calls).toHaveLength(1);
    expect(repository.update.mock.calls[0]?.[0]).toBeInstanceOf(Claim);
    expect(repository.update.mock.calls[0]?.[1]).toBe(1);

    const auditCall = audit.record.mock.calls[0]?.[0];

    expect(auditCall?.action).toBe('claim.edited');
    expect(auditCall?.before).toBeDefined();
    expect(auditCall?.after).toBeDefined();
    expect(auditCall?.entityId).toBe(claimId);
  });

  it('prevents another user from editing the claim', async () => {
    context.actorId = otherActorId;
    repository.findById.mockResolvedValue(makeClaim());

    await expect(
      writer.edit(claimId, 1, {
        groupKey: `name|${villageId}`,
        valueHash: 'hash-2',
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('propagates optimistic-locking conflicts', async () => {
    repository.findById.mockResolvedValue(makeClaim());
    repository.update.mockRejectedValue(new PreconditionFailedError('The claim version is stale.'));

    await expect(
      writer.edit(claimId, 0, {
        groupKey: `name|${villageId}`,
        valueHash: 'hash-2',
      }),
    ).rejects.toThrow(PreconditionFailedError);

    expect(audit.record.mock.calls).toHaveLength(0);
  });

  it('withdraws an unverified claim and records audit', async () => {
    repository.findById.mockResolvedValue(makeClaim());
    repository.update.mockImplementation((claim) => Promise.resolve(claim));

    const result = await writer.withdraw(claimId, 1);

    expect(result.status).toBe('WITHDRAWN');

    const auditCall = audit.record.mock.calls[0]?.[0];

    expect(auditCall?.action).toBe('claim.withdrawn');
    expect(auditCall?.before).toBeDefined();
    expect(auditCall?.after).toBeDefined();
  });

  it('returns a claim by ID', async () => {
    repository.findById.mockResolvedValue(makeClaim());

    const result = await writer.get(claimId);

    expect(result.id).toBe(claimId);
  });

  it('throws NotFoundError for a missing claim', async () => {
    repository.findById.mockResolvedValue(undefined);

    await expect(writer.get(claimId)).rejects.toThrow(NotFoundError);
  });

  it('rejects submission without an authenticated actor', async () => {
    context.actorId = undefined;

    await expect(
      writer.submit({
        claimType: 'VILLAGE_NAME',
        villageId,
        groupKey: `name|${villageId}`,
        valueHash: 'hash-1',
      }),
    ).rejects.toThrow(UnauthenticatedError);

    expect(repository.insert.mock.calls).toHaveLength(0);
  });
});
