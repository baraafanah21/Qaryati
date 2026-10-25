/** Account availability is separate from the temporary login lockout planned in #25. */
export const AccountStatus = {
  ACTIVE: 'ACTIVE',
  DISABLED: 'DISABLED',
} as const;

/** Persistent account states; newly registered accounts are active. */
export type AccountStatus = (typeof AccountStatus)[keyof typeof AccountStatus];
