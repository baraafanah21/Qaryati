/** One account has one role, shared with the future account model (#14). */
export const Role = {
  CONTRIBUTOR: 'CONTRIBUTOR',
  EDITOR: 'EDITOR',
  ADMIN: 'ADMIN',
} as const;

/** Stable role values carried by access tokens. */
export type Role = (typeof Role)[keyof typeof Role];

/** Trusted identity exposed to HTTP handlers after signature and claim validation. */
export interface AuthenticatedUser {
  readonly id: string;
  readonly role: Role;
}
