import { Body, Controller, Header, HttpCode, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { ETag } from '../../../platform/http/etag';
import { ApiModule, ApiProblems } from '../../../platform/http/openapi';
import { Public } from '../../../platform/http/public.decorator';
import { LoginUser, type LoginResult } from '../application/login-user.use-case';
import { RegisterUser } from '../application/register-user.use-case';
import { toAccountResponse } from './auth.mapper';
import {
  accountResponse,
  loginBody,
  loginResponse,
  registerBody,
  type AccountResponse,
  type LoginBody,
  type RegisterBody,
} from './auth.schemas';

/** Public credential entry points; all other routes retain #10's default authentication. */
@ApiModule('iam')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly registration: RegisterUser,
    private readonly loginUser: LoginUser,
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
  @Post('login')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Issue access and refresh tokens',
    description:
      'INVALID_CREDENTIALS is returned for unknown email, wrong password or unavailable account.',
  })
  @ApiOkResponse({ standardSchema: loginResponse })
  @ApiProblems(400, 401)
  login(@Body({ schema: loginBody }) body: LoginBody): Promise<LoginResult> {
    return this.loginUser.execute(body);
  }
}
