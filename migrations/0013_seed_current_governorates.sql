-- Data migration: the 16 current governorates (#19).
-- The list lives once in src/modules/village/infrastructure/seed/governorates.ts;
-- test/village/governorates-seed.int-spec.ts checks that this data matches it.
-- Idempotent: an existing code is left untouched.
INSERT INTO "admin_unit" ("id", "code", "parent_id", "unit_type", "authority_type", "era", "name_ar", "name_en", "version", "created_at", "updated_at") VALUES
  ('01a1ef5b-4742-704c-8b62-1016335f1730', 'jenin', NULL, 'GOVERNORATE', NULL, 'CURRENT', 'جنين', 'Jenin', 1, now(), now()),
  ('01a1ef5b-4743-7675-af03-024a12726662', 'tubas', NULL, 'GOVERNORATE', NULL, 'CURRENT', 'طوباس والأغوار الشمالية', 'Tubas and Northern Valleys', 1, now(), now()),
  ('01a1ef5b-4743-7675-af03-05cf78865fdc', 'tulkarm', NULL, 'GOVERNORATE', NULL, 'CURRENT', 'طولكرم', 'Tulkarm', 1, now(), now()),
  ('01a1ef5b-4743-7675-af03-0a3e8e12309a', 'nablus', NULL, 'GOVERNORATE', NULL, 'CURRENT', 'نابلس', 'Nablus', 1, now(), now()),
  ('01a1ef5b-4743-7675-af03-0e49e3c8dac5', 'qalqilya', NULL, 'GOVERNORATE', NULL, 'CURRENT', 'قلقيلية', 'Qalqilya', 1, now(), now()),
  ('01a1ef5b-4743-7675-af03-1165709e8437', 'salfit', NULL, 'GOVERNORATE', NULL, 'CURRENT', 'سلفيت', 'Salfit', 1, now(), now()),
  ('01a1ef5b-4743-7675-af03-1666d136e57c', 'ramallah-al-bireh', NULL, 'GOVERNORATE', NULL, 'CURRENT', 'رام الله والبيرة', 'Ramallah and Al-Bireh', 1, now(), now()),
  ('01a1ef5b-4743-7675-af03-19958b060a5e', 'jericho-al-aghwar', NULL, 'GOVERNORATE', NULL, 'CURRENT', 'أريحا والأغوار', 'Jericho and Al-Aghwar', 1, now(), now()),
  ('01a1ef5b-4743-7675-af03-1c2424b059f8', 'jerusalem', NULL, 'GOVERNORATE', NULL, 'CURRENT', 'القدس', 'Jerusalem', 1, now(), now()),
  ('01a1ef5b-4743-7675-af03-237679f58681', 'bethlehem', NULL, 'GOVERNORATE', NULL, 'CURRENT', 'بيت لحم', 'Bethlehem', 1, now(), now()),
  ('01a1ef5b-4743-7675-af03-27504aed438a', 'hebron', NULL, 'GOVERNORATE', NULL, 'CURRENT', 'الخليل', 'Hebron', 1, now(), now()),
  ('01a1ef5b-4743-7675-af03-29b38c18c151', 'north-gaza', NULL, 'GOVERNORATE', NULL, 'CURRENT', 'شمال غزة', 'North Gaza', 1, now(), now()),
  ('01a1ef5b-4743-7675-af03-2e1d62c261c9', 'gaza', NULL, 'GOVERNORATE', NULL, 'CURRENT', 'غزة', 'Gaza', 1, now(), now()),
  ('01a1ef5b-4743-7675-af03-33e25d6613a1', 'deir-al-balah', NULL, 'GOVERNORATE', NULL, 'CURRENT', 'دير البلح', 'Deir al-Balah', 1, now(), now()),
  ('01a1ef5b-4743-7675-af03-35105842b3cf', 'khan-yunis', NULL, 'GOVERNORATE', NULL, 'CURRENT', 'خان يونس', 'Khan Yunis', 1, now(), now()),
  ('01a1ef5b-4743-7675-af03-3b7d23dfd1cb', 'rafah', NULL, 'GOVERNORATE', NULL, 'CURRENT', 'رفح', 'Rafah', 1, now(), now())
ON CONFLICT ("code") DO NOTHING;
