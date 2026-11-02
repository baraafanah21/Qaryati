import { BusinessRuleViolationError, ForbiddenError, type Id } from '../../../shared/kernel';
import { Claim } from './claim';

describe('Claim Domain', () => {
  const now = new Date('2026-11-02T12:00:00Z');
  const authorId = '019a0000-0000-7000-8000-000000000002';
  const reviewerId = '019a0000-0000-7000-8000-000000000003';

  const createClaim = (changes: Partial<Parameters<typeof Claim.create>[0]> = {}): Claim =>
    Claim.create({
      id: '019a0000-0000-7000-8000-000000000001' as Id<'Claim'>,
      claimType: 'VILLAGE_NAME',
      villageId: '019a0000-0000-7000-8000-000000000004',
      groupKey: 'name|village-1',
      valueHash: 'test-hash',
      sourceId: null,
      actorId: authorId,
      now,
      ...changes,
    });

  it('creates an unverified claim with version 1', () => {
    const claim = createClaim();

    expect(claim.status).toBe('UNVERIFIED');
    expect(claim.version).toBe(1);
    expect(claim.data.isPreferred).toBe(false);
  });

  it('requires a source for population claims', () => {
    expect(() => createClaim({ claimType: 'POPULATION' })).toThrow(BusinessRuleViolationError);
  });

  it('prevents an author from reviewing their own claim', () => {
    const claim = createClaim({ sourceId: 'source-1' });

    expect(() =>
      claim.review({
        reviewerId: authorId,
        status: 'VERIFIED',
        now,
      }),
    ).toThrow(ForbiddenError);
  });

  it('requires a source before verification', () => {
    const claim = createClaim();

    expect(() =>
      claim.review({
        reviewerId,
        status: 'VERIFIED',
        now,
      }),
    ).toThrow(BusinessRuleViolationError);
  });

  it('requires a note when rejecting a claim', () => {
    const claim = createClaim();

    expect(() =>
      claim.review({
        reviewerId,
        status: 'REJECTED',
        now,
      }),
    ).toThrow(BusinessRuleViolationError);
  });

  it('requires a note when disputing a claim', () => {
    const claim = createClaim();

    expect(() =>
      claim.review({
        reviewerId,
        status: 'DISPUTED',
        now,
      }),
    ).toThrow(BusinessRuleViolationError);
  });

  it('records reviewer and review date', () => {
    const claim = createClaim({ sourceId: 'source-1' });

    const reviewed = claim.review({
      reviewerId,
      status: 'VERIFIED',
      now,
    });

    expect(reviewed.status).toBe('VERIFIED');
    expect(reviewed.data.reviewedBy).toBe(reviewerId);
    expect(reviewed.data.reviewedAt).toEqual(now);
  });

  it('allows an author to edit an unverified claim', () => {
    const claim = createClaim();

    const edited = claim.edit(authorId, {
      groupKey: 'name|village-1',
      valueHash: 'updated-hash',
    });

    expect(edited.data.valueHash).toBe('updated-hash');
  });

  it('prevents another user from editing the claim', () => {
    const claim = createClaim();

    expect(() =>
      claim.edit(reviewerId, {
        groupKey: 'name|village-1',
        valueHash: 'updated-hash',
      }),
    ).toThrow(ForbiddenError);
  });

  it('allows an author to withdraw an unverified claim', () => {
    const claim = createClaim();

    expect(claim.withdraw(authorId).status).toBe('WITHDRAWN');
  });

  it('prevents editing a verified claim', () => {
    const claim = createClaim({ sourceId: 'source-1' });
    const verified = claim.review({
      reviewerId,
      status: 'VERIFIED',
      now,
    });

    expect(() =>
      verified.edit(authorId, {
        groupKey: 'name|village-1',
        valueHash: 'updated-hash',
      }),
    ).toThrow(BusinessRuleViolationError);
  });
});
