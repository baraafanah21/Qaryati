import { applyDecorators, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiResponse,
  ApiTags,
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from '@nestjs/swagger';
import { z } from 'zod';
import type { AppEnv } from '../../config/app-env';
import { ErrorCode, FieldErrorCode } from '../../shared/kernel';
import { PROBLEM_CONTENT_TYPE } from './problem-details';

/** Where Swagger UI is served. The JSON document is at `/api/docs-json`. */
export const SWAGGER_PATH = 'api/docs';
export const SWAGGER_JSON_PATH = 'api/docs-json';

/** Name of the bearer security scheme; endpoints opt in with `@ApiBearerAuth()`. */
export const BEARER_SCHEME = 'bearer';

/**
 * Swagger is on unless switched off, and off by default in production, where
 * it would publish the whole API surface to anyone (`SWAGGER_ENABLED`,
 * docs/configuration.md).
 */
export function isSwaggerEnabled(env: Pick<AppEnv, 'NODE_ENV' | 'SWAGGER_ENABLED'>): boolean {
  return env.SWAGGER_ENABLED ?? env.NODE_ENV !== 'production';
}

/** The body of every error response, as one reusable schema component. */
export const problemDetailsSchema = z
  .strictObject({
    type: z.url().describe('Link to the code in docs/errors.md.'),
    title: z.string().describe('Short, fixed title of the code.'),
    status: z.int().min(400).max(599).describe('The HTTP status, repeated.'),
    code: z.enum(Object.values(ErrorCode)).describe('Stable code; branch on this.'),
    detail: z.string().describe('What went wrong, for a human.'),
    instance: z.string().describe('The request path.'),
    traceId: z.string().describe('The request ID; quote it when reporting a problem.'),
    timestamp: z.iso.datetime(),
    errors: z
      .array(
        z.strictObject({
          field: z.string().describe('Path of the field, e.g. names[0].lang.'),
          code: z.enum(Object.values(FieldErrorCode)),
          message: z.string(),
        }),
      )
      .optional()
      .describe('One entry per invalid field (VALIDATION_FAILED only).'),
  })
  .describe('RFC 9457 problem details plus code, traceId and timestamp (docs/errors.md).');

const PROBLEM_REF = '#/components/schemas/ProblemDetails';

/** Error statuses an endpoint can document, with the codes each one carries. */
const PROBLEM_DESCRIPTIONS = {
  400: 'VALIDATION_FAILED: the body, query, path or a header is malformed; see errors[].',
  401: 'UNAUTHENTICATED: the access token is missing, invalid or expired.',
  403: 'FORBIDDEN: the caller may not do this.',
  404: 'NOT_FOUND: the resource does not exist.',
  409: 'DUPLICATE or REFERENCE_CONFLICT: the change clashes with existing data.',
  412: 'VERSION_CONFLICT: If-Match names an old version; read the resource again.',
  422: 'VALIDATION_FAILED or CONSTRAINT_VIOLATION: a business rule rejects the change.',
  428: 'PRECONDITION_REQUIRED: send If-Match with the ETag you read.',
  429: 'RATE_LIMITED: too many requests; wait for Retry-After.',
  503: 'SERVICE_UNAVAILABLE: a dependency is down or too slow; retry later.',
} as const;

/** A status {@link ApiProblems} can document. */
export type ProblemStatus = keyof typeof PROBLEM_DESCRIPTIONS;

/**
 * Documents the error responses of an endpoint with the shared
 * `ProblemDetails` schema: `@ApiProblems(400, 404, 412, 428)`.
 * List what the endpoint can really return; 500 is implied everywhere.
 */
export function ApiProblems(...statuses: ProblemStatus[]): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ...statuses.map((status) =>
      ApiResponse({
        status,
        description: PROBLEM_DESCRIPTIONS[status],
        content: { [PROBLEM_CONTENT_TYPE]: { schema: { $ref: PROBLEM_REF } } },
      }),
    ),
  );
}

// Controller class name → module name, filled by @ApiModule when the class is
// defined, read by the operationId factory when the document is built.
const controllerModules = new Map<string, string>();

/**
 * Marks a controller as part of `module`: its operations are tagged with the
 * module name and get `operationId` `<module>_<method>`, e.g.
 * `village_create`. Every controller has it (docs/kernel.md, "Swagger").
 */
export function ApiModule(module: string): ClassDecorator {
  return applyDecorators(ApiTags(module), (target: object) => {
    controllerModules.set((target as { name: string }).name, module);
  });
}

/** `<module>_<method>` for controllers marked with {@link ApiModule}. */
export function operationId(controllerKey: string, methodKey: string): string {
  return `${controllerModules.get(controllerKey) ?? controllerKey}_${methodKey}`;
}

/**
 * Builds the OpenAPI document of `app`: every route, the bearer scheme
 * defined once, and the `ProblemDetails` component. Request and response
 * schemas come from the zod schemas on `@Body`/`@Query`/`@Param` and in
 * `@ApiOkResponse({ standardSchema })`.
 */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Qaryati API')
    .setDescription(
      'Sourced, verifiable knowledge about Palestinian villages. Errors use ' +
        'application/problem+json (docs/errors.md).',
    )
    .setVersion('1')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, BEARER_SCHEME)
    .build();
  const document = SwaggerModule.createDocument(app, config, {
    operationIdFactory: operationId,
  });
  document.components ??= {};
  document.components.schemas = {
    ...document.components.schemas,
    ProblemDetails: z.toJSONSchema(problemDetailsSchema, {
      target: 'openapi-3.0',
    }) as NonNullable<NonNullable<OpenAPIObject['components']>['schemas']>[string],
  };
  return document;
}

/**
 * Serves Swagger UI at `/api/docs` and the document at `/api/docs-json`
 * when {@link isSwaggerEnabled}. Called by configureApp.
 */
export function setupSwagger(app: INestApplication): void {
  const config = app.get<ConfigService<AppEnv, true>>(ConfigService);
  const enabled = isSwaggerEnabled({
    NODE_ENV: config.get('NODE_ENV', { infer: true }),
    SWAGGER_ENABLED: config.get('SWAGGER_ENABLED', { infer: true }),
  });
  if (!enabled) return;
  SwaggerModule.setup(SWAGGER_PATH, app, () => buildOpenApiDocument(app), {
    jsonDocumentUrl: SWAGGER_JSON_PATH,
  });
}
