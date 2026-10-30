/** Account availability is separate from the temporary login lockout planned in #25. */
export const AccountStatus = {
  ACTIVE: 'ACTIVE',
  DISABLED: 'DISABLED',
} as const;

/** Persistent account states; newly registered accounts are active. */
export type AccountStatus = (typeof AccountStatus)[keyof typeof AccountStatus];

/** The database stores status as plain text, so values read back are checked here. */
export function isAccountStatus(value: string): value is AccountStatus {
  return (Object.values(AccountStatus) as string[]).includes(value);
}
