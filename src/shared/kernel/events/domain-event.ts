/**
 * Something that happened in the domain, named in the past tense with the
 * owning module as prefix: `village.published`, `population.recordAdded`.
 *
 * Events are plain data. Other modules react to them without importing the
 * publisher, which is how a module reaches one it may not depend on (for
 * example `profile` evicting its cache when a village changes).
 */
export interface DomainEvent<
  TName extends string = string,
  TPayload extends object = Record<string, unknown>,
> {
  /** `<module>.<pastTenseVerb>`; listeners subscribe by this name. */
  readonly name: TName;
  /** When the change happened, from the injected `Clock`. */
  readonly occurredAt: Date;
  /** Id of the aggregate that changed. */
  readonly aggregateId: string;
  /** Facts listeners need. Plain, serialisable values only: no entities, no secrets. */
  readonly payload: TPayload;
}

/**
 * Port for publishing domain events from use cases.
 *
 * Inside a transaction the event is held back and delivered only after the
 * transaction commits; if it rolls back, the event is dropped. Outside a
 * transaction it is delivered at once. Either way `publish` never fails
 * because of a listener: listener errors are logged, not thrown
 * (docs/kernel.md, "Domain events").
 */
export interface DomainEventPublisher {
  publish(event: DomainEvent): Promise<void>;
}

/** Injection token of the {@link DomainEventPublisher}. */
export const DOMAIN_EVENT_PUBLISHER = Symbol('DOMAIN_EVENT_PUBLISHER');
