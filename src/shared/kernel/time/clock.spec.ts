import { FixedClock, SystemClock } from './clock';

describe('FixedClock', () => {
  it('returns the instant it was given', () => {
    expect(new FixedClock('2026-10-15T08:00:00.000Z').now().toISOString()).toBe(
      '2026-10-15T08:00:00.000Z',
    );
  });

  it('can be set and advanced', () => {
    const clock = new FixedClock('2026-10-15T08:00:00.000Z');
    clock.advance(90_000);
    expect(clock.now().toISOString()).toBe('2026-10-15T08:01:30.000Z');
    clock.set(new Date('2027-01-01T00:00:00.000Z'));
    expect(clock.now().toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('is not moved by a caller mutating the returned date', () => {
    const clock = new FixedClock('2026-10-15T08:00:00.000Z');
    clock.now().setFullYear(1999);
    expect(clock.now().getUTCFullYear()).toBe(2026);
  });
});

describe('SystemClock', () => {
  it('returns the current time', () => {
    const before = Date.now();
    const now = new SystemClock().now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });
});
