import { v7 as uuidv7 } from 'uuid';
import {
  DEV_SEED_SOURCES,
  DEV_SEED_VILLAGES,
  type SeedSourceKey,
  type SeedVillage,
} from './dev-seed-data';
import type { SeedApiClient } from './seed-api-client';

/** Anything with pg's `query`, connected as the owner role. */
export interface OwnerDb {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/**
 * The three seed accounts. Development only (the seed refuses production);
 * the password is documented in src/seed/README.md so a developer can log in.
 */
export const DEV_SEED_PASSWORD = 'qaryati-seed-password';
export const DEV_SEED_USERS = {
  admin: 'seed-admin@qaryati.test',
  editor: 'seed-editor@qaryati.test',
  author: 'seed-author@qaryati.test',
} as const;

/** What one run did: the e2e test and the console read it. */
export interface DevSeedReport {
  villagesCreated: string[];
  villagesSkipped: string[];
  claimsVerified: number;
}

interface Session {
  token: string;
}

interface Page<T> {
  content: T[];
  page: { totalPages: number };
}

/**
 * `npm run db:seed`: sample villages written **through the HTTP API**, so every
 * rule of the domain, every audit entry and every projection is the real one.
 *
 * - The author (a contributor) submits every fact; the editor, another account,
 *   verifies each claim (four eyes), which makes it preferred, then publishes.
 * - The one write the API cannot do is the first administrator: it is promoted
 *   by SQL as the owner role, with an audit entry written the same way. That
 *   administrator then promotes the editor through `PATCH /users/{id}/role`.
 * - Idempotent: accounts and sources are found before they are created, and a
 *   village whose slug exists is skipped whole.
 */
export async function seedDevelopment(
  api: SeedApiClient,
  owner: OwnerDb,
  log: (line: string) => void = (line) => console.log(line),
): Promise<DevSeedReport> {
  for (const email of Object.values(DEV_SEED_USERS)) {
    await api.request('POST', '/auth/register', {
      body: { email, password: DEV_SEED_PASSWORD },
      expect: [201, 409],
    });
  }
  await bootstrapAdmin(owner, DEV_SEED_USERS.admin);
  const admin = await login(api, DEV_SEED_USERS.admin);
  await ensureEditor(api, admin, DEV_SEED_USERS.editor);
  const editor = await login(api, DEV_SEED_USERS.editor);
  const author = await login(api, DEV_SEED_USERS.author);

  const sources = {
    facts: await ensureSource(api, author, 'facts'),
    population: await ensureSource(api, author, 'population'),
  };
  const products = await api.request<{ id: string; code: string }[]>('GET', '/products');
  const productIds = new Map(products.body.map((p) => [p.code, p.id]));

  const report: DevSeedReport = { villagesCreated: [], villagesSkipped: [], claimsVerified: 0 };
  for (const village of DEV_SEED_VILLAGES) {
    const existing = await api.request('GET', `/villages/${village.slug}`, {
      token: author.token,
      expect: [200, 404],
    });
    if (existing.status === 200) {
      report.villagesSkipped.push(village.slug);
      continue;
    }
    const verified = await seedVillage(api, { author, editor, sources, productIds }, village);
    report.claimsVerified += verified;
    report.villagesCreated.push(village.slug);
    log(`  ${village.slug}: ${verified} claims verified, published`);
  }
  return report;
}

/** Promotes the first administrator (no API can), audited like an admin's role change. */
async function bootstrapAdmin(owner: OwnerDb, email: string): Promise<void> {
  const { rows } = await owner.query(
    `UPDATE user_account SET role = 'ADMIN', version = version + 1, updated_at = now()
     WHERE email = $1 AND role <> 'ADMIN'
     RETURNING id, status`,
    [email],
  );
  const row = rows[0];
  if (!row) return;
  await owner.query(
    `INSERT INTO audit_entry (id, action, entity_type, entity_id, village_id, actor_id,
       request_id, occurred_at, before, after)
     VALUES ($1, 'user_account.role_changed', 'UserAccount', $2, NULL, NULL, NULL, now(), $3, $4)`,
    [
      uuidv7(),
      row.id,
      { role: 'CONTRIBUTOR', status: row.status },
      { role: 'ADMIN', status: row.status, revokedCount: 0 },
    ],
  );
}

async function login(api: SeedApiClient, email: string): Promise<Session> {
  const response = await api.request<{ accessToken: string }>('POST', '/auth/login', {
    body: { email, password: DEV_SEED_PASSWORD },
  });
  return { token: response.body.accessToken };
}

/** The administrator promotes the editor through the API (audited `user_account.role_changed`). */
async function ensureEditor(api: SeedApiClient, admin: Session, email: string): Promise<void> {
  type User = { id: string; email: string; role: string; version: number };
  for (let page = 0; ; page += 1) {
    const users = await api.request<Page<User>>('GET', `/users?page=${page}&size=100`, {
      token: admin.token,
    });
    const user = users.body.content.find((u) => u.email === email);
    if (user) {
      if (user.role !== 'EDITOR') {
        await api.request('PATCH', `/users/${user.id}/role`, {
          token: admin.token,
          ifMatch: `"${user.version}"`,
          body: { role: 'EDITOR' },
        });
      }
      return;
    }
    if (page + 1 >= users.body.page.totalPages) throw new Error(`${email} was not registered.`);
  }
}

/** Finds a seed source by its unique title, or creates it. */
async function ensureSource(api: SeedApiClient, author: Session, key: SeedSourceKey) {
  const source = DEV_SEED_SOURCES[key];
  const found = await api.request<Page<{ id: string; title: string }>>(
    'GET',
    `/sources?q=${encodeURIComponent(source.title)}&size=100`,
    { token: author.token },
  );
  const existing = found.body.content.find((s) => s.title === source.title);
  if (existing) return existing.id;
  const created = await api.request<{ id: string }>('POST', '/sources', {
    token: author.token,
    body: { ...source, reliability: 1 },
  });
  return created.body.id;
}

interface Context {
  author: Session;
  editor: Session;
  sources: Record<SeedSourceKey, string>;
  productIds: Map<string, string>;
}

/** Creates one village, submits and verifies every fact, publishes it. Returns the claims verified. */
async function seedVillage(api: SeedApiClient, ctx: Context, v: SeedVillage): Promise<number> {
  const created = await api.request<{ id: string }>('POST', '/villages', {
    token: ctx.author.token,
    body: { slug: v.slug, settlementStatus: v.settlementStatus, displayNameAr: v.nameAr },
  });
  const id = created.body.id;
  const facts = { sourceId: ctx.sources.facts };
  const governorate = await api.request<{ id: string }>('GET', `/admin-units/${v.governorate}`);

  const submissions: [string, string, Record<string, unknown>][] = [
    ['POST', 'names', { name: v.nameAr, lang: 'ar', nameType: 'CURRENT', ...facts }],
    ['POST', 'names', { name: v.nameEn, lang: 'en', nameType: 'CURRENT', ...facts }],
    ['POST', 'name-origins', { ...v.origin, ...facts }],
    ['POST', 'affiliations', { adminUnitId: governorate.body.id, ...facts }],
    [
      'PUT',
      'location',
      { latitude: v.latitude, longitude: v.longitude, precision: 'APPROXIMATE', ...facts },
    ],
    ...v.population.map(
      (p) =>
        ['POST', 'population', { ...p, sourceId: ctx.sources.population }] as [
          string,
          string,
          Record<string, unknown>,
        ],
    ),
    ...v.landmarks.map(
      (l) => ['POST', 'landmarks', { ...l, ...facts }] as [string, string, Record<string, unknown>],
    ),
    ...v.products.map(
      (p) =>
        [
          'POST',
          'products',
          {
            productId: productIdOf(ctx.productIds, p.code),
            significance: p.significance,
            ...facts,
          },
        ] as [string, string, Record<string, unknown>],
    ),
    ...v.facilities.map(
      (f) =>
        ['POST', 'facilities', { ...f, ...facts }] as [string, string, Record<string, unknown>],
    ),
  ];

  for (const [method, collection, body] of submissions) {
    const claim = await api.request<{ claimId: string }>(method, `/villages/${id}/${collection}`, {
      token: ctx.author.token,
      body,
    });
    await api.request('POST', `/claims/${claim.body.claimId}/verify`, {
      token: ctx.editor.token,
      ifMatch: claim.etag,
      body: { note: 'Development seed (illustrative values).' },
    });
  }

  // Verifying the names and the location moved the projections, so read the current version.
  const current = await api.request('GET', `/villages/${id}`, { token: ctx.editor.token });
  await api.request('POST', `/villages/${id}/publish`, {
    token: ctx.editor.token,
    ifMatch: current.etag,
  });
  return submissions.length;
}

function productIdOf(ids: Map<string, string>, code: string): string {
  const id = ids.get(code);
  if (!id) throw new Error(`Product ${code} is not seeded (migration 0023).`);
  return id;
}
