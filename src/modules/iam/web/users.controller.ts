import { Body, Controller, Get, Header, Param, Patch, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { ETag, IfMatch } from '../../../platform/http/etag';
import { ApiModule, ApiProblems } from '../../../platform/http/openapi';
import { idParam, pageResponse } from '../../../platform/http/pagination';
import { mapPage, type Page } from '../../../shared/kernel';
import { ChangeUserAccess, ListUsers } from '../application/administer-users.use-case';
import { Role, type AuthenticatedUser } from '../domain/authenticated-user';
import { toAccountResponse } from './auth.mapper';
import {
  accountResponse,
  changeRoleBody,
  changeStatusBody,
  listUsersQuery,
  type AccountResponse,
  type ChangeRoleBody,
  type ChangeStatusBody,
  type ListUsersQuery,
} from './auth.schemas';
import { CurrentUser } from './current-user.decorator';
import { Roles } from './roles.decorator';

const REVOKES =
  'Revokes every refresh token of the account, so the user must log in again. Access ' +
  'tokens already issued stay valid until they expire (JWT_ACCESS_TTL). An administrator ' +
  'cannot change their own account (422 SELF_ADMINISTRATION_FORBIDDEN).';

/** User administration (#32): administrators only. */
@ApiModule('iam')
@Roles(Role.ADMIN)
@Controller('users')
export class UsersController {
  constructor(
    private readonly listUsers: ListUsers,
    private readonly access: ChangeUserAccess,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'List user accounts, oldest first, filtered by role and status' })
  @ApiOkResponse({ standardSchema: pageResponse(accountResponse) })
  @ApiProblems(400, 403)
  async list(
    @Query({ schema: listUsersQuery }) query: ListUsersQuery,
  ): Promise<Page<AccountResponse>> {
    return mapPage(await this.listUsers.execute(query), toAccountResponse);
  }

  @Patch(':id/role')
  @ETag()
  @ApiOperation({ summary: "Change a user's role", description: REVOKES })
  @ApiOkResponse({ standardSchema: accountResponse })
  @ApiProblems(400, 403, 404, 412, 422, 428)
  async changeRole(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', { schema: idParam }) id: string,
    @IfMatch() expectedVersion: number,
    @Body({ schema: changeRoleBody }) body: ChangeRoleBody,
  ): Promise<AccountResponse> {
    return toAccountResponse(
      await this.access.changeRole({
        actorId: actor.id,
        accountId: id,
        expectedVersion,
        role: body.role,
      }),
    );
  }

  @Patch(':id/status')
  @ETag()
  @ApiOperation({ summary: "Enable or disable a user's account", description: REVOKES })
  @ApiOkResponse({ standardSchema: accountResponse })
  @ApiProblems(400, 403, 404, 412, 422, 428)
  async changeStatus(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id', { schema: idParam }) id: string,
    @IfMatch() expectedVersion: number,
    @Body({ schema: changeStatusBody }) body: ChangeStatusBody,
  ): Promise<AccountResponse> {
    return toAccountResponse(
      await this.access.changeStatus({
        actorId: actor.id,
        accountId: id,
        expectedVersion,
        status: body.status,
      }),
    );
  }
}
