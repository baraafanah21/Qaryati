import { ForbiddenError } from '../../../shared/kernel';
import { Role, type AuthenticatedUser } from '../../iam';
import type { Source } from './source';

/** Authorization rules for editing information sources. */
export class SourcePolicy {
  /**
   * Only the creator, an editor, or an administrator may edit a source.
   */
  static assertCanEdit(source: Source, actor: AuthenticatedUser): void {
    if (source.createdBy === actor.id || actor.role === Role.EDITOR || actor.role === Role.ADMIN) {
      return;
    }

    throw new ForbiddenError('You do not have permission to edit this source.');
  }
}
