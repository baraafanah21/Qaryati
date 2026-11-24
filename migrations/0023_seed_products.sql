-- Data migration: the common products of Palestinian villages (#22).
-- The list lives once in src/modules/economy/infrastructure/seed/products.ts;
-- test/economy/economy.int-spec.ts checks that this data matches it.
-- Idempotent: an existing code is left untouched.
INSERT INTO "product" ("id", "code", "category", "name_ar", "name_en", "version", "created_at", "updated_at") VALUES
  ('01a20db1-12b4-7421-9ec7-12d928a79af1', 'olives', 'CROP', 'زيتون', 'Olives', 1, now(), now()),
  ('01a20db1-12b5-7174-8c9e-163d9074b3c1', 'olive-oil', 'INDUSTRY', 'زيت زيتون', 'Olive oil', 1, now(), now()),
  ('01a20db1-12b5-7174-8c9e-1a75ed9f4e7f', 'grapes', 'CROP', 'عنب', 'Grapes', 1, now(), now()),
  ('01a20db1-12b5-7174-8c9e-1c01b0203402', 'figs', 'CROP', 'تين', 'Figs', 1, now(), now()),
  ('01a20db1-12b5-7174-8c9e-216e926b10ac', 'wheat', 'CROP', 'قمح', 'Wheat', 1, now(), now()),
  ('01a20db1-12b5-7174-8c9e-254f21427802', 'barley', 'CROP', 'شعير', 'Barley', 1, now(), now()),
  ('01a20db1-12b5-7174-8c9e-2bee2836a629', 'almonds', 'CROP', 'لوز', 'Almonds', 1, now(), now()),
  ('01a20db1-12b5-7174-8c9e-2cc39c5d1b93', 'citrus', 'CROP', 'حمضيات', 'Citrus', 1, now(), now()),
  ('01a20db1-12b5-7174-8c9e-32c975d0b20e', 'vegetables', 'CROP', 'خضار', 'Vegetables', 1, now(), now()),
  ('01a20db1-12b5-7174-8c9e-34f39279f13c', 'sheep-and-goats', 'LIVESTOCK', 'أغنام وماعز', 'Sheep and goats', 1, now(), now()),
  ('01a20db1-12b5-7174-8c9e-391351a73536', 'honey', 'LIVESTOCK', 'عسل', 'Honey', 1, now(), now()),
  ('01a20db1-12b5-7174-8c9e-3ec20e63bf3e', 'embroidery', 'CRAFT', 'تطريز', 'Embroidery', 1, now(), now()),
  ('01a20db1-12b5-7174-8c9e-4357e3c83b61', 'pottery', 'CRAFT', 'فخار', 'Pottery', 1, now(), now()),
  ('01a20db1-12b5-7174-8c9e-4449f8fb4576', 'stone-quarrying', 'INDUSTRY', 'محاجر حجر', 'Stone quarrying', 1, now(), now()),
  ('01a20db1-12b5-7174-8c9e-4bb846c52003', 'soap', 'INDUSTRY', 'صابون', 'Soap', 1, now(), now())
ON CONFLICT ("code") DO NOTHING;
