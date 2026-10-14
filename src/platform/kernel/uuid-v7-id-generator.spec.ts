import { validate, version } from 'uuid';
import { UuidV7IdGenerator } from './uuid-v7-id-generator';

describe('UuidV7IdGenerator', () => {
  it('returns valid, distinct UUIDv7 values in creation order', () => {
    const generator = new UuidV7IdGenerator();
    const ids = Array.from({ length: 50 }, () => generator.next<'Village'>());
    for (const id of ids) {
      expect(validate(id)).toBe(true);
      expect(version(id)).toBe(7);
    }
    expect(new Set(ids).size).toBe(ids.length);
    // Time-ordered: sorting as text keeps the creation order.
    expect([...ids].sort()).toEqual(ids);
  });
});
