import { BusinessRuleViolationError, ErrorCode } from '../../../shared/kernel';

/**
 * An administrator never changes their own role or status (#32): otherwise the
 * last administrator could demote or disable themself and leave nobody able to
 * administer accounts. Another administrator has to do it.
 *
 * @throws BusinessRuleViolationError SELF_ADMINISTRATION_FORBIDDEN (422)
 */
export function assertNotSelf(actorId: string, targetId: string): void {
  if (actorId === targetId) {
    throw new BusinessRuleViolationError(
      'Administrators cannot change their own role or status; ask another administrator.',
      { code: ErrorCode.SELF_ADMINISTRATION_FORBIDDEN },
    );
  }
}
