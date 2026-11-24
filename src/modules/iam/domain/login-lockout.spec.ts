import {
  LOCKOUT_DURATION_MS,
  MAX_FAILED_LOGINS,
  UNLOCKED,
  afterFailedLogin,
  isLocked,
  needsReset,
  type LoginLockState,
} from './login-lockout';

const now = new Date('2026-11-24T10:00:00Z');
const at = (ms: number) => new Date(now.getTime() + ms);

function fail(times: number, state: LoginLockState = UNLOCKED, when = now) {
  let current = state;
  let locked = false;
  for (let i = 0; i < times; i++) ({ state: current, locked } = afterFailedLogin(current, when));
  return { state: current, locked };
}

describe('login lockout', () => {
  it('counts failures without locking below the threshold', () => {
    const result = fail(MAX_FAILED_LOGINS - 1);
    expect(result).toEqual({
      state: { failedLoginCount: MAX_FAILED_LOGINS - 1, lockedUntil: null },
      locked: false,
    });
    expect(isLocked(result.state, now)).toBe(false);
  });

  it('locks for 15 minutes on the 10th consecutive failure and restarts the count', () => {
    const result = fail(MAX_FAILED_LOGINS);
    expect(result.locked).toBe(true);
    expect(result.state).toEqual({ failedLoginCount: 0, lockedUntil: at(LOCKOUT_DURATION_MS) });
    expect(LOCKOUT_DURATION_MS).toBe(15 * 60_000);
  });

  it('is locked until the end of the lock, exclusive', () => {
    const { state } = fail(MAX_FAILED_LOGINS);
    expect(isLocked(state, at(LOCKOUT_DURATION_MS - 1))).toBe(true);
    expect(isLocked(state, at(LOCKOUT_DURATION_MS))).toBe(false);
  });

  it('neither counts nor extends failures during a lock', () => {
    const { state } = fail(MAX_FAILED_LOGINS);
    const during = fail(25, state, at(60_000));
    expect(during).toEqual({ state, locked: false });
  });

  it('gives another 10 attempts after the lock expired', () => {
    const { state } = fail(MAX_FAILED_LOGINS);
    const after = at(LOCKOUT_DURATION_MS);
    expect(fail(MAX_FAILED_LOGINS - 1, state, after).locked).toBe(false);
    expect(fail(MAX_FAILED_LOGINS, state, after).state.lockedUntil).toEqual(
      new Date(after.getTime() + LOCKOUT_DURATION_MS),
    );
  });

  it('needs a reset after any failure or lock, not on a clean account', () => {
    expect(needsReset(UNLOCKED)).toBe(false);
    expect(needsReset(fail(1).state)).toBe(true);
    expect(needsReset(fail(MAX_FAILED_LOGINS).state)).toBe(true);
  });
});
