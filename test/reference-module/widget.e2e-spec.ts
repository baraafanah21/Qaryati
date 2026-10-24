// Reference: copy the e2e test: AppModule plus your module, InMemoryAuditRecorder for AUDIT_RECORDER, one test per status code the endpoint documents.
import { Injectable, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { OnDomainEvent } from '../../src/platform/events/domain-event-publisher';
import { configureApp } from '../../src/platform/http/configure-app';
import { AUDIT_RECORDER } from '../../src/shared/kernel';
import { InMemoryAuditRecorder } from '../support/in-memory-audit-recorder';
import { createAuthenticatedAgent } from '../support/authenticated-agent';
import { WIDGET_CREATED, type WidgetCreated } from './domain/widget-events';
import { createWidgetTable } from './infrastructure/persistence/widget-table';
import { WidgetModule } from './widget.module';

/** Listens to widget.created like another module would; can be told to fail. */
@Injectable()
class WidgetCreatedProbe {
  readonly received: WidgetCreated[] = [];
  failNext = false;

  @OnDomainEvent(WIDGET_CREATED)
  onCreated(event: WidgetCreated): void {
    this.received.push(event);
    if (this.failNext) {
      this.failNext = false;
      throw new Error('listener broke');
    }
  }
}

const PATH = '/api/v1/widgets';
const MISSING = '00000000-0000-7000-8000-0000000000ff';

interface WidgetBody {
  id: string;
  name: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

describe('Reference module: /api/v1/widgets (e2e)', () => {
  let app: INestApplication<App>;
  let agent: Awaited<ReturnType<typeof createAuthenticatedAgent>>;
  const audit = new InMemoryAuditRecorder();
  const probe = new WidgetCreatedProbe();

  beforeAll(async () => {
    await createWidgetTable(process.env.TEST_DATABASE_OWNER_URL as string);
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, WidgetModule],
      providers: [{ provide: WidgetCreatedProbe, useValue: probe }],
    })
      .overrideProvider(AUDIT_RECORDER)
      .useValue(audit)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    agent = await createAuthenticatedAgent(app);
  });

  beforeEach(() => {
    audit.clear();
    probe.received.length = 0;
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => agent;

  async function create(name: string): Promise<WidgetBody> {
    const res = await http().post(PATH).send({ name }).expect(201);
    return res.body as WidgetBody;
  }

  async function expectProblem(req: request.Test, status: number, code: string) {
    const res = await req.expect(status);
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
    expect(res.body).toMatchObject({ status, code });
    return res.body as { errors?: unknown[]; detail: string };
  }

  describe('POST /widgets', () => {
    it('201: creates, sends ETag, audits in the transaction and publishes after commit', async () => {
      const res = await http().post(PATH).send({ name: ' Olive press ' }).expect(201);
      const body = res.body as WidgetBody;
      expect(body).toEqual({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/) as string,
        name: 'Olive press',
        version: 1,
        createdAt: expect.any(String) as string,
        updatedAt: body.createdAt,
      });
      expect(res.headers.etag).toBe('"1"');
      expect(audit.entries).toEqual([
        {
          action: 'widget.created',
          entityType: 'Widget',
          entityId: body.id,
          after: { name: 'Olive press' },
          inTransaction: true,
        },
      ]);
      expect(probe.received).toEqual([
        expect.objectContaining({ name: 'widget.created', aggregateId: body.id }),
      ]);
    });

    it('400: rejects unknown fields and over-long names', async () => {
      const problem = await expectProblem(
        http()
          .post(PATH)
          .send({ name: 'x'.repeat(81), isAdmin: true }),
        400,
        'VALIDATION_FAILED',
      );
      expect(problem.errors).toHaveLength(2);
    });

    it('422: the domain rejects a name that is only spaces', async () => {
      const problem = await expectProblem(
        http().post(PATH).send({ name: '   ' }),
        422,
        'VALIDATION_FAILED',
      );
      expect(problem.errors).toEqual([
        expect.objectContaining({ field: 'name', code: 'REQUIRED' }),
      ]);
    });

    it('409: a live widget already has the name', async () => {
      await create('Duplicate');
      await expectProblem(http().post(PATH).send({ name: 'Duplicate' }), 409, 'DUPLICATE');
    });

    it('rolls the insert back when the audit entry cannot be written, and publishes nothing', async () => {
      audit.failNext();
      await expectProblem(http().post(PATH).send({ name: 'Unaudited' }), 500, 'INTERNAL_ERROR');
      expect(probe.received).toEqual([]);
      // The name is still free: the row never committed.
      await create('Unaudited');
    });

    it('a failing listener after commit does not change the response', async () => {
      probe.failNext = true;
      const body = await create('Listener fails');
      await http().get(`${PATH}/${body.id}`).expect(200);
    });
  });

  describe('GET /widgets/:id', () => {
    it('200 with ETag', async () => {
      const created = await create('Readable');
      const res = await http().get(`${PATH}/${created.id}`).expect(200);
      expect(res.body).toEqual(created);
      expect(res.headers.etag).toBe('"1"');
    });

    it('404 for an unknown id', async () => {
      await expectProblem(http().get(`${PATH}/${MISSING}`), 404, 'NOT_FOUND');
    });

    it('400 for an id that is not a UUID', async () => {
      await expectProblem(http().get(`${PATH}/42`), 400, 'VALIDATION_FAILED');
    });
  });

  describe('GET /widgets', () => {
    it('200: a page sorted by the allow-listed key', async () => {
      await create('List A');
      await create('List B');
      const res = await http().get(`${PATH}?sort=name,desc&size=100`).expect(200);
      const page = res.body as { content: WidgetBody[]; page: { totalElements: number } };
      const names = page.content.map((w) => w.name);
      expect(names).toEqual([...names].sort().reverse());
      expect(page.page.totalElements).toBe(page.content.length);
    });

    it('400: a sort key outside the allow-list', async () => {
      await expectProblem(http().get(`${PATH}?sort=version`), 400, 'VALIDATION_FAILED');
    });
  });

  describe('PATCH /widgets/:id', () => {
    it('200: renames with If-Match, bumps the version and the ETag, audits before and after', async () => {
      const created = await create('Mill');
      audit.clear();
      const res = await http()
        .patch(`${PATH}/${created.id}`)
        .set('If-Match', '"1"')
        .send({ name: 'Water mill' })
        .expect(200);
      expect(res.body).toMatchObject({ name: 'Water mill', version: 2 });
      expect(res.headers.etag).toBe('"2"');
      expect(audit.entries).toEqual([
        expect.objectContaining({
          action: 'widget.renamed',
          before: { name: 'Mill' },
          after: { name: 'Water mill' },
          inTransaction: true,
        }),
      ]);
    });

    it('412: If-Match names an old version', async () => {
      const created = await create('Stale target');
      await http().patch(`${PATH}/${created.id}`).set('If-Match', '"1"').send({ name: 'v2' });
      await expectProblem(
        http().patch(`${PATH}/${created.id}`).set('If-Match', '"1"').send({ name: 'v3' }),
        412,
        'VERSION_CONFLICT',
      );
    });

    it('428: If-Match is missing', async () => {
      const created = await create('Needs If-Match');
      await expectProblem(
        http().patch(`${PATH}/${created.id}`).send({ name: 'x' }),
        428,
        'PRECONDITION_REQUIRED',
      );
    });

    it('400: If-Match is malformed', async () => {
      const created = await create('Bad If-Match');
      const problem = await expectProblem(
        http().patch(`${PATH}/${created.id}`).set('If-Match', 'W/"1"').send({ name: 'x' }),
        400,
        'VALIDATION_FAILED',
      );
      expect(problem.errors).toEqual([
        expect.objectContaining({ field: 'If-Match', code: 'INVALID_FORMAT' }),
      ]);
    });

    it('404: the widget does not exist', async () => {
      await expectProblem(
        http().patch(`${PATH}/${MISSING}`).set('If-Match', '"1"').send({ name: 'x' }),
        404,
        'NOT_FOUND',
      );
    });

    it('two concurrent updates with the same version: exactly one wins', async () => {
      const created = await create('Contended');
      const send = (name: string) =>
        http().patch(`${PATH}/${created.id}`).set('If-Match', '"1"').send({ name });
      const statuses = (await Promise.all([send('A'), send('B')])).map((r) => r.status).sort();
      expect(statuses).toEqual([200, 412]);
      const res = await http().get(`${PATH}/${created.id}`).expect(200);
      expect(res.body).toMatchObject({ version: 2 });
    });
  });

  describe('DELETE /widgets/:id', () => {
    it('204: soft-deletes with If-Match and audits; the widget is then gone', async () => {
      const created = await create('Doomed');
      audit.clear();
      await http().delete(`${PATH}/${created.id}`).set('If-Match', '"1"').expect(204);
      expect(audit.entries).toEqual([
        expect.objectContaining({ action: 'widget.deleted', before: { name: 'Doomed' } }),
      ]);
      await expectProblem(http().get(`${PATH}/${created.id}`), 404, 'NOT_FOUND');
    });

    it('412 and 428 like PATCH', async () => {
      const created = await create('Guarded');
      await expectProblem(
        http().delete(`${PATH}/${created.id}`).set('If-Match', '"7"'),
        412,
        'VERSION_CONFLICT',
      );
      await expectProblem(http().delete(`${PATH}/${created.id}`), 428, 'PRECONDITION_REQUIRED');
    });
  });

  describe('OpenAPI document', () => {
    it('documents the module with tags, operationIds, zod schemas and ProblemDetails', async () => {
      const res = await http().get('/api/docs-json').expect(200);
      const doc = res.body as {
        paths: Record<string, Record<string, Record<string, unknown>>>;
        components: { schemas: Record<string, unknown>; securitySchemes: Record<string, unknown> };
      };
      const update = doc.paths['/api/v1/widgets/{id}']?.patch as {
        operationId: string;
        tags: string[];
        parameters: { name: string; in: string }[];
        responses: Record<string, { content?: Record<string, { schema: unknown }> }>;
        requestBody: { content: Record<string, { schema: unknown }> };
      };
      expect(update.operationId).toBe('widget_update');
      expect(update.tags).toEqual(['widget']);
      expect(update.parameters).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'If-Match', in: 'header' })]),
      );
      expect(Object.keys(update.responses).sort()).toEqual(
        ['200', '400', '401', '404', '409', '412', '422', '428'].sort(),
      );
      expect(update.responses['412']?.content?.['application/problem+json']?.schema).toEqual({
        $ref: '#/components/schemas/ProblemDetails',
      });
      expect(update.requestBody.content['application/json']?.schema).toMatchObject({
        type: 'object',
        properties: { name: { type: 'string', minLength: 1, maxLength: 80 } },
        additionalProperties: false,
      });
      expect(doc.components.schemas).toHaveProperty('ProblemDetails');
      expect(doc.components.schemas).toHaveProperty('WidgetResponse');
      expect(doc.components.securitySchemes).toHaveProperty('bearer');

      const operationIds = Object.values(doc.paths).flatMap((ops) =>
        Object.values(ops).map((op) => op.operationId as string),
      );
      expect(new Set(operationIds).size).toBe(operationIds.length);
      for (const id of operationIds) expect(id).toMatch(/^[a-z]+_[a-zA-Z]+$/);
    });

    it('serves Swagger UI at /api/docs outside production', async () => {
      const res = await http().get('/api/docs').redirects(1).expect(200);
      expect(res.text).toContain('swagger-ui');
    });
  });
});
