import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { ApiModule, ApiProblems } from '../../../platform/http/openapi';
import { idParam } from '../../../platform/http/pagination';
import { Role, Roles } from '../../iam';
import { ListAuditEntries, type AuditLogPage } from '../application/list-audit-entries.use-case';
import {
  auditPageResponse,
  auditQuery,
  historyLogQuery,
  type AuditQuery,
  type HistoryLogQuery,
} from './audit.schemas';

const PAGING =
  'Newest first. Keyset pagination: pass the nextCursor of a page as ?cursor= for the next ' +
  'one (null on the last page); limit 1–100, default 20. before/after hold only the fields ' +
  "of the entity type's snapshot allow-list.";

/** `/api/v1/villages/{id}/history-log` and `/api/v1/audit`: the audit read APIs (#44). */
@ApiModule('audit')
@Controller()
export class AuditController {
  constructor(private readonly listEntries: ListAuditEntries) {}

  @Get('villages/:id/history-log')
  @Roles(Role.EDITOR)
  @ApiOperation({
    summary: 'List the audit entries of one village',
    description:
      `EDITOR+. Every recorded change that belongs to the village. ${PAGING} An unknown id ` +
      'returns an empty page, not 404: the trail outlives the rows it describes, so the ' +
      'history of a deleted village stays readable.',
  })
  @ApiOkResponse({ standardSchema: auditPageResponse })
  @ApiProblems(400)
  historyLog(
    @Param('id', { schema: idParam }) id: string,
    @Query({ schema: historyLogQuery }) query: HistoryLogQuery,
  ): Promise<AuditLogPage> {
    return this.listEntries.execute({
      filter: { villageId: id },
      cursor: query.cursor,
      limit: query.limit,
    });
  }

  @Get('audit')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'List the audit trail',
    description:
      `ADMIN. Every given filter must match; from is inclusive, to exclusive. ${PAGING} ` +
      '400 for an invalid cursor or an empty time range.',
  })
  @ApiOkResponse({ standardSchema: auditPageResponse })
  @ApiProblems(400)
  list(@Query({ schema: auditQuery }) query: AuditQuery): Promise<AuditLogPage> {
    return this.listEntries.execute({
      filter: {
        actorId: query.actorId,
        entityType: query.entityType,
        entityId: query.entityId,
        action: query.action,
        from: query.from === undefined ? undefined : new Date(query.from),
        to: query.to === undefined ? undefined : new Date(query.to),
      },
      cursor: query.cursor,
      limit: query.limit,
    });
  }
}
