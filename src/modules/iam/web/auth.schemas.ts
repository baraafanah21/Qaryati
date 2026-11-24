import { z } from 'zod';
import { paginationQuery } from '../../../platform/http/pagination';
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
/** Raw refresh tokens are returned only by a successful login or refresh, once each. */
export const loginResponse = z
  .strictObject({
    accessToken: z.string(),
    refreshToken: z.string(),
    tokenType: z.literal('Bearer'),
    expiresIn: z.int().positive(),
  })
  .meta({
    id: 'LoginResponse',
    examples: [
      {
        // Placeholders, not token-shaped values: secret scanners flag realistic examples.
        accessToken: '<signed JWT>',
        refreshToken: '<opaque refresh token>',
        tokenType: 'Bearer',
        expiresIn: 900,
      },
    ],
  });
/** A refresh token exactly as login or refresh returned it (43 base64url characters today). */
export const refreshTokenBody = z.strictObject({ refreshToken: z.string().min(1).max(512) }).meta({
  id: 'RefreshTokenRequest',
  examples: [{ refreshToken: '<refresh token from login or refresh>' }],
});
/** The caller's own account, read from the database; never credential fields. */
export const currentAccountResponse = z
  .strictObject({
    id: z.uuid(),
    email: z.string(),
    role: z.enum(Object.values(Role)),
    status: z.enum(Object.values(AccountStatus)),
  })
  .meta({
    id: 'CurrentAccountResponse',
    examples: [
      {
        id: '0192f0c8-7b1e-7c3a-9d2e-4f5a6b7c8d9e',
        email: 'contributor@example.org',
        role: 'CONTRIBUTOR',
        status: 'ACTIVE',
      },
    ],
  });
/** Validated refresh or logout input. */
export type RefreshTokenBody = z.infer<typeof refreshTokenBody>;
/** Safe current-account DTO. */
export type CurrentAccountResponse = z.infer<typeof currentAccountResponse>;
/** Validated registration input. */
export type RegisterBody = z.infer<typeof registerBody>;
/** Validated login input. */
export type LoginBody = z.infer<typeof loginBody>;
/** Safe account DTO. */
export type AccountResponse = z.infer<typeof accountResponse>;

/** `GET /users` filters (#32); allowed values come from the domain. */
export const listUsersQuery = paginationQuery.extend({
  role: z.enum(Object.values(Role)).optional(),
  status: z.enum(Object.values(AccountStatus)).optional(),
});
/** `PATCH /users/{id}/role` body. */
export const changeRoleBody = z
  .strictObject({ role: z.enum(Object.values(Role)) })
  .meta({ id: 'ChangeRoleRequest', examples: [{ role: 'EDITOR' }] });
/** `PATCH /users/{id}/status` body. */
export const changeStatusBody = z
  .strictObject({ status: z.enum(Object.values(AccountStatus)) })
  .meta({ id: 'ChangeStatusRequest', examples: [{ status: 'DISABLED' }] });
/** Validated user-list query. */
export type ListUsersQuery = z.infer<typeof listUsersQuery>;
/** Validated role change. */
export type ChangeRoleBody = z.infer<typeof changeRoleBody>;
/** Validated status change. */
export type ChangeStatusBody = z.infer<typeof changeStatusBody>;
