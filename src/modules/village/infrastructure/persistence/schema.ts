/**
 * Drizzle tables owned by the village module. Planned:
 * `village`, `village_name`, `name_origin`, `admin_unit`, `village_affiliation`,
 * `village_relation`.
 *
 * drizzle.config.ts picks this file up by its path, so tables declared here
 * land in the generated migrations. Only this module edits this file; other
 * modules reach the data through `index.ts`. See docs/database.md.
 */
export {};
