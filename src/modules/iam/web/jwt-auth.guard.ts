import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RequestContext } from '../../../platform/context/request-context';
import { OPTIONAL_USER, PUBLIC_ROUTE } from '../../../platform/http/public.decorator';
import { AccessTokenVerifier } from '../application/access-token-verifier';
import type { AuthenticatedRequest } from './current-user.decorator';

/**
 * Protects every routed endpoint unless it explicitly declares @Public().
 * A `@Public({ optionalUser: true })` route verifies a token only when one is sent.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: AccessTokenVerifier,
    private readonly requestContext: RequestContext,
  ) {}

  /** Establishes the actor only after successful cryptographic and claim verification. */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, targets)) {
      const optional = this.reflector.getAllAndOverride<boolean>(OPTIONAL_USER, targets);
      if (optional && request.headers.authorization) await this.authenticate(request);
      return true;
    }
    await this.authenticate(request);
    return true;
  }

  private async authenticate(request: AuthenticatedRequest): Promise<void> {
    const match = /^Bearer ([^\s,]+)$/i.exec(request.headers.authorization ?? '');
    if (!match?.[1]) throw new UnauthorizedException('A valid bearer access token is required.');
    let user;
    try {
      user = await this.verifier.verify(match[1]);
    } catch {
      throw new UnauthorizedException('A valid bearer access token is required.');
    }
    request.user = user;
    this.requestContext.setActorId(user.id);
  }
}
