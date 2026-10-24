// Database-only integration suites validate configuration but do not load IAM keys.
// E2E global setup supplies actual temporary files before workers start.
process.env.JWT_PRIVATE_KEY_FILE ??= 'unused-test-private.pem';
process.env.JWT_PUBLIC_KEY_FILE ??= 'unused-test-public.pem';
process.env.JWT_ISSUER = 'qaryati-test';
