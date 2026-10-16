import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Injectable,
  Module,
  Param,
  Post,
  Query,
  UseGuards,
  type CanActivate,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { z } from 'zod';
import { AppModule } from '../src/app.module';
import { InjectModuleDb, type ModuleDb } from '../src/platform/database/database';
import { DatabaseModule } from '../src/platform/database/database.module';
import { configureApp } from '../src/platform/http/configure-app';
import { idParam, paginationQuery, sortQuery } from '../src/platform/http/pagination';
import {
  BusinessRuleViolationError,
  ConflictError,
  FieldErrorCode,
  ForbiddenError,
  NotFoundError,
  PreconditionFailedError,
  toPage,
  ValidationError,
} from '../src/shared/kernel';

// A throwaway controller that raises every kind of error. It exists only in
// this test: AppModule does not know it.

@Injectable()
class UnauthenticatedGuard implements CanActivate {
  canActivate(): boolean {
    throw new HttpException('Missing access token', HttpStatus.UNAUTHORIZED);
  }
}

@Injectable()
class RoleGuard implements CanActivate {
  canActivate(): boolean {
    return false; // Nest turns this into a ForbiddenException
  }
}

@Injectable()
class ThrottleGuard implements CanActivate {
  canActivate(): boolean {
    throw new HttpException('Too Many Requests', HttpStatus.TOO_MANY_REQUESTS);
  }
}

const createBody = z.strictObject({
  slug: z.string().min(3).max(40),
  names: z.array(z.strictObject({ lang: z.enum(['ar', 'en']), value: z.string().min(1) })).min(1),
});

const listQuery = paginationQuery.extend({ sort: sortQuery(['name', 'createdAt']) });

// SQLSTATEs the probe can raise for real, through the driver and Drizzle.
const SQL_STATES = new Set(['23505', '23503', '23514', '23502', '57014', '42501']);

@Controller('__probe')
class ErrorProbeController {
  constructor(@InjectModuleDb() private readonly db: ModuleDb<Record<string, never>>) {}

  @Get('domain/:kind')
  domain(@Param('kind') kind: string): never {
    switch (kind) {
      case 'not-found':
        throw new NotFoundError('Village 42 does not exist.');
      case 'conflict':
        throw new ConflictError('The slug beit-furik is taken.');
      case 'validation':
        throw new ValidationError('The slug is invalid.', [
          {
            field: 'slug',
            code: FieldErrorCode.INVALID_FORMAT,
            message: 'Use lowercase letters and dashes.',
          },
        ]);
      case 'forbidden':
        throw new ForbiddenError('You cannot verify your own claim.');
      case 'precondition':
        throw new PreconditionFailedError('The village changed since version 3.');
      default:
        throw new BusinessRuleViolationError('A village needs at least one Arabic name.');
    }
  }

  @Get('guard/unauthenticated')
  @UseGuards(UnauthenticatedGuard)
  unauthenticated(): void {}

  @Get('guard/forbidden')
  @UseGuards(RoleGuard)
  forbidden(): void {}

  @Get('guard/throttled')
  @UseGuards(ThrottleGuard)
  throttled(): void {}

  @Post('villages')
  create(@Body({ schema: createBody }) body: z.infer<typeof createBody>) {
    return body;
  }

  @Get('villages')
  list(@Query({ schema: listQuery }) query: z.infer<typeof listQuery>) {
    return { query, ...toPage([{ name: 'Beit Furik' }], 1, query) };
  }

  @Get('villages/:id')
  one(@Param('id', { schema: idParam }) id: string) {
    return { id };
  }

  @Get('pg/:sqlState')
  async pg(@Param('sqlState') sqlState: string): Promise<void> {
    if (!SQL_STATES.has(sqlState)) throw new Error('unknown probe');
    // RAISE produces a genuine server error with that SQLSTATE and the
    // constraint/table fields, exactly as a failing INSERT would.
    await this.db.execute(
      sql.raw(
        `DO $$ BEGIN RAISE EXCEPTION 'violates constraint village_slug_key' ` +
          `USING ERRCODE = '${sqlState}', CONSTRAINT = 'village_slug_key', TABLE = 'village'; END $$`,
      ),
    );
  }

  @Get('crash')
  crash(): never {
    throw new Error('secret internals at /srv/app/village.service.ts');
  }
}

@Module({ imports: [DatabaseModule.forFeature({})], controllers: [ErrorProbeController] })
class ErrorProbeModule {}

const DOCS = 'https://github.com/baraafanah21/Qaryati/blob/main/docs/errors.md';

describe('Problem details (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, ErrorProbeModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  /** Asserts the shared shape and returns the body for case-specific checks. */
  async function expectProblem(
    req: request.Test,
    status: number,
    code: string,
    path: string,
  ): Promise<Record<string, unknown>> {
    const res = await req.expect(status);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    const body = res.body as Record<string, unknown>;
    const requestId = res.headers['x-request-id'];
    expect(requestId).toEqual(expect.any(String));
    expect(body).toEqual({
      type: `${DOCS}#${code.toLowerCase().replaceAll('_', '-')}`,
      title: expect.any(String) as string,
      status,
      code,
      detail: expect.any(String) as string,
      instance: path,
      traceId: requestId,
      timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/) as string,
      ...(body.errors === undefined ? {} : { errors: expect.any(Array) as unknown[] }),
    });
    // No stack frames or file paths, whatever was thrown.
    expect(JSON.stringify(body)).not.toMatch(/\bat \S+:\d+|\.ts\b|"stack"/);
    return body;
  }

  const http = () => request(app.getHttpServer());

  describe('domain errors', () => {
    it.each([
      ['not-found', 404, 'NOT_FOUND', 'Village 42 does not exist.'],
      ['conflict', 409, 'DUPLICATE', 'The slug beit-furik is taken.'],
      ['validation', 422, 'VALIDATION_FAILED', 'The slug is invalid.'],
      ['forbidden', 403, 'FORBIDDEN', 'You cannot verify your own claim.'],
      ['precondition', 412, 'VERSION_CONFLICT', 'The village changed since version 3.'],
      ['business-rule', 422, 'CONSTRAINT_VIOLATION', 'A village needs at least one Arabic name.'],
    ])('%s → %i %s', async (kind, status, code, detail) => {
      const path = `/api/v1/__probe/domain/${kind}`;
      const body = await expectProblem(http().get(path), status, code, path);
      expect(body.detail).toBe(detail);
    });

    it('carries field errors of a domain ValidationError', async () => {
      const path = '/api/v1/__probe/domain/validation';
      const body = await expectProblem(http().get(path), 422, 'VALIDATION_FAILED', path);
      expect(body.errors).toEqual([
        { field: 'slug', code: 'INVALID_FORMAT', message: 'Use lowercase letters and dashes.' },
      ]);
    });
  });

  describe('guards and routing', () => {
    it.each([
      ['unauthenticated', 401, 'UNAUTHENTICATED'],
      ['forbidden', 403, 'FORBIDDEN'],
      ['throttled', 429, 'RATE_LIMITED'],
    ])('a guard rejecting as %s → %i %s', async (guard, status, code) => {
      const path = `/api/v1/__probe/guard/${guard}`;
      await expectProblem(http().get(path), status, code, path);
    });

    it('an unknown route → 404 NOT_FOUND', async () => {
      await expectProblem(http().get('/api/v1/nowhere?x=1'), 404, 'NOT_FOUND', '/api/v1/nowhere');
    });
  });

  describe('request validation', () => {
    const path = '/api/v1/__probe/villages';

    it('accepts a valid body', async () => {
      const body = { slug: 'beit-furik', names: [{ lang: 'ar', value: 'بيت فوريك' }] };
      await http().post(path).send(body).expect(201).expect(body);
    });

    it('rejects an invalid body with every field error', async () => {
      const body = await expectProblem(
        http()
          .post(path)
          .send({ slug: 'ab', names: [{ value: 'x' }], isAdmin: true }),
        400,
        'VALIDATION_FAILED',
        path,
      );
      expect(body.errors).toEqual(
        expect.arrayContaining([
          { field: 'slug', code: 'TOO_SHORT', message: expect.any(String) as string },
          { field: 'names[0].lang', code: 'REQUIRED', message: expect.any(String) as string },
          { field: 'isAdmin', code: 'UNKNOWN_FIELD', message: expect.any(String) as string },
        ]),
      );
      expect(body.errors).toHaveLength(3);
    });

    it('rejects malformed JSON', async () => {
      await expectProblem(
        http().post(path).set('Content-Type', 'application/json').send('{"slug":'),
        400,
        'VALIDATION_FAILED',
        path,
      );
    });

    it('transforms query parameters and returns a page', async () => {
      const res = await http()
        .get(`${path}?page=1&size=5&sort=name,desc&sort=createdAt`)
        .expect(200);
      expect(res.body).toEqual({
        query: {
          page: 1,
          size: 5,
          sort: [
            { field: 'name', direction: 'desc' },
            { field: 'createdAt', direction: 'asc' },
          ],
        },
        content: [{ name: 'Beit Furik' }],
        page: { number: 1, size: 5, totalElements: 1, totalPages: 1 },
      });
    });

    it.each([
      ['size=500', 'size', 'TOO_LARGE'],
      ['size=0', 'size', 'TOO_SMALL'],
      ['page=-1', 'page', 'TOO_SMALL'],
      ['page=abc', 'page', 'INVALID_TYPE'],
      ['sort=password,asc', 'sort', 'NOT_ALLOWED'],
    ])('rejects ?%s', async (query, field, code) => {
      const body = await expectProblem(
        http().get(`${path}?${query}`),
        400,
        'VALIDATION_FAILED',
        path,
      );
      expect(body.errors).toEqual([{ field, code, message: expect.any(String) as string }]);
    });

    it('validates path parameters', async () => {
      const ok = '0192f0c4-8e1a-7c3b-9d2e-5f6a7b8c9d0e';
      await http().get(`${path}/${ok}`).expect(200).expect({ id: ok });
      await expectProblem(http().get(`${path}/42`), 400, 'VALIDATION_FAILED', `${path}/42`);
    });
  });

  describe('PostgreSQL errors through Drizzle', () => {
    it.each([
      ['23505', 409, 'DUPLICATE'],
      ['23503', 409, 'REFERENCE_CONFLICT'],
      ['23514', 422, 'CONSTRAINT_VIOLATION'],
      ['23502', 422, 'CONSTRAINT_VIOLATION'],
      ['57014', 503, 'SERVICE_UNAVAILABLE'],
      ['42501', 500, 'INTERNAL_ERROR'],
    ])('SQLSTATE %s → %i %s, without SQL details', async (sqlState, status, code) => {
      const path = `/api/v1/__probe/pg/${sqlState}`;
      const body = await expectProblem(http().get(path), status, code, path);
      expect(JSON.stringify(body)).not.toMatch(/village|RAISE|DO \$\$/i);
    });
  });

  describe('unexpected errors', () => {
    it('→ 500 INTERNAL_ERROR with a generic detail', async () => {
      const path = '/api/v1/__probe/crash';
      const body = await expectProblem(http().get(path), 500, 'INTERNAL_ERROR', path);
      expect(body.detail).not.toMatch(/secret|srv/);
    });
  });

  describe('request ID', () => {
    const path = '/api/v1/__probe/domain/not-found';

    it('reuses a safe incoming X-Request-Id as header and traceId', async () => {
      const id = '0192f0c4-8e1a-7c3b-9d2e-5f6a7b8c9d0e';
      const res = await http().get(path).set('X-Request-Id', id).expect(404);
      expect(res.headers['x-request-id']).toBe(id);
      expect((res.body as { traceId: string }).traceId).toBe(id);
    });

    it('replaces an unsafe incoming id with a new UUIDv7', async () => {
      const res = await http().get(path).set('X-Request-Id', 'bad id with spaces').expect(404);
      expect(res.headers['x-request-id']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect((res.body as { traceId: string }).traceId).toBe(res.headers['x-request-id']);
    });

    it('is sent on successful responses too', async () => {
      const res = await http().get('/api/v1/health').expect(200);
      expect(res.headers['x-request-id']).toEqual(expect.any(String));
    });
  });
});
