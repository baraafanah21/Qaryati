import { Injectable, Module } from '@nestjs/common';
import { relations } from 'drizzle-orm';
import { integer, pgTable, text } from 'drizzle-orm/pg-core';
import { Client } from 'pg';
import { InjectModuleDb, type ModuleDb } from '../../src/platform/database/database';
import { DatabaseModule } from '../../src/platform/database/database.module';

// Two fake modules, each with its own schema.ts, declared the way a real
// module would: camelCase properties, snake_case columns, relations.

export const alphaSchema = (() => {
  const alphaParent = pgTable('alpha_parent', {
    id: integer().primaryKey(),
    displayName: text().notNull(),
  });
  const alphaChild = pgTable('alpha_child', {
    id: integer().primaryKey(),
    parentId: integer().notNull(),
    label: text().notNull(),
  });
  const alphaParentRelations = relations(alphaParent, ({ many }) => ({
    children: many(alphaChild),
  }));
  const alphaChildRelations = relations(alphaChild, ({ one }) => ({
    parent: one(alphaParent, { fields: [alphaChild.parentId], references: [alphaParent.id] }),
  }));
  return { alphaParent, alphaChild, alphaParentRelations, alphaChildRelations };
})();

export const betaSchema = {
  betaItem: pgTable('beta_item', { id: integer().primaryKey(), title: text().notNull() }),
};

export type AlphaDb = ModuleDb<typeof alphaSchema>;
export type BetaDb = ModuleDb<typeof betaSchema>;

@Injectable()
export class AlphaRepository {
  constructor(@InjectModuleDb() readonly db: AlphaDb) {}
}

@Module({
  imports: [DatabaseModule.forFeature(alphaSchema)],
  providers: [AlphaRepository],
  exports: [AlphaRepository],
})
export class AlphaModule {}

@Injectable()
export class BetaRepository {
  constructor(@InjectModuleDb() readonly db: BetaDb) {}
}

@Module({
  imports: [DatabaseModule.forFeature(betaSchema)],
  providers: [BetaRepository],
  exports: [BetaRepository],
})
export class BetaModule {}

/** Creates the fake modules' tables as the owner, the way a migration would. */
export async function createFakeModuleTables(ownerUrl: string): Promise<void> {
  const owner = new Client({ connectionString: ownerUrl });
  await owner.connect();
  try {
    await owner.query(`
      CREATE TABLE alpha_parent (id integer PRIMARY KEY, display_name text NOT NULL);
      CREATE TABLE alpha_child (id integer PRIMARY KEY, parent_id integer NOT NULL REFERENCES alpha_parent, label text NOT NULL);
      CREATE TABLE beta_item (id integer PRIMARY KEY, title text NOT NULL);
    `);
  } finally {
    await owner.end();
  }
}
