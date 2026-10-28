import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../../src/app.module';
import type { AppEnv } from '../../src/config/app-env';
import { createTestTokenIssuer, Role } from '../../src/modules/iam';
import { configureApp } from '../../src/platform/http/configure-app';
import { AUDIT_RECORDER, CLOCK, type Clock } from '../../src/shared/kernel';
import { createAuthenticatedAgent } from '../support/authenticated-agent';
import { InMemoryAuditRecorder } from '../support/in-memory-audit-recorder';

const PATH = '/api/v1/sources';
const MISSING = '00000000-0000-7000-8000-0000000000ff';

interface SourceBody {
  id: string;
  sourceType: string;
  title: string;
  author: string | null;
  publisher: string | null;
  publishedYear: number | null;
  url: string | null;
  isbn: string | null;
  reliability: number;
  notes: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface ProblemBody {
  status: number;
  code: string;
  detail?: string;
}

function sourceInput(title: string) {
  return {
    sourceType: 'BOOK',
    title,
    author: 'Test Author',
    publisher: 'Test Publisher',
    publishedYear: 2020,
    url: null,
    isbn: null,
    reliability: 4,
    notes: 'E2E test source',
  };
}

describe('Curation module: /api/v1/sources (e2e)', () => {
  let app: INestApplication<App>;
  let agent: Awaited<ReturnType<typeof createAuthenticatedAgent>>;

  const audit = new InMemoryAuditRecorder();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
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
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => agent;

  async function create(title: string): Promise<SourceBody> {
    const res = await http().post(PATH).send(sourceInput(title)).expect(201);

    return res.body as SourceBody;
  }

  async function expectProblem(
    req: request.Test,
    status: number,
    code: string,
  ): Promise<ProblemBody> {
    const res = await req.expect(status);

    const body = res.body as ProblemBody;

    expect(body).toMatchObject({
      status,
      code,
    });

    return body;
  }

  describe('POST /sources', () => {
    it('201: creates a source with version and ETag', async () => {
      const res = await http().post(PATH).send(sourceInput('Palestinian History')).expect(201);

      const body = res.body as SourceBody;

      expect(body).toMatchObject({
        sourceType: 'BOOK',
        title: 'Palestinian History',
        reliability: 4,
        version: 1,
      });

      expect(body.id).toEqual(expect.any(String));
      expect(res.headers.etag).toBe('"1"');
    });

    it('records creation inside a transaction', async () => {
      const created = await create('Audited Source');

      expect(audit.entries).toEqual([
        expect.objectContaining({
          action: 'source.created',
          entityType: 'Source',
          entityId: created.id,
          inTransaction: true,
        }),
      ]);
    });

    it('400: rejects unknown request fields', async () => {
      await expectProblem(
        http()
          .post(PATH)
          .send({
            ...sourceInput('Invalid Fields'),
            isAdmin: true,
          }),
        400,
        'VALIDATION_FAILED',
      );
    });

    it('422: rejects a title containing only spaces', async () => {
      await expectProblem(http().post(PATH).send(sourceInput('   ')), 422, 'VALIDATION_FAILED');
    });

    it('400: rejects invalid reliability', async () => {
      await expectProblem(
        http()
          .post(PATH)
          .send({
            ...sourceInput('Invalid Reliability'),
            reliability: 10,
          }),
        400,
        'VALIDATION_FAILED',
      );
    });

    it('409: rejects duplicate source URLs', async () => {
      const url = 'https://example.com/qaryati-e2e-duplicate';

      await http()
        .post(PATH)
        .send({
          ...sourceInput('First URL Source'),
          url,
        })
        .expect(201);

      await expectProblem(
        http()
          .post(PATH)
          .send({
            ...sourceInput('Second URL Source'),
            url,
          }),
        409,
        'DUPLICATE',
      );
    });
  });

  describe('GET /sources/:id', () => {
    it('200: retrieves a source with an ETag', async () => {
      const created = await create('Readable Source');

      const res = await http().get(`${PATH}/${created.id}`).expect(200);

      expect(res.body).toEqual(created);
      expect(res.headers.etag).toBe('"1"');
    });

    it('404: rejects an unknown source', async () => {
      await expectProblem(http().get(`${PATH}/${MISSING}`), 404, 'NOT_FOUND');
    });

    it('400: rejects an invalid UUID', async () => {
      await expectProblem(http().get(`${PATH}/invalid-id`), 400, 'VALIDATION_FAILED');
    });
  });

  describe('GET /sources', () => {
    it('200: finds a source by its title', async () => {
      const created = await create('Unique Palestinian Archive');

      const res = await http()
        .get(`${PATH}?q=Unique%20Palestinian%20Archive&page=0&size=10`)
        .expect(200);

      const page = res.body as {
        content: SourceBody[];
      };

      expect(page.content).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: created.id,
            title: 'Unique Palestinian Archive',
          }),
        ]),
      );
    });

    it('200: filters sources by type', async () => {
      const created = await create('Book Filter Test');

      const res = await http().get(`${PATH}?type=BOOK`).expect(200);

      const page = res.body as {
        content: SourceBody[];
      };

      expect(page.content).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: created.id,
            sourceType: 'BOOK',
          }),
        ]),
      );

      expect(page.content.every((item) => item.sourceType === 'BOOK')).toBe(true);
    });

    it('400: rejects unsupported sorting fields', async () => {
      await expectProblem(http().get(`${PATH}?sort=password`), 400, 'VALIDATION_FAILED');
    });
  });

  describe('PATCH /sources/:id', () => {
    it('200: updates a source and increments its version', async () => {
      const created = await create('Original Source');

      audit.clear();

      const res = await http()
        .patch(`${PATH}/${created.id}`)
        .set('If-Match', '"1"')
        .send({
          title: 'Updated Source',
          reliability: 5,
        })
        .expect(200);

      expect(res.body).toMatchObject({
        title: 'Updated Source',
        reliability: 5,
        version: 2,
      });

      expect(res.headers.etag).toBe('"2"');

      expect(audit.entries).toEqual([
        expect.objectContaining({
          action: 'source.updated',
          entityType: 'Source',
          entityId: created.id,
          before: {
            sourceType: 'BOOK',
            title: 'Original Source',
            author: 'Test Author',
            publisher: 'Test Publisher',
            publishedYear: 2020,
            url: null,
            isbn: null,
            reliability: 4,
            notes: 'E2E test source',
          },
          after: {
            sourceType: 'BOOK',
            title: 'Updated Source',
            author: 'Test Author',
            publisher: 'Test Publisher',
            publishedYear: 2020,
            url: null,
            isbn: null,
            reliability: 5,
            notes: 'E2E test source',
          },
          inTransaction: true,
        }),
      ]);
    });

    it('412: rejects a stale version', async () => {
      const created = await create('Version Conflict Test');

      await http()
        .patch(`${PATH}/${created.id}`)
        .set('If-Match', '"1"')
        .send({ title: 'Version Two' })
        .expect(200);

      await expectProblem(
        http()
          .patch(`${PATH}/${created.id}`)
          .set('If-Match', '"1"')
          .send({ title: 'Stale Update' }),
        412,
        'VERSION_CONFLICT',
      );
    });

    it('428: requires If-Match', async () => {
      const created = await create('Missing Header Test');

      await expectProblem(
        http().patch(`${PATH}/${created.id}`).send({ title: 'Changed' }),
        428,
        'PRECONDITION_REQUIRED',
      );
    });

    it('404: rejects updating an unknown source', async () => {
      await expectProblem(
        http().patch(`${PATH}/${MISSING}`).set('If-Match', '"1"').send({ title: 'Unknown Source' }),
        404,
        'NOT_FOUND',
      );
    });

    it('403: rejects another contributor editing the source', async () => {
      const created = await create('Protected Source');

      const config = app.get<ConfigService<AppEnv, true>>(ConfigService);

      const issuer = await createTestTokenIssuer({
        privateKeyFile: config.get('JWT_PRIVATE_KEY_FILE', {
          infer: true,
        }),
        publicKeyFile: config.get('JWT_PUBLIC_KEY_FILE', {
          infer: true,
        }),
        issuer: config.get('JWT_ISSUER', {
          infer: true,
        }),
        clock: app.get<Clock>(CLOCK),
      });

      const secondToken = await issuer.mint({
        id: '00000000-0000-7000-8000-000000000002',
        role: Role.CONTRIBUTOR,
      });

      const secondAgent = request
        .agent(app.getHttpServer())
        .set('Authorization', `Bearer ${secondToken}`);

      await expectProblem(
        secondAgent
          .patch(`${PATH}/${created.id}`)
          .set('If-Match', '"1"')
          .send({ title: 'Unauthorized Edit' }),
        403,
        'FORBIDDEN',
      );
    });
  });
});
