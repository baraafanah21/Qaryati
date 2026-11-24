import { Body, Controller, Get, Header, HttpCode, Post } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
} from '@nestjs/swagger';
import { ETag } from '../../../platform/http/etag';
import { ApiModule, ApiProblems } from '../../../platform/http/openapi';
import { Public } from '../../../platform/http/public.decorator';
import { LoginRateLimit } from '../../../platform/http/rate-limit.decorators';
import { asId } from '../../../shared/kernel';
import type { AuthenticatedUser } from '../domain/authenticated-user';
import { GetCurrentAccount } from '../application/get-current-account.use-case';
import { LoginUser, type LoginResult } from '../application/login-user.use-case';
import { LogoutSession } from '../application/logout-session.use-case';
import { RefreshSession } from '../application/refresh-session.use-case';
import { RegisterUser } from '../application/register-user.use-case';
import { toAccountResponse, toCurrentAccountResponse } from './auth.mapper';
import {
  accountResponse,
  currentAccountResponse,
  loginBody,
  loginResponse,
  refreshTokenBody,
  registerBody,
  type AccountResponse,
  type CurrentAccountResponse,
  type LoginBody,
  type RefreshTokenBody,
  type RegisterBody,
} from './auth.schemas';
import { CurrentUser } from './current-user.decorator';

/** Credential entry points and the caller's own account; `me` keeps #10's default authentication. */
@ApiModule('iam')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly registration: RegisterUser,
    private readonly loginUser: LoginUser,
    private readonly refreshSession: RefreshSession,
    private readonly logoutSession: LogoutSession,
    private readonly currentAccount: GetCurrentAccount,
  ) {}

  @Public()
  @Post('register')
  @Header('Cache-Control', 'no-store')
  @ETag()
  @ApiOperation({ summary: 'Register a contributor account' })
  @ApiCreatedResponse({
    standardSchema: accountResponse,
    description: 'Created; ETag holds the account version.',
  })
  @ApiProblems(400, 409, 422)
  async register(@Body({ schema: registerBody }) body: RegisterBody): Promise<AccountResponse> {
    return toAccountResponse(await this.registration.execute(body));
  }

  @Public()
  @LoginRateLimit()
  @Post('login')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Issue access and refresh tokens',
    description:
      'INVALID_CREDENTIALS is returned for unknown email, wrong password, disabled account or ' +
      'an account locked after 10 consecutive failures (for 15 minutes, even with the right ' +
      'password). At most RATE_LIMIT_LOGIN_PER_MINUTE (5) attempts per minute per IP and email.',
  })
  @ApiOkResponse({ standardSchema: loginResponse })
  @ApiProblems(400, 401)
  login(@Body({ schema: loginBody }) body: LoginBody): Promise<LoginResult> {
    return this.loginUser.execute(body);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Rotate a refresh token into a new token pair',
    description:
      'The presented refresh token is revoked and replaced by a new one in the same family. ' +
      'Every rejection (unknown, expired, already used, disabled account) is the same ' +
      '401 INVALID_CREDENTIALS. Presenting an already used token revokes its whole family.',
  })
  @ApiOkResponse({ standardSchema: loginResponse })
  @ApiProblems(400, 401)
  refresh(@Body({ schema: refreshTokenBody }) body: RefreshTokenBody): Promise<LoginResult> {
    return this.refreshSession.execute(body.refreshToken);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({
    summary: 'End a session',
    description:
      "Revokes every active token of the refresh token's family. Always 204, also for an " +
      'unknown or already revoked token.',
  })
  @ApiNoContentResponse({ description: 'The session is ended (or there was none).' })
  @ApiProblems(400)
  async logout(@Body({ schema: refreshTokenBody }) body: RefreshTokenBody): Promise<void> {
    await this.logoutSession.execute(body.refreshToken);
  }

  @Get('me')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: "The caller's account",
    description: 'Read from the database, so a role or status change shows at once.',
  })
  @ApiOkResponse({ standardSchema: currentAccountResponse })
  @ApiProblems(401)
  async me(@CurrentUser() user: AuthenticatedUser): Promise<CurrentAccountResponse> {
    return toCurrentAccountResponse(
      await this.currentAccount.execute(asId<'UserAccount'>(user.id)),
    );
  }
}
