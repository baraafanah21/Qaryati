/**
 * Side-effect module, imported first by src/generate-openapi.ts. Generating
 * the OpenAPI document builds the module graph without connecting anywhere,
 * but AppModule still validates the environment when it is imported. This
 * fills the required variables with placeholders, so the generator runs on a
 * machine (or CI job) with no `.env` and no database. Variables already set
 * are kept, except that Swagger is forced on: the document is the point.
 */
process.env.DATABASE_URL ??= 'postgres://openapi:openapi@localhost:5432/openapi';
process.env.LOG_LEVEL ??= 'silent';
// Preview mode never instantiates the key loader; no secret files are needed.
process.env.JWT_PRIVATE_KEY_FILE ??= 'openapi-placeholder-private.pem';
process.env.JWT_PUBLIC_KEY_FILE ??= 'openapi-placeholder-public.pem';
process.env.SWAGGER_ENABLED = 'true';
