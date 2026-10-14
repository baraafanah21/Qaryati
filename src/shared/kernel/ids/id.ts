declare const idBrand: unique symbol;

/**
 * A UUID that names one kind of entity, e.g. `Id<'Village'>`. The brand exists
 * only at compile time; it stops a population id from being passed where a
 * village id is expected. At runtime it is a plain string.
 */
export type Id<Entity extends string> = string & { readonly [idBrand]: Entity };

/**
 * Marks a string as an id of `Entity`. Use it where an id enters from outside
 * the domain (a database row, a validated path parameter), never to make up ids.
 */
export function asId<Entity extends string>(value: string): Id<Entity> {
  return value as Id<Entity>;
}

/**
 * Creates new entity ids. Domain code receives ids from a generator and never
 * calls a UUID library itself, so tests can use predictable ids.
 */
export interface IdGenerator {
  next<Entity extends string>(): Id<Entity>;
}

/** Injection token of the application's {@link IdGenerator}. */
export const ID_GENERATOR = Symbol('ID_GENERATOR');

/**
 * Generator for tests: returns `00000000-0000-7000-8000-000000000001`,
 * `...0002`, and so on. Valid UUIDv7 syntax, easy to read in assertions.
 */
export class SequentialIdGenerator implements IdGenerator {
  private counter = 0;

  next<Entity extends string>(): Id<Entity> {
    this.counter += 1;
    return asId<Entity>(`00000000-0000-7000-8000-${this.counter.toString(16).padStart(12, '0')}`);
  }
}
