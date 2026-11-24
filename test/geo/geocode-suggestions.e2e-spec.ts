import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import type { AppEnv } from '../../src/config/app-env';
import type { GeocodingPort } from '../../src/modules/geo/application/geocoding.port';
import { GeocodingUnavailableError } from '../../src/modules/geo/domain/geocoding-errors';
import { GEOCODING_ADAPTER } from '../../src/modules/geo/geo.module';
import { createTestTokenIssuer, Role } from '../../src/modules/iam';
import { configureApp } from '../../src/platform/http/configure-app';
import { AUDIT_RECORDER, CLOCK, type Clock } from '../../src/shared/kernel';
import { InMemoryAuditRecorder } from '../support/in-memory-audit-recorder';

const VILLAGES = '/api/v1/villages';
const MISSING = '00000000-0000-7000-8000-0000000f00ff';
const USERS = {
  contributor: { id: '00000000-0000-7000-8000-0000000f0001', role: Role.CONTRIBUTOR },
  editor: { id: '00000000-0000-7000-8000-0000000f0002', role: Role.EDITOR },
} as const;
type UserName = keyof typeof USERS;

interface Candidate {
  displayName: string;
  latitude: number;
  longitude: number;
  provider: string;
  providerRef: string | null;
}

/** Fails every call like a provider that is down; counts how often it was reached. */
class DownGeocoder implements GeocodingPort {
  calls = 0;
  search(): Promise<never> {
    this.calls += 1;
    return Promise.reject(new GeocodingUnavailableError('http', false, { httpStatus: 500 }));
  }
}

async function startApp(
  audit: InMemoryAuditRecorder,
  adapter?: GeocodingPort,
): Promise<INestApplication<App>> {
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AUDIT_RECORDER)
    .useValue(audit);
  if (adapter) builder = builder.overrideProvider(GEOCODING_ADAPTER).useValue(adapter);
  const app = (await builder.compile()).createNestApplication<INestApplication<App>>();
  configureApp(app);
  await app.init();
  return app;
}

describe('geocoding suggestions: /api/v1/villages/{id}/geocode-suggestions (e2e)', () => {
  let app: INestApplication<App>;
  let owner: Pool;
  const audit = new InMemoryAuditRecorder();
  const tokens: Record<UserName, string> = { contributor: '', editor: '' };
  const as = (user: UserName) => `Bearer ${tokens[user]}`;

  /** A published village whose names the stub knows (or not). */
  async function village(nameAr: string, nameEn: string | null = null) {
    const slug = `geo-e2e-${randomUUID().slice(0, 8)}`;
    const { rows } = await owner.query<{ id: string }>(
      `INSERT INTO village (id, slug, settlement_status, publication_status, display_name_ar,
         display_name_en, created_by, version, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, 'DEPOPULATED', 'PUBLISHED', $2, $3, $4, 1, now(), now())
       RETURNING id`,
      [slug, nameAr, nameEn, USERS.editor.id],
    );
    return { id: rows[0]!.id, slug };
  }

  const suggest = (target: INestApplication<App>, villageId: string, user: UserName = 'editor') =>
    request(target.getHttpServer())
      .post(`${VILLAGES}/${villageId}/geocode-suggestions`)
      .set('Authorization', as(user));

  const accept = (villageId: string, candidate: object, user: UserName = 'editor') =>
    request(app.getHttpServer())
      .post(`${VILLAGES}/${villageId}/geocode-suggestions/accept`)
      .set('Authorization', as(user))
      .send(candidate);

  beforeAll(async () => {
    app = await startApp(audit);
    owner = new Pool({ connectionString: process.env.TEST_DATABASE_OWNER_URL });
    for (const [name, user] of Object.entries(USERS)) {
      await owner.query(
        `INSERT INTO user_account (id, email, password_hash, role, status, version, created_at, updated_at)
         VALUES ($1, $2, 'hash', $3, 'ACTIVE', 1, now(), now()) ON CONFLICT (id) DO NOTHING`,
        [user.id, `geo-e2e-${name}@test.local`, user.role],
      );
    }
    const config = app.get<ConfigService<AppEnv, true>>(ConfigService);
    const issuer = await createTestTokenIssuer({
      privateKeyFile: config.get('JWT_PRIVATE_KEY_FILE', { infer: true }),
      publicKeyFile: config.get('JWT_PUBLIC_KEY_FILE', { infer: true }),
      issuer: config.get('JWT_ISSUER', { infer: true }),
      clock: app.get<Clock>(CLOCK),
    });
    for (const [name, user] of Object.entries(USERS)) {
      tokens[name as UserName] = await issuer.mint(user);
    }
  });

  beforeEach(() => audit.clear());

  afterAll(async () => {
    await owner?.end();
    await app?.close();
  });

  describe('POST /geocode-suggestions', () => {
    it("returns the stub's candidates for the village's Arabic name", async () => {
      const { id } = await village('لفتا');

      const res = await suggest(app, id).expect(200);

      expect(res.body).toEqual({
        candidates: [
          {
            displayName: 'Lifta, Jerusalem',
            latitude: 31.79583,
            longitude: 35.19861,
            provider: 'stub',
            providerRef: 'stub/1',
          },
        ],
      });
    });

    it('falls back to the English name', async () => {
      const { id } = await village('اسم غير معروف', 'Battir');
      const res = await suggest(app, id).expect(200);
      expect((res.body as { candidates: Candidate[] }).candidates[0]?.displayName).toBe(
        'Battir, Bethlehem',
      );
    });

    it('returns an empty list when nothing matches', async () => {
      const { id } = await village('لا شيء هنا');
      await expect(suggest(app, id).expect(200)).resolves.toMatchObject({
        body: { candidates: [] },
      });
    });

    it('is for editors: 403 for a contributor, 401 without a token', async () => {
      const { id } = await village('لفتا');
      await suggest(app, id, 'contributor').expect(403);
      await request(app.getHttpServer()).post(`${VILLAGES}/${id}/geocode-suggestions`).expect(401);
    });

    it('answers 404 for an unknown village', async () => {
      await suggest(app, MISSING).expect(404);
    });
  });

  describe('POST /geocode-suggestions/accept', () => {
    it('creates an unverified APPROXIMATE location claim cited to an EXTERNAL_API source', async () => {
      const { id } = await village('سبسطية');
      const [candidate] = ((await suggest(app, id).expect(200)).body as { candidates: Candidate[] })
        .candidates;
      audit.clear();

      const res = await accept(id, candidate!).expect(201);

      expect(res.headers.etag).toBe('"1"');
      expect(res.body).toMatchObject({
        status: 'UNVERIFIED',
        isPreferred: false,
        sourceLocator: 'stub/4',
        createdBy: USERS.editor.id,
        latitude: 32.27639,
        longitude: 35.19722,
        precision: 'APPROXIMATE',
        description: 'Sebastia, Nablus',
      });
      const { rows } = await owner.query<{ source_type: string; reliability: number }>(
        'SELECT source_type, reliability FROM source WHERE id = $1',
        [(res.body as { sourceId: string }).sourceId],
      );
      expect(rows).toEqual([{ source_type: 'EXTERNAL_API', reliability: 2 }]);

      // The first accept of this run: the source is created, then the claim, both audited.
      expect(audit.entries.map((e) => [e.action, e.villageId ?? null])).toEqual([
        ['source.created', null],
        ['claim.submitted', id],
      ]);
      expect(audit.entries.every((e) => e.inTransaction)).toBe(true);
    });

    it('creates the source once and cites it from every accepted candidate', async () => {
      const first = await village('بتير');
      const second = await village('لفتا');
      const candidateOf = async (villageId: string) =>
        ((await suggest(app, villageId).expect(200)).body as { candidates: Candidate[] })
          .candidates[0]!;

      const a = await accept(first.id, await candidateOf(first.id)).expect(201);
      audit.clear();
      const b = await accept(second.id, await candidateOf(second.id)).expect(201);

      expect((b.body as { sourceId: string }).sourceId).toBe(
        (a.body as { sourceId: string }).sourceId,
      );
      expect(audit.entries.map((e) => e.action)).toEqual(['claim.submitted']);
    });

    it('answers 409 when the same candidate is accepted twice', async () => {
      const { id } = await village('دير ياسين');
      const [candidate] = ((await suggest(app, id).expect(200)).body as { candidates: Candidate[] })
        .candidates;

      await accept(id, candidate!).expect(201);
      const res = await accept(id, candidate!).expect(409);
      expect((res.body as { code: string }).code).toBe('DUPLICATE');
    });

    it('validates the body strictly', async () => {
      const { id } = await village('لفتا');
      const valid: Candidate = {
        displayName: 'Lifta',
        latitude: 31.79,
        longitude: 35.19,
        provider: 'stub',
        providerRef: null,
      };
      await accept(id, { ...valid, latitude: 91 }).expect(400);
      await accept(id, { ...valid, provider: 'google' }).expect(400);
      await accept(id, { ...valid, status: 'VERIFIED' }).expect(400);
    });

    it('answers 404 for an unknown village and 403 for a contributor, creating nothing', async () => {
      const candidate = {
        displayName: 'Lifta',
        latitude: 31.79,
        longitude: 35.19,
        provider: 'stub',
        providerRef: 'stub/1',
      };
      await accept(MISSING, candidate).expect(404);
      const { id } = await village('لفتا');
      await accept(id, candidate, 'contributor').expect(403);
      expect(audit.entries).toEqual([]);
    });
  });

  describe('when the provider is down', () => {
    let downApp: INestApplication<App>;
    const provider = new DownGeocoder();

    beforeAll(async () => {
      downApp = await startApp(new InMemoryAuditRecorder(), provider);
    });
    afterAll(async () => downApp?.close());

    it('opens the breaker after 5 failures; suggestions 502, the rest of the API 200', async () => {
      // Names nobody else asks for, so the cache cannot answer.
      const { id, slug } = await village(`قرية معطلة ${randomUUID().slice(0, 8)}`);

      for (let call = 0; call < 5; call += 1) {
        const res = await suggest(downApp, id).expect(502);
        expect((res.body as { code: string }).code).toBe('GEOCODING_UNAVAILABLE');
      }
      expect(provider.calls).toBe(5);

      const open = await suggest(downApp, id).expect(502);
      expect(open.headers['content-type']).toContain('application/problem+json');
      expect((open.body as { detail: string }).detail).toContain('temporarily disabled');
      expect(provider.calls).toBe(5); // the breaker answered; the provider was not called

      const server = downApp.getHttpServer();
      await request(server).get(VILLAGES).expect(200);
      await request(server).get(`${VILLAGES}/${slug}/profile`).expect(200);
    });
  });
});
