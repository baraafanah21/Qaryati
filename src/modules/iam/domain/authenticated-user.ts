/** One account has one role, shared with the future account model (#14). */
export const Role = {
  CONTRIBUTOR: 'CONTRIBUTOR',
  EDITOR: 'EDITOR',
  ADMIN: 'ADMIN',
} as const;

/** Stable role values carried by access tokens. */
export type Role = (typeof Role)[keyof typeof Role];

/** The database stores roles as plain text, so values read back are checked here. */
export function isRole(value: string): value is Role {
  return (Object.values(Role) as string[]).includes(value);
}

/** Trusted identity exposed to HTTP handlers after signature and claim validation. */
export interface AuthenticatedUser {
  readonly id: string;
  readonly role: Role;
}
