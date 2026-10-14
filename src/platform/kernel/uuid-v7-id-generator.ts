import { v7 as uuidv7 } from 'uuid';
import { asId, type Id, type IdGenerator } from '../../shared/kernel';

/**
 * Production {@link IdGenerator}: UUIDv7. The first 48 bits are a millisecond
 * timestamp, so new ids are roughly ordered and B-tree inserts stay local
 * instead of scattering across the index like UUIDv4 (docs/tech-stack.md).
 */
export class UuidV7IdGenerator implements IdGenerator {
  next<Entity extends string>(): Id<Entity> {
    return asId<Entity>(uuidv7());
  }
}
