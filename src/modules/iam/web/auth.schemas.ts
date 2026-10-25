import { z } from 'zod';
import { AccountStatus } from '../domain/account-status';
import { Role } from '../domain/authenticated-user';
import { EMAIL_PATTERN } from '../domain/email';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../domain/password-policy';

// Transformation belongs at the application boundary; HTTP checks the trimmed syntax only.
const email = z
  .string()
  .trim()
  .max(254)
  .regex(EMAIL_PATTERN)
  .refine((value) => !value.includes('..'));
/** Public registration accepts no role or status overrides. */
export const registerBody = z.strictObject({
  email,
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
});
/** Login does not reject wrong short passwords before uniform credential verification. */
export const loginBody = z.strictObject({
  email,
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
/** Public account representation, deliberately omitting all credential fields. */
export const accountResponse = z
  .strictObject({
    id: z.uuid(),
    email: z.string(),
    role: z.enum(Object.values(Role)),
    status: z.enum(Object.values(AccountStatus)),
    version: z.int().min(1),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: 'UserAccountResponse' });
/** Raw refresh tokens are returned only by successful login. */
export const loginResponse = z
  .strictObject({
    accessToken: z.string(),
    refreshToken: z.string(),
    tokenType: z.literal('Bearer'),
    expiresIn: z.int().positive(),
  })
  .meta({ id: 'LoginResponse' });
/** Validated registration input. */
export type RegisterBody = z.infer<typeof registerBody>;
/** Validated login input. */
export type LoginBody = z.infer<typeof loginBody>;
/** Safe account DTO. */
export type AccountResponse = z.infer<typeof accountResponse>;
