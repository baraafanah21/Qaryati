/**
 * Source of the current time. Domain and application code ask a `Clock`
 * instead of calling `new Date()` or `Date.now()` (an ESLint rule forbids
 * both there), so time-dependent rules can be tested with a fixed instant.
 */
export interface Clock {
  now(): Date;
}

/** Injection token of the application's {@link Clock}: `@Inject(CLOCK) clock: Clock`. */
export const CLOCK = Symbol('CLOCK');

/** The real clock, provided under {@link CLOCK} in the running app. */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** A clock for tests that returns a fixed instant until moved. */
export class FixedClock implements Clock {
  private current: Date;

  constructor(instant: Date | string = '2026-01-01T00:00:00.000Z') {
    this.current = new Date(instant);
  }

  now(): Date {
    // A copy, so a caller mutating the result cannot move the clock.
    return new Date(this.current);
  }

  /** Moves the clock to `instant`. */
  set(instant: Date | string): void {
    this.current = new Date(instant);
  }

  /** Moves the clock forward by `ms` milliseconds. */
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
