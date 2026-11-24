import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import type { AppEnv } from '../../src/config/app-env';
import { createTestTokenIssuer, Role } from '../../src/modules/iam';
import { configureApp } from '../../src/platform/http/configure-app';
import { CLOCK, type Clock } from '../../src/shared/kernel';

const VILLAGES = '/api/v1/villages';
const EDITOR = { id: '00000000-0000-7000-8000-000000000d01', role: Role.EDITOR };
const CONTRIBUTOR = { id: '00000000-0000-7000-8000-000000000d02', role: Role.CONTRIBUTOR };

/**
 * Own villages with fixed names and creation times. The e2e database is shared
 * by every e2e file, so each list request is scoped to these with `ids=`.
 */
const ROWS = [
  { id: '00000000-0000-7000-8000-000000000d10', ar: 'بيت فوريك', en: 'Beit Furik', day: 3 },
  { id: '00000000-0000-7000-8000-000000000d11', ar: 'تل', en: 'Tell', day: 1 },
  { id: '00000000-0000-7000-8000-000000000d12', ar: 'جيوس', en: null, day: 5 },
  { id: '00000000-0000-7000-8000-000000000d13', ar: 'عورتا', en: 'Awarta', day: 2 },
  { id: '00000000-0000-7000-8000-000000000d14', ar: 'بيت دجن', en: 'Beit Dajan', day: 4 },
] as const;
const DRAFT = {
  id: '00000000-0000-7000-8000-000000000d15',
  ar: 'بيت إيبا',
  en: 'Beit Iba',
  day: 6,
};
const ALL_IDS = [...ROWS, DRAFT].map((row) => row.id).join(',');

interface SummaryBody {
  id: string;
  publicationStatus: string;
  displayNameAr: string;
  relevance: number | null;
}
interface PageBody {
  content: SummaryBody[];
  page: { number: number; size: number; totalElements: number; totalPages: number };
}

describe('village search: GET /api/v1/villages (e2e)', () => {
  let app: INestApplication<App>;
  let owner: Pool;
  const tokens = { editor: '', contributor: '' };

  const http = () => request(app.getHttpServer());
  const list = async (query: Record<string, string | string[]>, token?: string) => {
    const req = http().get(VILLAGES).query(query);
    if (token) req.set('Authorization', `Bearer ${token}`);
    const res = await req.expect(200);
    return res.body as PageBody;
  };
  const idsOf = (body: PageBody) => body.content.map((village) => village.id);
  const idsSortedBy = (pick: (row: (typeof ROWS)[number]) => string | number) =>
    [...ROWS].sort((a, b) => (pick(a) < pick(b) ? -1 : 1)).map((row) => row.id);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();

    owner = new Pool({ connectionString: process.env.TEST_DATABASE_OWNER_URL });
    for (const user of [EDITOR, CONTRIBUTOR]) {
      await owner.query(
        `INSERT INTO user_account (id, email, password_hash, role, status, version, created_at, updated_at)
         VALUES ($1, $2, 'hash', $3, 'ACTIVE', 1, now(), now()) ON CONFLICT (id) DO NOTHING`,
        [user.id, `village-search-${user.id}@test.local`, user.role],
      );
    }
    for (const row of [...ROWS, DRAFT]) {
      await owner.query(
        `INSERT INTO village (id, slug, settlement_status, publication_status, display_name_ar,
           display_name_en, created_by, version, created_at, updated_at)
         VALUES ($1, $2, 'INHABITED', $3, $4, $5, $6, 1,
           timestamptz '2026-01-01T00:00:00Z' + make_interval(days => $7), now())
         ON CONFLICT (id) DO NOTHING`,
        [
          row.id,
          `search-e2e-${row.id.slice(-2)}`,
          row === DRAFT ? 'DRAFT' : 'PUBLISHED',
          row.ar,
          row.en,
          EDITOR.id,
          row.day,
        ],
      );
    }

    const config = app.get<ConfigService<AppEnv, true>>(ConfigService);
    const issuer = await createTestTokenIssuer({
      privateKeyFile: config.get('JWT_PRIVATE_KEY_FILE', { infer: true }),
      publicKeyFile: config.get('JWT_PUBLIC_KEY_FILE', { infer: true }),
      issuer: config.get('JWT_ISSUER', { infer: true }),
      clock: app.get<Clock>(CLOCK),
    });
    tokens.editor = await issuer.mint(EDITOR);
    tokens.contributor = await issuer.mint(CONTRIBUTOR);
  });

  afterAll(async () => {
    await owner?.end();
    await app?.close();
  });

  it('pages with Page<T> metadata (zero-based, default size 20)', async () => {
    const first = await list({ ids: ALL_IDS });
    expect(first.page).toEqual({ number: 0, size: 20, totalElements: 5, totalPages: 1 });

    const second = await list({ ids: ALL_IDS, size: '2', page: '1' });
    expect(second.page).toEqual({ number: 1, size: 2, totalElements: 5, totalPages: 3 });
    expect(idsOf(second)).toEqual(idsSortedBy((row) => row.ar).slice(2, 4));

    const past = await list({ ids: ALL_IDS, size: '2', page: '9' });
    expect(past.content).toEqual([]);
    expect(past.page.totalElements).toBe(5);
  });

  it('sorts by nameAr by default, and by each allowed field in both directions', async () => {
    const byAr = idsSortedBy((row) => row.ar);
    expect(idsOf(await list({ ids: ALL_IDS }))).toEqual(byAr);
    expect(idsOf(await list({ ids: ALL_IDS, sort: 'nameAr,desc' }))).toEqual([...byAr].reverse());

    const byCreated = idsSortedBy((row) => row.day);
    expect(idsOf(await list({ ids: ALL_IDS, sort: 'createdAt' }))).toEqual(byCreated);
    expect(idsOf(await list({ ids: ALL_IDS, sort: 'createdAt,desc' }))).toEqual(
      [...byCreated].reverse(),
    );

    // A village without an English name comes last in both directions.
    const named = ROWS.filter((row) => row.en !== null);
    const byEn = [...named].sort((a, b) => (a.en < b.en ? -1 : 1)).map((row) => row.id);
    const noEn = ROWS.filter((row) => row.en === null).map((row) => row.id);
    expect(idsOf(await list({ ids: ALL_IDS, sort: 'nameEn' }))).toEqual([...byEn, ...noEn]);
    expect(idsOf(await list({ ids: ALL_IDS, sort: 'nameEn,desc' }))).toEqual([
      ...[...byEn].reverse(),
      ...noEn,
    ]);
  });

  it('sorts by relevance with q, best match first by default', async () => {
    const body = await list({ ids: ALL_IDS, q: 'بيت فوريق' });
    expect(body.content[0]!.id).toBe(ROWS[0].id);
    const relevance = body.content.map((village) => village.relevance!);
    expect(relevance).toEqual([...relevance].sort((a, b) => b - a));
    expect(relevance.every((value) => value > 0 && value <= 1)).toBe(true);

    const ascending = await list({ ids: ALL_IDS, q: 'بيت فوريق', sort: 'relevance,asc' });
    expect(idsOf(ascending)).toEqual([...idsOf(body)].reverse());

    expect((await list({ ids: ALL_IDS })).content.every((v) => v.relevance === null)).toBe(true);
  });

  it.each([
    [{ sort: 'slug' }, 'sort'],
    [{ sort: 'relevance' }, 'sort'],
    [{ size: '101' }, 'size'],
    [{ page: '-1' }, 'page'],
    [{ ids: 'nope' }, 'ids'],
    [{ settlementStatus: 'GONE' }, 'settlementStatus'],
    [{ product: 'olives' }, 'product'],
  ])('answers 400 VALIDATION_FAILED for %j', async (query, field) => {
    const res = await http().get(VILLAGES).query(query).expect(400);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect((res.body as { errors: { field: string }[] }).errors[0]!.field).toMatch(
      new RegExp(`^${field}`),
    );
  });

  it('answers 422 for an unknown governorate and 401 for an invalid token', async () => {
    const res = await http().get(VILLAGES).query({ governorate: 'atlantis' }).expect(422);
    expect(res.body).toMatchObject({ errors: [{ field: 'governorate' }] });
    await http().get(VILLAGES).set('Authorization', 'Bearer not-a-token').expect(401);
  });

  it('never shows a draft to anonymous callers or contributors, whatever they filter by', async () => {
    for (const token of [undefined, tokens.contributor]) {
      for (const query of [
        { ids: ALL_IDS } as Record<string, string>,
        { ids: ALL_IDS, publicationStatus: 'DRAFT' },
        { ids: DRAFT.id, q: DRAFT.ar },
      ]) {
        const body = await list(query, token);
        expect(idsOf(body)).not.toContain(DRAFT.id);
        expect(body.content.every((v) => v.publicationStatus === 'PUBLISHED')).toBe(true);
      }
    }
  });

  it('shows drafts to editors, who may filter by publication status', async () => {
    expect(idsOf(await list({ ids: ALL_IDS }, tokens.editor))).toContain(DRAFT.id);
    expect(idsOf(await list({ ids: ALL_IDS, publicationStatus: 'DRAFT' }, tokens.editor))).toEqual([
      DRAFT.id,
    ]);
  });
});
