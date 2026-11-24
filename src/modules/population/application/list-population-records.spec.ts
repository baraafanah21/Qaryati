import { Role } from '../../iam';
import { populationScope } from './list-population-records.use-case';

const user = { id: '00000000-0000-7000-8000-000000000001', role: Role.CONTRIBUTOR };

describe('populationScope', () => {
  it('shows preferred records unless includeUnverified is asked', () => {
    expect(populationScope(false, user, true)).toEqual({ kind: 'PREFERRED' });
    expect(populationScope(false, undefined, false)).toEqual({ kind: 'PREFERRED' });
  });

  it('honours includeUnverified fully for editors, and for their own claims for others', () => {
    expect(populationScope(true, user, true)).toEqual({ kind: 'ALL' });
    expect(populationScope(true, user, false)).toEqual({
      kind: 'PREFERRED_OR_OWN',
      userId: user.id,
    });
  });

  it('gives anonymous readers the preferred records only', () => {
    expect(populationScope(true, undefined, false)).toEqual({ kind: 'PREFERRED' });
  });
});
