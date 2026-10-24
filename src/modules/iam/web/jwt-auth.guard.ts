import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RequestContext } from '../../../platform/context/request-context';
import { PUBLIC_ROUTE } from '../../../platform/http/public.decorator';
import { AccessTokenVerifier } from '../application/access-token-verifier';
import type { AuthenticatedRequest } from './current-user.decorator';

/** Protects every routed endpoint unless it explicitly declares @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: AccessTokenVerifier,
    private readonly requestContext: RequestContext,
  ) {}

  /** Establishes the actor only after successful cryptographic and claim verification. */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
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
    return true;
  }
}
