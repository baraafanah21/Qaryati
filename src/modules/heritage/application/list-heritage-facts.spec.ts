import { Role } from '../../iam';
import { heritageScope } from './list-heritage-facts.use-case';

const user = { id: '00000000-0000-7000-8000-000000000001', role: Role.CONTRIBUTOR };

describe('heritageScope', () => {
  it('shows preferred facts unless includeUnverified is asked', () => {
    expect(heritageScope(false, user, true)).toEqual({ kind: 'PREFERRED' });
    expect(heritageScope(false, undefined, false)).toEqual({ kind: 'PREFERRED' });
  });

  it('honours includeUnverified fully for editors, and for their own claims for others', () => {
    expect(heritageScope(true, user, true)).toEqual({ kind: 'ALL' });
    expect(heritageScope(true, user, false)).toEqual({ kind: 'PREFERRED_OR_OWN', userId: user.id });
  });

  it('gives anonymous readers the preferred facts only', () => {
    expect(heritageScope(true, undefined, false)).toEqual({ kind: 'PREFERRED' });
  });
});
