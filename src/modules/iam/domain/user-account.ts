import { INITIAL_VERSION, type Id, type Versioned } from '../../../shared/kernel';
import { AccountStatus } from './account-status';
import { Role } from './authenticated-user';

/** Persistence restores explicit fields rather than exposing database rows to the application. */
export interface UserAccountProps {
  id: Id<'UserAccount'>;
  email: string;
  passwordHash: string;
  role: Role;
  status: AccountStatus;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/** Credentials never belong in public responses or audit snapshots. */
export class UserAccount implements Versioned {
  private constructor(private readonly props: UserAccountProps) {}

  /** Registration cannot assign elevated roles, regardless of the caller. */
  static create(input: {
    id: Id<'UserAccount'>;
    email: string;
    passwordHash: string;
    now: Date;
  }): UserAccount {
    return new UserAccount({
      id: input.id,
      email: input.email,
      passwordHash: input.passwordHash,
      role: Role.CONTRIBUTOR,
      status: AccountStatus.ACTIVE,
      version: INITIAL_VERSION,
      createdAt: input.now,
      updatedAt: input.now,
      deletedAt: null,
    });
  }

  /** Reconstitutes trusted persisted state without adding registration defaults. */
  static restore(props: UserAccountProps): UserAccount {
    return new UserAccount({ ...props });
  }
  get id() {
    return this.props.id;
  }
  get email() {
    return this.props.email;
  }
  get passwordHash() {
    return this.props.passwordHash;
  }
  get role() {
    return this.props.role;
  }
  get status() {
    return this.props.status;
  }
  get version() {
    return this.props.version;
  }
  get createdAt() {
    return this.props.createdAt;
  }
  get updatedAt() {
    return this.props.updatedAt;
  }
  get deletedAt() {
    return this.props.deletedAt;
  }
  get canLogin(): boolean {
    return this.status === AccountStatus.ACTIVE && this.deletedAt === null;
  }

  /** Deliberate allow-list; never serialize the entity for audit. */
  snapshot(): Record<string, unknown> {
    return { email: this.email, role: this.role, status: this.status };
  }
}
