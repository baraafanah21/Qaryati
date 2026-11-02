import { ValidationError } from '../../../shared/kernel';
import { roundCoordinate, valueHash } from './value-hash';

describe('Claim value hashing', () => {
  describe('valueHash', () => {
    it('returns a SHA-256 hexadecimal hash', () => {
      expect(valueHash({ name: 'Village' })).toMatch(/^[a-f0-9]{64}$/);
    });

    it('produces the same hash regardless of object key order', () => {
      const first = { village: 'Jenin', population: 1200 };
      const second = { population: 1200, village: 'Jenin' };

      expect(valueHash(first)).toBe(valueHash(second));
    });

    it('sorts keys in nested objects', () => {
      const first = { location: { latitude: 32.5, longitude: 35.3 } };
      const second = { location: { longitude: 35.3, latitude: 32.5 } };

      expect(valueHash(first)).toBe(valueHash(second));
    });

    it('distinguishes a number from a string', () => {
      expect(valueHash(1)).not.toBe(valueHash('1'));
    });

    it('normalizes negative zero', () => {
      expect(valueHash(-0)).toBe(valueHash(0));
    });

    it('preserves null values', () => {
      expect(valueHash({ value: null })).not.toBe(valueHash({}));
    });

    it('distinguishes different array orders', () => {
      expect(valueHash([1, 2, 3])).not.toBe(valueHash([3, 2, 1]));
    });

    it.each([NaN, Infinity, -Infinity])('rejects non-finite number %s', (value) => {
      expect(() => valueHash(value)).toThrow(ValidationError);
    });

    it('rejects undefined values', () => {
      expect(() => valueHash({ value: undefined })).toThrow(ValidationError);
    });

    it('rejects unsupported objects', () => {
      expect(() => valueHash(new Date())).toThrow(ValidationError);
    });

    it('normalizes scientific notation consistently', () => {
      expect(valueHash(1e-7)).toBe(valueHash(0.0000001));
      expect(valueHash(1e21)).toBe(valueHash(1000000000000000000000));
    });
  });

  describe('roundCoordinate', () => {
    it('rounds coordinates to five decimal places', () => {
      expect(roundCoordinate(32.1234567)).toBe(32.12346);
    });

    it('preserves coordinates already within five decimals', () => {
      expect(roundCoordinate(35.12345)).toBe(35.12345);
    });

    it('supports negative coordinates', () => {
      expect(roundCoordinate(-32.123456)).toBe(-32.12346);
    });

    it.each([NaN, Infinity, -Infinity])('rejects invalid coordinates %s', (value) => {
      expect(() => roundCoordinate(value)).toThrow(ValidationError);
    });
  });
});
