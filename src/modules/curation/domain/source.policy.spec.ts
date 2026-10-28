import { ForbiddenError, type Id } from '../../../shared/kernel';
import { Role, type AuthenticatedUser } from '../../iam';
import { Source, type SourceData } from './source';
import { SourcePolicy } from './source.policy';

describe('SourcePolicy', () => {
  const creatorId = '019a0000-0000-7000-8000-000000000002';
  const anotherUserId = '019a0000-0000-7000-8000-000000000003';

  const data: SourceData = {
    sourceType: 'BOOK',
    title: 'Palestinian Village History',
    author: null,
    publisher: null,
    publishedYear: 2020,
    url: null,
    isbn: null,
    reliability: 5,
    notes: null,
  };

  const source = Source.create({
    id: '019a0000-0000-7000-8000-000000000001' as Id<'Source'>,
    data,
    actorId: creatorId,
    now: new Date('2026-10-27T12:00:00Z'),
  });

  const actor = (id: string, role: AuthenticatedUser['role']): AuthenticatedUser => ({
    id,
    role,
  });

  it('allows the creator to edit the source', () => {
    expect(() =>
      SourcePolicy.assertCanEdit(source, actor(creatorId, Role.CONTRIBUTOR)),
    ).not.toThrow();
  });

  it('allows an editor to edit another user source', () => {
    expect(() =>
      SourcePolicy.assertCanEdit(source, actor(anotherUserId, Role.EDITOR)),
    ).not.toThrow();
  });

  it('allows an admin to edit another user source', () => {
    expect(() =>
      SourcePolicy.assertCanEdit(source, actor(anotherUserId, Role.ADMIN)),
    ).not.toThrow();
  });

  it('rejects another contributor with ForbiddenError', () => {
    expect(() =>
      SourcePolicy.assertCanEdit(source, actor(anotherUserId, Role.CONTRIBUTOR)),
    ).toThrow(ForbiddenError);
  });
});
