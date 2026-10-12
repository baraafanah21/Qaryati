/**
 * Drizzle tables owned by the heritage module. Planned:
 * `history_overview`, `historical_event`, `landmark`, `cultural_item`.
 *
 * drizzle.config.ts picks this file up by its path, so tables declared here
 * land in the generated migrations. Only this module edits this file; other
 * modules reach the data through `index.ts`. See docs/database.md.
 */
export {};
