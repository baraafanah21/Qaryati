// Defaults for every test worker (unit, integration and e2e).
// Rate limiting is off: the e2e suites share one Redis and one client IP, so they
// would throttle each other. test/security.e2e-spec.ts turns it on for itself.
process.env.RATE_LIMIT_ENABLED ??= 'false';
// Several apps start in parallel workers; port 0 lets the OS pick a free one.
process.env.METRICS_PORT ??= '0';
