import { BusinessRuleViolationError } from '../../../shared/kernel';
import type { PublicationStatus } from './village-values';

/** The publication actions an editor can take on a village. */
export const PUBLICATION_ACTIONS = ['publish', 'archive'] as const;
export type PublicationAction = (typeof PUBLICATION_ACTIONS)[number];

/**
 * Legal moves of the publication workflow: a draft or an archived village can
 * be published, a published village can be archived. Archiving replaces soft
 * delete, so an archived village can always come back.
 */
const TRANSITIONS: Readonly<
  Record<PublicationAction, { from: readonly PublicationStatus[]; to: PublicationStatus }>
> = {
  publish: { from: ['DRAFT', 'ARCHIVED'], to: 'PUBLISHED' },
  archive: { from: ['PUBLISHED'], to: 'ARCHIVED' },
};

/**
 * The status a village moves to when `action` is applied in status `from`.
 *
 * @throws BusinessRuleViolationError (422) for any other move, e.g. archiving a draft.
 */
export function nextPublicationStatus(
  from: PublicationStatus,
  action: PublicationAction,
): PublicationStatus {
  const rule = TRANSITIONS[action];
  if (!rule.from.includes(from)) {
    throw new BusinessRuleViolationError(
      `A village in status ${from} cannot be moved to ${rule.to}.`,
    );
  }
  return rule.to;
}
