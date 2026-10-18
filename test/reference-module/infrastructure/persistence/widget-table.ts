// Reference: do NOT copy. A real module gets this SQL from `npm run db:generate` as a migration; the test-only widget table is created here.
import { Client } from 'pg';

/** The DDL drizzle-kit would generate for schema.ts, kept in sync by hand. */
export const CREATE_WIDGET_TABLE = `
  CREATE TABLE IF NOT EXISTS widget (
    id uuid PRIMARY KEY,
    name text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    deleted_at timestamp with time zone
  );
  CREATE UNIQUE INDEX IF NOT EXISTS widget_name_key ON widget (name) WHERE deleted_at IS NULL;
`;

/** Creates the widget table as the owner role, the way a migration would. */
export async function createWidgetTable(ownerUrl: string): Promise<void> {
  const owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  try {
    await owner.query(CREATE_WIDGET_TABLE);
  } finally {
    await owner.end();
  }
}
