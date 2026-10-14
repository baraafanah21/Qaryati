import { asId, SequentialIdGenerator, type Id } from './id';

describe('SequentialIdGenerator', () => {
  it('returns predictable, increasing UUIDv7-shaped ids', () => {
    const ids = new SequentialIdGenerator();
    expect(ids.next()).toBe('00000000-0000-7000-8000-000000000001');
    expect(ids.next()).toBe('00000000-0000-7000-8000-000000000002');
  });
});

describe('Id', () => {
  it('keeps ids of different entities apart at compile time', () => {
    const villageId: Id<'Village'> = asId<'Village'>('00000000-0000-7000-8000-000000000001');
    // @ts-expect-error a village id is not a population record id
    const recordId: Id<'PopulationRecord'> = villageId;
    // @ts-expect-error a plain string is not an id until asId says so
    const fromString: Id<'Village'> = 'not-checked';
    expect([recordId, fromString]).toHaveLength(2);
  });
});
