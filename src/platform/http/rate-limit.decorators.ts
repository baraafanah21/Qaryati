import { SetMetadata } from '@nestjs/common';

/** Metadata key of {@link LoginRateLimit}. */
export const LOGIN_RATE_LIMIT = 'qaryati:loginRateLimit';
/** Metadata key of {@link SkipRateLimit}. */
export const SKIP_RATE_LIMIT = 'qaryati:skipRateLimit';

/**
 * Adds the login limit (`RATE_LIMIT_LOGIN_PER_MINUTE`, keyed by client IP and the
 * `email` of the body) on top of the anonymous limit. For credential endpoints, so
 * that guessing passwords for one account is slow even from many sessions.
 */
export const LoginRateLimit = (): MethodDecorator => SetMetadata(LOGIN_RATE_LIMIT, true);

/**
 * Exempts a route from every rate limit. Only for probes an orchestrator calls on
 * a schedule (health), never for business endpoints.
 */
export const SkipRateLimit = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SKIP_RATE_LIMIT, true);
