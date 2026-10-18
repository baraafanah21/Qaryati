// Reference: copy the domain unit test: no Nest, no database, fixed time and ids from the kernel's test doubles.
import {
  FixedClock,
  SequentialIdGenerator,
  ValidationError,
  type Id,
} from '../../../src/shared/kernel';
import { Widget } from './widget';

describe('Widget', () => {
  const clock = new FixedClock('2026-10-18T10:00:00Z');
  const ids = new SequentialIdGenerator();
  const newId = (): Id<'Widget'> => ids.next<'Widget'>();

  it('is created at version 1 with a trimmed name and the given time', () => {
    const widget = Widget.create({ id: newId(), name: '  Olive press  ', now: clock.now() });
    expect(widget.name).toBe('Olive press');
    expect(widget.version).toBe(1);
    expect(widget.createdAt).toEqual(new Date('2026-10-18T10:00:00Z'));
    expect(widget.updatedAt).toEqual(widget.createdAt);
  });

  it.each([
    ['', 'REQUIRED'],
    ['    ', 'REQUIRED'],
    ['x'.repeat(81), 'TOO_LONG'],
  ])('rejects the name %j with %s', (name, code) => {
    const attempt = () => Widget.create({ id: newId(), name, now: clock.now() });
    expect(attempt).toThrow(ValidationError);
    try {
      attempt();
    } catch (error) {
      expect((error as ValidationError).errors).toEqual([
        expect.objectContaining({ field: 'name', code }),
      ]);
    }
  });

  it('accepts exactly 80 characters', () => {
    expect(
      Widget.create({ id: newId(), name: 'x'.repeat(80), now: clock.now() }).name,
    ).toHaveLength(80);
  });

  it('renames with the same invariant and leaves the version to the database', () => {
    const widget = Widget.create({ id: newId(), name: 'Mill', now: clock.now() });
    const renamed = widget.rename(' Water mill ');
    expect(renamed.name).toBe('Water mill');
    expect(renamed.version).toBe(1);
    expect(widget.name).toBe('Mill');
    expect(() => widget.rename('')).toThrow(ValidationError);
  });

  it('snapshots only the allow-listed fields for the audit trail', () => {
    const widget = Widget.create({ id: newId(), name: 'Mill', now: clock.now() });
    expect(widget.snapshot()).toEqual({ name: 'Mill' });
  });
});
