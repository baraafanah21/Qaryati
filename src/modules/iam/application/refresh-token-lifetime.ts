/**
 * Configured refresh-token lifetime (`JWT_REFRESH_TTL`, seven days by default), bound
 * once by IamModule so use cases never hard-code it.
 */
export class RefreshTokenLifetime {
  constructor(readonly seconds: number) {}
}
