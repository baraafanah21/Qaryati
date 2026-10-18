import {
  ApiModule,
  ApiProblems,
  isSwaggerEnabled,
  operationId,
  problemDetailsSchema,
} from './openapi';

// Metadata keys of @nestjs/swagger (not exported from its entry point).
const API_TAGS = 'swagger/apiUseTags';
const API_RESPONSE = 'swagger/apiResponse';

describe('isSwaggerEnabled', () => {
  it.each([
    ['development', undefined, true],
    ['test', undefined, true],
    ['production', undefined, false],
    ['production', true, true],
    ['development', false, false],
  ] as const)('NODE_ENV=%s, SWAGGER_ENABLED=%p → %p', (NODE_ENV, SWAGGER_ENABLED, expected) => {
    expect(isSwaggerEnabled({ NODE_ENV, SWAGGER_ENABLED })).toBe(expected);
  });
});

describe('operationId', () => {
  @ApiModule('village')
  class VillageAdminController {}

  it('is <module>_<method> for a controller marked with @ApiModule', () => {
    expect(operationId(VillageAdminController.name, 'create')).toBe('village_create');
  });

  it('tags the controller with the module name', () => {
    expect(Reflect.getMetadata(API_TAGS, VillageAdminController)).toEqual(['village']);
  });

  it('falls back to the class name for an unmarked controller', () => {
    expect(operationId('LegacyController', 'list')).toBe('LegacyController_list');
  });
});

describe('ApiProblems', () => {
  it('documents each status with the shared ProblemDetails schema', () => {
    class Probe {
      @ApiProblems(404, 412)
      handler(): void {}
    }
    const responses = Reflect.getMetadata(
      API_RESPONSE,
      Object.getOwnPropertyDescriptor(Probe.prototype, 'handler')?.value as object,
    ) as Record<string, { content: Record<string, { schema: unknown }> }>;
    expect(Object.keys(responses).sort()).toEqual(['404', '412']);
    expect(responses['412']?.content['application/problem+json']?.schema).toEqual({
      $ref: '#/components/schemas/ProblemDetails',
    });
  });
});

describe('problemDetailsSchema', () => {
  it('accepts a real problem body', () => {
    expect(
      problemDetailsSchema.safeParse({
        type: 'https://github.com/baraafanah21/Qaryati/blob/main/docs/errors.md#not-found',
        title: 'Not found',
        status: 404,
        code: 'NOT_FOUND',
        detail: 'Village 42 does not exist.',
        instance: '/api/v1/villages/42',
        traceId: '0192f0c4-8e1a-7c3b-9d2e-5f6a7b8c9d0e',
        timestamp: '2026-10-18T10:00:00.000Z',
      }).success,
    ).toBe(true);
  });
});
