/**
 * Drizzle tables owned by the geo module: none. Suggestions are not stored; an
 * accepted one becomes a village LOCATION claim (geo README).
 *
 * drizzle.config.ts picks this file up by its path, so tables declared here
 * land in the generated migrations. Only this module edits this file; other
 * modules reach the data through `index.ts`. See docs/database.md.
 */
export {};
