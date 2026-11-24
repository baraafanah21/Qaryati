import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { ApiModule, ApiProblems } from '../../../platform/http/openapi';
import { pageResponse } from '../../../platform/http/pagination';
import { mapPage, type Page } from '../../../shared/kernel';
import { CurrentUser, Public, type AuthenticatedUser } from '../../iam';
import { ListVillagesByProduct } from '../application/list-villages-by-product.use-case';
import { ProductCatalog } from '../application/product-catalog';
import { toProductResponse, toProductVillage } from './economy.mapper';
import {
  listProductsQuery,
  productIdOrCodeParam,
  productListResponse,
  productVillage,
  productVillagesQuery,
  type ListProductsQuery,
  type ProductResponse,
  type ProductVillage,
  type ProductVillagesQuery,
} from './economy.schemas';

/** `/api/v1/products`: public, cached reference data, and the villages that produce each one. */
@ApiModule('economy')
@Controller('products')
export class ProductController {
  constructor(
    private readonly catalog: ProductCatalog,
    private readonly villagesByProduct: ListVillagesByProduct,
  ) {}

  @Get()
  @Public()
  @ApiOperation({
    summary: 'List products',
    description:
      'Every product, or those of one category, by category then English name. Not paginated: ' +
      'reference data, cached in each API process.',
  })
  @ApiOkResponse({ standardSchema: productListResponse })
  @ApiProblems(400)
  async listProducts(
    @Query({ schema: listProductsQuery }) query: ListProductsQuery,
  ): Promise<ProductResponse[]> {
    return (await this.catalog.list(query.category)).map(toProductResponse);
  }

  @Get(':idOrCode/villages')
  @Public({ optionalUser: true })
  @ApiOperation({
    summary: 'List the villages that produce a product',
    description:
      'Villages with a published (preferred) VILLAGE_PRODUCT claim for the product, given by ' +
      'id or code (olive-oil). Same visibility as GET /villages: anonymous callers and ' +
      'contributors see published villages only. Sort by nameAr (default), nameEn or ' +
      'createdAt. 404 for an unknown product.',
  })
  @ApiOkResponse({ standardSchema: pageResponse(productVillage) })
  @ApiProblems(400, 404)
  async listProductVillages(
    @Param('idOrCode', { schema: productIdOrCodeParam }) idOrCode: string,
    @Query({ schema: productVillagesQuery }) query: ProductVillagesQuery,
    @CurrentUser() user: AuthenticatedUser | undefined,
  ): Promise<Page<ProductVillage>> {
    const { villages } = await this.villagesByProduct.execute({
      idOrCode,
      sort: query.sort,
      page: query.page,
      size: query.size,
      viewer: user,
    });
    return mapPage(villages, toProductVillage);
  }
}
