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
process.env.SWAGGER_ENABLED = 'true';
