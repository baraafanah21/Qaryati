import {
  BusinessRuleViolationError,
  FieldErrorCode,
  INITIAL_VERSION,
  ValidationError,
  type Id,
  type Versioned,
} from '../../../shared/kernel';
import { canEditDisplayName, type DisplayNameLang } from './display-name-rules';
import { nextPublicationStatus, type PublicationAction } from './publication-rules';
import {
  isSettlementStatus,
  SETTLEMENT_STATUSES,
  validateSlug,
  type PublicationStatus,
  type SettlementStatus,
} from './village-values';

/** A point in WGS 84, as stored in the `location` projection. */
export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/** Everything a village identity row is made of. */
export interface VillageProps {
  id: Id<'Village'>;
  slug: string;
  settlementStatus: SettlementStatus;
  publicationStatus: PublicationStatus;
  displayNameAr: string;
  displayNameEn: string | null;
  location: GeoPoint | null;
  createdBy: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Fields a PATCH may change. `undefined` means "leave as is". */
export interface VillageChanges {
  settlementStatus?: string;
  displayNameAr?: string;
  displayNameEn?: string | null;
}

/** Which display names already have a preferred `CURRENT` name claim. */
export type PublishedCurrentNames = Readonly<Record<DisplayNameLang, boolean>>;

const UUID_SHAPED = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The village identity: the record every fact hangs on. Facts themselves are
 * claims; the display names and location here are projections of preferred
 * claims, editable directly only until such a claim exists.
 */
export class Village implements Versioned {
  static readonly NAME_MAX_LENGTH = 200;

  private constructor(private readonly props: VillageProps) {}

  /** A new `DRAFT` village. Throws `ValidationError` (422) for a bad slug, status or name. */
  static create(input: {
    id: Id<'Village'>;
    slug: string;
    settlementStatus: string;
    displayNameAr: string;
    displayNameEn?: string | null;
    createdBy: string;
    now: Date;
  }): Village {
    return new Village({
      id: input.id,
      slug: Village.validSlug(input.slug),
      settlementStatus: Village.validSettlementStatus(input.settlementStatus),
      publicationStatus: 'DRAFT',
      displayNameAr: Village.validName(input.displayNameAr, 'displayNameAr'),
      displayNameEn: Village.optionalName(input.displayNameEn, 'displayNameEn'),
      location: null,
      createdBy: input.createdBy,
      version: INITIAL_VERSION,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  /** Rebuilds a village from stored state. */
  static restore(props: VillageProps): Village {
    return new Village({ ...props });
  }

  get id(): Id<'Village'> {
    return this.props.id;
  }
  get slug(): string {
    return this.props.slug;
  }
  get settlementStatus(): SettlementStatus {
    return this.props.settlementStatus;
  }
  get publicationStatus(): PublicationStatus {
    return this.props.publicationStatus;
  }
  get displayNameAr(): string {
    return this.props.displayNameAr;
  }
  get displayNameEn(): string | null {
    return this.props.displayNameEn;
  }
  get location(): GeoPoint | null {
    return this.props.location;
  }
  get createdBy(): string {
    return this.props.createdBy;
  }
  get version(): number {
    return this.props.version;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  /** Anonymous readers see only published villages; any logged-in user sees every status. */
  isVisibleTo(user: { id: string } | undefined): boolean {
    return this.props.publicationStatus === 'PUBLISHED' || user !== undefined;
  }

  /**
   * Editors and admins may edit any village; the creator may edit their own
   * village while it is still a draft.
   */
  canBeEditedBy(actor: { id: string; isEditor: boolean }): boolean {
    return (
      actor.isEditor ||
      (actor.id === this.props.createdBy && this.props.publicationStatus === 'DRAFT')
    );
  }

  /**
   * The village with `changes` applied. A display name with a published
   * `CURRENT` name claim in its language can no longer be edited here
   * (422): it comes from claims (see {@link canEditDisplayName}).
   */
  applyChanges(changes: VillageChanges, published: PublishedCurrentNames): Village {
    const next = { ...this.props };
    if (changes.settlementStatus !== undefined) {
      next.settlementStatus = Village.validSettlementStatus(changes.settlementStatus);
    }
    if (changes.displayNameAr !== undefined) {
      Village.assertNameEditable('ar', published.ar);
      next.displayNameAr = Village.validName(changes.displayNameAr, 'displayNameAr');
    }
    if (changes.displayNameEn !== undefined) {
      Village.assertNameEditable('en', published.en);
      next.displayNameEn = Village.optionalName(changes.displayNameEn, 'displayNameEn');
    }
    return new Village(next);
  }

  /** The village after a publish or archive action; illegal moves throw (422). */
  transition(action: PublicationAction): Village {
    return new Village({
      ...this.props,
      publicationStatus: nextPublicationStatus(this.props.publicationStatus, action),
    });
  }

  /** The fields the audit trail keeps for a village. */
  snapshot(): Record<string, unknown> {
    return {
      slug: this.props.slug,
      settlementStatus: this.props.settlementStatus,
      publicationStatus: this.props.publicationStatus,
      displayNameAr: this.props.displayNameAr,
      displayNameEn: this.props.displayNameEn,
      createdBy: this.props.createdBy,
    };
  }

  private static assertNameEditable(lang: DisplayNameLang, published: boolean): void {
    if (!canEditDisplayName(lang, published)) {
      throw new BusinessRuleViolationError(
        `The ${lang === 'ar' ? 'Arabic' : 'English'} display name comes from its published ` +
          'current name claim; submit a new name claim to change it.',
      );
    }
  }

  // A UUID-shaped slug would make /villages/{idOrSlug} ambiguous.
  private static validSlug(slug: string): string {
    if (UUID_SHAPED.test(slug)) {
      throw new ValidationError('The slug is invalid.', [
        {
          field: 'slug',
          code: FieldErrorCode.INVALID_FORMAT,
          message: 'A slug must not look like an id.',
        },
      ]);
    }
    return validateSlug(slug);
  }

  private static validSettlementStatus(value: string): SettlementStatus {
    if (!isSettlementStatus(value)) {
      throw new ValidationError('The settlement status is not allowed.', [
        {
          field: 'settlementStatus',
          code: FieldErrorCode.INVALID_VALUE,
          message: `Use one of ${SETTLEMENT_STATUSES.join(', ')}.`,
        },
      ]);
    }
    return value;
  }

  private static validName(raw: string, field: string): string {
    const name = raw.trim();
    if (name.length === 0 || name.length > Village.NAME_MAX_LENGTH) {
      throw new ValidationError('The display name is invalid.', [
        {
          field,
          code: name.length === 0 ? FieldErrorCode.REQUIRED : FieldErrorCode.TOO_LONG,
          message: `Use 1 to ${Village.NAME_MAX_LENGTH} characters, not counting spaces at either end.`,
        },
      ]);
    }
    return name;
  }

  private static optionalName(raw: string | null | undefined, field: string): string | null {
    return raw == null ? null : Village.validName(raw, field);
  }
}
