import { GOVERNORATE_CENTRES, generatePerfVillages, mulberry32 } from './perf-generator';
import { CURRENT_GOVERNORATES } from '../../modules/village/infrastructure/seed/governorates';
import { SEED_PRODUCTS } from '../../modules/economy/infrastructure/seed/products';
import { validateSlug } from '../../modules/village/domain/village-values';

describe('generatePerfVillages', () => {
  const villages = generatePerfVillages(300);

  it('is deterministic: the same count gives the same villages', () => {
    expect(generatePerfVillages(300)).toEqual(villages);
    expect(generatePerfVillages(10)).toEqual(villages.slice(0, 10));
  });

  it('gives each village a unique, valid slug', () => {
    const slugs = villages.map((v) => v.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(() => validateSlug(slug)).not.toThrow();
  });

  it('gives every village the facts the profile, filters and nearby search read', () => {
    for (const v of villages) {
      expect(v.nameAr).not.toBe('');
      expect(v.nameEn).not.toBe('');
      expect(v.population.length).toBeGreaterThanOrEqual(3);
      expect(v.population.length).toBeLessThanOrEqual(5);
      expect(v.landmarks.length).toBeGreaterThanOrEqual(2);
      expect(v.landmarks.length).toBeLessThanOrEqual(4);
      expect(v.products.length).toBeGreaterThanOrEqual(1);
      expect(v.products.length).toBeLessThanOrEqual(2);
    }
  });

  it('keeps every value inside the domain rules', () => {
    for (const v of villages) {
      const years = v.population.map((p) => p.referenceYear);
      expect(years).toEqual([...new Set(years)].sort((a, b) => a - b));
      for (const p of v.population) {
        expect(Number.isInteger(p.population)).toBe(true);
        expect(p.population).toBeGreaterThanOrEqual(0);
        expect(p.population).toBeLessThanOrEqual(1_000_000);
      }
      expect(new Set(v.landmarks.map((l) => l.name)).size).toBe(v.landmarks.length);
      expect(new Set(v.products.map((p) => p.code)).size).toBe(v.products.length);
      expect(Math.abs(v.latitude)).toBeLessThanOrEqual(90);
    }
  });

  it('uses only seeded governorates and products', () => {
    const codes = new Set<string>(CURRENT_GOVERNORATES.map((g) => g.code));
    expect(Object.keys(GOVERNORATE_CENTRES).every((code) => codes.has(code))).toBe(true);
    const products = new Set(SEED_PRODUCTS.map((p) => p.code));
    for (const v of villages) for (const p of v.products) expect(products.has(p.code)).toBe(true);
  });
});

describe('mulberry32', () => {
  it('repeats its sequence for a seed and stays in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 1000; i += 1) {
      const value = a();
      expect(value).toBe(b());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
