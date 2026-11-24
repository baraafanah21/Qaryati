import type { ProductCategory } from '../../domain/economy-values';

/**
 * The common products of Palestinian villages: the single source of the list.
 *
 * The data migration `0023_seed_products.sql` inserts exactly these rows
 * (fixed ids, `ON CONFLICT (code) DO NOTHING`), and
 * `test/economy/economy.int-spec.ts` checks that the migrated database matches
 * this file. Change both together, in a new migration.
 */
export const SEED_PRODUCTS: readonly {
  id: string;
  code: string;
  category: ProductCategory;
  nameAr: string;
  nameEn: string;
}[] = [
  {
    id: '01a20db1-12b4-7421-9ec7-12d928a79af1',
    code: 'olives',
    category: 'CROP',
    nameAr: 'زيتون',
    nameEn: 'Olives',
  },
  {
    id: '01a20db1-12b5-7174-8c9e-163d9074b3c1',
    code: 'olive-oil',
    category: 'INDUSTRY',
    nameAr: 'زيت زيتون',
    nameEn: 'Olive oil',
  },
  {
    id: '01a20db1-12b5-7174-8c9e-1a75ed9f4e7f',
    code: 'grapes',
    category: 'CROP',
    nameAr: 'عنب',
    nameEn: 'Grapes',
  },
  {
    id: '01a20db1-12b5-7174-8c9e-1c01b0203402',
    code: 'figs',
    category: 'CROP',
    nameAr: 'تين',
    nameEn: 'Figs',
  },
  {
    id: '01a20db1-12b5-7174-8c9e-216e926b10ac',
    code: 'wheat',
    category: 'CROP',
    nameAr: 'قمح',
    nameEn: 'Wheat',
  },
  {
    id: '01a20db1-12b5-7174-8c9e-254f21427802',
    code: 'barley',
    category: 'CROP',
    nameAr: 'شعير',
    nameEn: 'Barley',
  },
  {
    id: '01a20db1-12b5-7174-8c9e-2bee2836a629',
    code: 'almonds',
    category: 'CROP',
    nameAr: 'لوز',
    nameEn: 'Almonds',
  },
  {
    id: '01a20db1-12b5-7174-8c9e-2cc39c5d1b93',
    code: 'citrus',
    category: 'CROP',
    nameAr: 'حمضيات',
    nameEn: 'Citrus',
  },
  {
    id: '01a20db1-12b5-7174-8c9e-32c975d0b20e',
    code: 'vegetables',
    category: 'CROP',
    nameAr: 'خضار',
    nameEn: 'Vegetables',
  },
  {
    id: '01a20db1-12b5-7174-8c9e-34f39279f13c',
    code: 'sheep-and-goats',
    category: 'LIVESTOCK',
    nameAr: 'أغنام وماعز',
    nameEn: 'Sheep and goats',
  },
  {
    id: '01a20db1-12b5-7174-8c9e-391351a73536',
    code: 'honey',
    category: 'LIVESTOCK',
    nameAr: 'عسل',
    nameEn: 'Honey',
  },
  {
    id: '01a20db1-12b5-7174-8c9e-3ec20e63bf3e',
    code: 'embroidery',
    category: 'CRAFT',
    nameAr: 'تطريز',
    nameEn: 'Embroidery',
  },
  {
    id: '01a20db1-12b5-7174-8c9e-4357e3c83b61',
    code: 'pottery',
    category: 'CRAFT',
    nameAr: 'فخار',
    nameEn: 'Pottery',
  },
  {
    id: '01a20db1-12b5-7174-8c9e-4449f8fb4576',
    code: 'stone-quarrying',
    category: 'INDUSTRY',
    nameAr: 'محاجر حجر',
    nameEn: 'Stone quarrying',
  },
  {
    id: '01a20db1-12b5-7174-8c9e-4bb846c52003',
    code: 'soap',
    category: 'INDUSTRY',
    nameAr: 'صابون',
    nameEn: 'Soap',
  },
];
