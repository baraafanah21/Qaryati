// Reference: copy the aggregate shape: private constructor, create() that enforces invariants, restore() for rows, snapshot() for audit.
import {
  FieldErrorCode,
  INITIAL_VERSION,
  ValidationError,
  type Id,
  type Versioned,
} from '../../../src/shared/kernel';

/** Everything a widget is made of; persistence restores it field by field. */
export interface WidgetProps {
  id: Id<'Widget'>;
  name: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A widget: the reference aggregate. Plain TypeScript; time and ids come in
 * as arguments, never from `new Date()` or a UUID library.
 *
 * Invariant: the name, trimmed, is 1–80 characters.
 */
export class Widget implements Versioned {
  static readonly NAME_MAX_LENGTH = 80;

  private constructor(private readonly props: WidgetProps) {}

  /** A new widget at version 1. Throws `ValidationError` (422) when the name breaks the invariant. */
  static create(input: { id: Id<'Widget'>; name: string; now: Date }): Widget {
    return new Widget({
      id: input.id,
      name: Widget.validName(input.name),
      version: INITIAL_VERSION,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }

  /** Rebuilds a widget from stored state. No checks: the data was valid when written. */
  static restore(props: WidgetProps): Widget {
    return new Widget({ ...props });
  }

  get id(): Id<'Widget'> {
    return this.props.id;
  }

  get name(): string {
    return this.props.name;
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

  /**
   * The same widget with a new name. The version is left alone: the database
   * increments it when the change is stored with the expected version.
   */
  rename(name: string): Widget {
    return new Widget({ ...this.props, name: Widget.validName(name) });
  }

  /** The fields the audit trail keeps for a widget: an allow-list, never the whole object. */
  snapshot(): Record<string, unknown> {
    return { name: this.props.name };
  }

  private static validName(raw: string): string {
    const name = raw.trim();
    if (name.length === 0 || name.length > Widget.NAME_MAX_LENGTH) {
      throw new ValidationError('The widget name is invalid.', [
        {
          field: 'name',
          code: name.length === 0 ? FieldErrorCode.REQUIRED : FieldErrorCode.TOO_LONG,
          message: `Use 1 to ${Widget.NAME_MAX_LENGTH} characters, not counting spaces at either end.`,
        },
      ]);
    }
    return name;
  }
}
