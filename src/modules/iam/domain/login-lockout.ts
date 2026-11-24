/** Consecutive failed logins that lock an account (#25). */
export const MAX_FAILED_LOGINS = 10;

/** How long a locked account refuses every login, even with the right password. */
export const LOCKOUT_DURATION_MS = 15 * 60_000;

/**
 * The login-protection state of an account. It is not part of what an admin or
 * the owner edits, so changing it does not bump the account's version.
 */
export interface LoginLockState {
  /** Failed logins since the last success or the last lock. */
  failedLoginCount: number;
  /** End of the current or last lock; `null` when the account was never locked since. */
  lockedUntil: Date | null;
}

/** The state of a new account, and after a successful login. */
export const UNLOCKED: LoginLockState = { failedLoginCount: 0, lockedUntil: null };

/** Whether a login at `now` must be refused because of a lock. */
export function isLocked(state: LoginLockState, now: Date): boolean {
  return state.lockedUntil !== null && now.getTime() < state.lockedUntil.getTime();
}

/**
 * Counts one failed login. The 10th consecutive failure locks the account for
 * 15 minutes and starts the count again, so after the lock the client has another
 * 10 attempts.
 *
 * Failures **during** a lock are not counted and do not extend it: otherwise anyone
 * who knows an email address could keep its owner locked out forever.
 *
 * @returns the new state, and `locked: true` when this failure started a lock.
 */
export function afterFailedLogin(
  state: LoginLockState,
  now: Date,
): { state: LoginLockState; locked: boolean } {
  if (isLocked(state, now)) return { state, locked: false };
  const failedLoginCount = state.failedLoginCount + 1;
  if (failedLoginCount >= MAX_FAILED_LOGINS) {
    return {
      state: { failedLoginCount: 0, lockedUntil: new Date(now.getTime() + LOCKOUT_DURATION_MS) },
      locked: true,
    };
  }
  return { state: { failedLoginCount, lockedUntil: state.lockedUntil }, locked: false };
}

/** Whether a successful login has anything to reset (saves a write on most logins). */
export function needsReset(state: LoginLockState): boolean {
  return state.failedLoginCount !== 0 || state.lockedUntil !== null;
}
