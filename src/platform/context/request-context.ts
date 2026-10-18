import { Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';

// CLS key of the authenticated user. A symbol, so no other code can collide with it.
const ACTOR_ID = Symbol('ACTOR_ID');

/**
 * Typed access to the per-request context (nestjs-cls): the request ID and,
 * once a guard has authenticated the caller, the actor ID. Platform code that
 * needs "who and which request" (the audit recorder, logs) reads it here
 * instead of passing those values through every use case.
 *
 * Outside a request (a startup hook, a test without HTTP) there is no
 * context: both getters return `undefined`.
 */
@Injectable()
export class RequestContext {
  constructor(private readonly cls: ClsService) {}

  /** The request ID, the same value as the `X-Request-Id` header and `traceId`. */
  get requestId(): string | undefined {
    return this.cls.isActive() ? this.cls.getId() : undefined;
  }

  /** The authenticated user's id, or `undefined` for an anonymous request. */
  get actorId(): string | undefined {
    return this.cls.isActive() ? this.cls.get<string | undefined>(ACTOR_ID) : undefined;
  }

  /**
   * Records the authenticated user for the rest of the request. Called by the
   * auth guard (#10) after it has verified the token, and by nothing else.
   *
   * @throws Error outside a request context: an actor without a request is a bug.
   */
  setActorId(actorId: string): void {
    if (!this.cls.isActive()) {
      throw new Error('RequestContext.setActorId called outside a request context.');
    }
    this.cls.set(ACTOR_ID, actorId);
  }
}
