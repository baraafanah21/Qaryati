import { Role } from '../../iam';
import { economyScope } from './list-economy-facts.use-case';

const user = { id: '00000000-0000-7000-8000-000000000001', role: Role.CONTRIBUTOR };

describe('economyScope', () => {
  it('shows the published claims by default, and to anonymous readers always', () => {
    expect(economyScope(false, user, true)).toEqual({ kind: 'PREFERRED' });
    expect(economyScope(true, undefined, false)).toEqual({ kind: 'PREFERRED' });
  });

  it('shows every claim to editors and their own claims to other users', () => {
    expect(economyScope(true, user, true)).toEqual({ kind: 'ALL' });
    expect(economyScope(true, user, false)).toEqual({ kind: 'PREFERRED_OR_OWN', userId: user.id });
  });
});
