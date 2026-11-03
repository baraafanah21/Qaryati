import {
  BusinessRuleViolationError,
  ForbiddenError,
  INITIAL_VERSION,
  type Id,
  type Versioned,
} from '../../../shared/kernel';
import { assertClaimTransition } from './claim-transitions';
import {
  CLAIM_STATUSES,
  CLAIM_TYPES,
  SOURCE_REQUIRED_ON_SUBMIT,
  type ClaimStatus,
  type ClaimType,
} from './claim-values';

export { CLAIM_STATUSES, CLAIM_TYPES };
export type { ClaimStatus, ClaimType };

export interface ClaimData {
  claimType: ClaimType;
  villageId: string;
  groupKey: string;
  valueHash: string;
  sourceId: string | null;
  sourceLocator: string | null;
  status: ClaimStatus;
  isPreferred: boolean;
  supersedesId: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
}

export interface ClaimProps extends ClaimData {
  id: Id<'Claim'>;
  createdBy: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Provenance and review state shared by typed village facts. */
export class Claim implements Versioned {
  private constructor(private readonly props: ClaimProps) {}

  static create(input: {
    id: Id<'Claim'>;
    claimType: ClaimType;
    villageId: string;
    groupKey: string;
    valueHash: string;
    sourceId?: string | null;
    sourceLocator?: string | null;
    supersedesId?: string | null;
    actorId: string;
    now: Date;
  }): Claim {
    const sourceId = input.sourceId ?? null;

    if (SOURCE_REQUIRED_ON_SUBMIT.includes(input.claimType) && sourceId === null) {
      throw new BusinessRuleViolationError('This claim type requires a source on submission.');
    }

    if (input.supersedesId === input.id) {
      throw new BusinessRuleViolationError('A claim cannot supersede itself.');
    }

    return new Claim({
      id: input.id,
      claimType: input.claimType,
      villageId: input.villageId,
      groupKey: input.groupKey,
      valueHash: input.valueHash,
      sourceId,
      sourceLocator: input.sourceLocator ?? null,
      supersedesId: input.supersedesId ?? null,
      status: 'UNVERIFIED',
      isPreferred: false,
      createdBy: input.actorId,
      reviewedBy: null,
      reviewedAt: null,
      reviewNote: null,
      version: INITIAL_VERSION,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  /** Rebuilds a claim from a trusted persistence record. */
  static restore(props: ClaimProps): Claim {
    return new Claim({ ...props });
  }

  get id(): Id<'Claim'> {
    return this.props.id;
  }

  get version(): number {
    return this.props.version;
  }

  get createdBy(): string {
    return this.props.createdBy;
  }

  get status(): ClaimStatus {
    return this.props.status;
  }

  get data(): Readonly<ClaimData> {
    const {
      claimType,
      villageId,
      groupKey,
      valueHash,
      sourceId,
      sourceLocator,
      status,
      isPreferred,
      supersedesId,
      reviewedBy,
      reviewedAt,
      reviewNote,
    } = this.props;

    return {
      claimType,
      villageId,
      groupKey,
      valueHash,
      sourceId,
      sourceLocator,
      status,
      isPreferred,
      supersedesId,
      reviewedBy,
      reviewedAt,
      reviewNote,
    };
  }

  /** Only the original author may edit an unverified claim. */
  edit(
    actorId: string,
    changes: {
      groupKey: string;
      valueHash: string;
      sourceId?: string | null;
      sourceLocator?: string | null;
    },
  ): Claim {
    this.assertAuthorAndUnverified(actorId);

    const sourceId = changes.sourceId === undefined ? this.props.sourceId : changes.sourceId;

    const sourceLocator =
      changes.sourceLocator === undefined ? this.props.sourceLocator : changes.sourceLocator;

    if (SOURCE_REQUIRED_ON_SUBMIT.includes(this.props.claimType) && sourceId === null) {
      throw new BusinessRuleViolationError('This claim type requires a source.');
    }

    return new Claim({
      ...this.props,
      groupKey: changes.groupKey,
      valueHash: changes.valueHash,
      sourceId,
      sourceLocator,
    });
  }

  /** Only the original author may withdraw an unverified claim. */
  withdraw(actorId: string): Claim {
    this.assertAuthorAndUnverified(actorId);
    assertClaimTransition(this.props.status, 'WITHDRAWN');

    return new Claim({
      ...this.props,
      status: 'WITHDRAWN',
    });
  }

  /** Applies a review decision using the claim's review rules. */
  review(input: {
    reviewerId: string;
    status: 'VERIFIED' | 'DISPUTED' | 'REJECTED';
    note?: string | null;
    now: Date;
  }): Claim {
    if (input.reviewerId === this.props.createdBy) {
      throw new ForbiddenError('Claim authors cannot review their own claims.');
    }

    assertClaimTransition(this.props.status, input.status);

    if (input.status === 'VERIFIED' && this.props.sourceId === null) {
      throw new BusinessRuleViolationError('A verified claim must have a source.');
    }

    if ((input.status === 'REJECTED' || input.status === 'DISPUTED') && !input.note?.trim()) {
      throw new BusinessRuleViolationError('A review note is required for this decision.');
    }

    return new Claim({
      ...this.props,
      status: input.status,
      isPreferred: input.status === 'VERIFIED' ? this.props.isPreferred : false,
      reviewedBy: input.reviewerId,
      reviewedAt: input.now,
      reviewNote: input.note?.trim() || null,
    });
  }

  snapshot(): Record<string, unknown> {
    return { ...this.data };
  }

  private assertAuthorAndUnverified(actorId: string): void {
    if (actorId !== this.props.createdBy) {
      throw new ForbiddenError('Only the claim author may modify this claim.');
    }

    if (this.props.status !== 'UNVERIFIED') {
      throw new BusinessRuleViolationError('Only unverified claims may be edited or withdrawn.');
    }
  }
}
