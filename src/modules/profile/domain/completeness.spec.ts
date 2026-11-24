import { completenessOf } from './completeness';

const TYPES = ['A', 'B', 'C', 'D'] as const;

describe('completenessOf', () => {
  it('is 0 with every type missing when nothing is published', () => {
    expect(completenessOf(TYPES, [])).toEqual({ score: 0, present: [], missing: [...TYPES] });
  });

  it('is 100 with nothing missing when every type is published', () => {
    expect(completenessOf(TYPES, ['D', 'C', 'B', 'A'])).toEqual({
      score: 100,
      present: [...TYPES],
      missing: [],
    });
  });

  it('keeps the order of the full list, whatever the order of the published types', () => {
    expect(completenessOf(TYPES, ['C', 'A'])).toEqual({
      score: 50,
      present: ['A', 'C'],
      missing: ['B', 'D'],
    });
  });

  it('rounds down, so a score of 100 always means complete', () => {
    const many = Array.from({ length: 13 }, (_, i) => `T${i}`);
    expect(completenessOf(many, many.slice(0, 12)).score).toBe(92);
    expect(completenessOf(many, many.slice(0, 1)).score).toBe(7);
  });

  it('ignores duplicates and unknown published types', () => {
    expect(completenessOf(TYPES, ['A', 'A', 'X']).score).toBe(25);
  });

  it('treats an empty list of types as complete', () => {
    expect(completenessOf([], ['A']).score).toBe(100);
  });
});
