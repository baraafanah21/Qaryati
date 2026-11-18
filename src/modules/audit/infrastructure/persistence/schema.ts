import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Drizzle tables owned by the audit module.
 *
 * drizzle.config.ts picks this file up by its path, so tables declared here
 * land in the generated migrations. Only this module edits this file; nobody
 * imports audit. See docs/database.md.
 */

/**
 * One recorded change. Append-only: no version columns and no `updated_at`,
 * and the migration `audit_entry_append_only` revokes `UPDATE`, `DELETE` and
 * `TRUNCATE` from the runtime role.
 *
 * No foreign keys on purpose: the trail must outlive the rows it describes
 * (an admin hard-deletes spam, its audit entries stay), and audit imports no
 * other module.
 */
export const auditEntry = pgTable(
  'audit_entry',
  {
    id: uuid().primaryKey(),
    /** `<entity>.<pastTenseVerb>`, e.g. `source.created`. */
    action: text().notNull(),
    entityType: text().notNull(),
    /** Text, not uuid: some entities are identified by codes or family ids. */
    entityId: text().notNull(),
    villageId: uuid(),
    /** Null for system actions and anonymous requests (registration). */
    actorId: uuid(),
    requestId: text(),
    occurredAt: timestamp({ withTimezone: true }).notNull(),
    before: jsonb().$type<Record<string, unknown>>(),
    after: jsonb().$type<Record<string, unknown>>(),
  },
  // The read APIs (#44) page newest first with a keyset on (occurred_at, id);
  // `id` is the tie-breaker for entries recorded at the same instant.
  (table) => [
    index('audit_entry_entity_idx').on(
      table.entityType,
      table.entityId,
      table.occurredAt.desc(),
      table.id.desc(),
    ),
    index('audit_entry_village_idx').on(table.villageId, table.occurredAt.desc(), table.id.desc()),
    index('audit_entry_actor_idx').on(table.actorId, table.occurredAt.desc(), table.id.desc()),
    index('audit_entry_occurred_idx').on(table.occurredAt.desc(), table.id.desc()),
  ],
);
