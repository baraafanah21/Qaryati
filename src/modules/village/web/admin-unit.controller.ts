import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { ETag } from '../../../platform/http/etag';
import { ApiModule, ApiProblems } from '../../../platform/http/openapi';
import { NotFoundError } from '../../../shared/kernel';
import { Public } from '../../iam';
import { AdminUnitQueries } from '../application/admin-unit-queries';
import type { AdminUnit } from '../domain/admin-unit';
import {
  adminUnitListResponse,
  adminUnitResponse,
  idOrCodeParam,
  listAdminUnitsQuery,
  type AdminUnitResponse,
  type ListAdminUnitsQuery,
} from './admin-unit.schemas';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toAdminUnitResponse(unit: AdminUnit): AdminUnitResponse {
  return {
    id: unit.id,
    code: unit.code,
    parentId: unit.parentId,
    unitType: unit.unitType,
    authorityType: unit.authorityType,
    era: unit.era,
    nameAr: unit.nameAr,
    nameEn: unit.nameEn,
    version: unit.version,
    createdAt: unit.createdAt.toISOString(),
    updatedAt: unit.updatedAt.toISOString(),
  };
}

/** `/api/v1/admin-units`: public, cached reference data. */
@ApiModule('village')
@Public()
@Controller('admin-units')
export class AdminUnitController {
  constructor(private readonly units: AdminUnitQueries) {}

  @Get()
  @ApiOperation({
    summary: 'List administrative units',
    description: 'Every unit matching all given filters, sorted by Arabic name. Not paginated.',
  })
  @ApiOkResponse({ standardSchema: adminUnitListResponse })
  @ApiProblems(400)
  async listAdminUnits(
    @Query({ schema: listAdminUnitsQuery }) query: ListAdminUnitsQuery,
  ): Promise<AdminUnitResponse[]> {
    return (await this.units.list(query)).map(toAdminUnitResponse);
  }

  @Get(':idOrCode')
  @ETag()
  @ApiOperation({ summary: 'Get an administrative unit by id or code' })
  @ApiOkResponse({ standardSchema: adminUnitResponse, description: 'ETag holds the version.' })
  @ApiProblems(400, 404)
  async getAdminUnit(
    @Param('idOrCode', { schema: idOrCodeParam }) idOrCode: string,
  ): Promise<AdminUnitResponse> {
    const unit = UUID.test(idOrCode)
      ? await this.units.findById(idOrCode.toLowerCase())
      : await this.units.findByCode(idOrCode);
    if (!unit) throw new NotFoundError(`Administrative unit ${idOrCode} does not exist.`);
    return toAdminUnitResponse(unit);
  }
}
