import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Pool } from 'pg';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/platform/http/configure-app';
import { DEV_SEED_USERS, seedDevelopment } from '../../src/seed/dev/dev-seed';
import { DEV_SEED_VILLAGES } from '../../src/seed/dev/dev-seed-data';
import { SeedApiClient } from '../../src/seed/dev/seed-api-client';

/**
 * `npm run db:seed` against the real app over HTTP (real audit recorder, real
 * review workflow), twice: the second run must change nothing.
 */
describe('db:seed: development sample villages (e2e)', () => {
  let app: INestApplication<App>;
  let owner: Pool;
  let api: SeedApiClient;
  const quiet = () => undefined;

  /** Rows that only the seed's own accounts wrote: the shared e2e database has other suites' rows. */
  async function seedFootprint() {
    const { rows } = await owner.query<{ claims: number; audits: number; villages: number }>(
      `SELECT
         (SELECT count(*)::int FROM claim c JOIN user_account u ON u.id = c.created_by
           WHERE u.email = $1) AS claims,
         (SELECT count(*)::int FROM audit_entry a JOIN user_account u ON u.id = a.actor_id
           WHERE u.email = ANY($2)) AS audits,
         (SELECT count(*)::int FROM village WHERE slug = ANY($3)) AS villages`,
      [DEV_SEED_USERS.author, Object.values(DEV_SEED_USERS), DEV_SEED_VILLAGES.map((v) => v.slug)],
    );
    return rows[0]!;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    const { port } = (app.getHttpServer() as unknown as Server).address() as AddressInfo;
    api = new SeedApiClient(`http://127.0.0.1:${port}`, {
      fetch: globalThis.fetch,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      log: quiet,
    });
    owner = new Pool({ connectionString: process.env.TEST_DATABASE_OWNER_URL });
  });

  afterAll(async () => {
    await owner?.end();
    await app?.close();
  });

  it('creates, verifies and publishes every sample village, then changes nothing on a second run', async () => {
    const first = await seedDevelopment(api, owner, quiet);
    expect(first.villagesCreated).toEqual(DEV_SEED_VILLAGES.map((v) => v.slug));
    const after = await seedFootprint();
    expect(after.villages).toBe(DEV_SEED_VILLAGES.length);
    expect(after.claims).toBe(first.claimsVerified);

    const second = await seedDevelopment(api, owner, quiet);
    expect(second).toEqual({
      villagesCreated: [],
      villagesSkipped: DEV_SEED_VILLAGES.map((v) => v.slug),
      claimsVerified: 0,
    });
    expect(await seedFootprint()).toEqual(after);
  });

  it('publishes villages whose public profile shows preferred, sourced facts', async () => {
    const battir = DEV_SEED_VILLAGES.find((v) => v.slug === 'battir')!;
    const profile = await api.request<{
      village: { publicationStatus: string; displayNameEn: string; location: unknown };
      names: { name: string; source: { title: string } }[];
      population: { history: unknown[] };
      landmarks?: unknown[];
    }>('GET', '/villages/battir/profile');

    expect(profile.body.village.publicationStatus).toBe('PUBLISHED');
    expect(profile.body.village.displayNameEn).toBe('Battir');
    expect(profile.body.village.location).toEqual({
      latitude: battir.latitude,
      longitude: battir.longitude,
    });
    expect(profile.body.names.map((n) => n.name).sort()).toEqual(['Battir', 'بتير']);
    expect(profile.body.names[0]!.source.title).toContain('illustrative');
  });

  it('records every write in the audit trail, by the account that made it (four eyes)', async () => {
    const { rows } = await owner.query<{ action: string; email: string; n: number }>(
      `SELECT a.action, u.email, count(*)::int AS n
       FROM audit_entry a JOIN user_account u ON u.id = a.actor_id
       WHERE u.email = ANY($1) AND a.action IN ('claim.submitted', 'claim.verified', 'village.published')
       GROUP BY a.action, u.email ORDER BY a.action`,
      [Object.values(DEV_SEED_USERS)],
    );
    const claims = (await seedFootprint()).claims;
    expect(rows).toEqual([
      { action: 'claim.submitted', email: DEV_SEED_USERS.author, n: claims },
      { action: 'claim.verified', email: DEV_SEED_USERS.editor, n: claims },
      { action: 'village.published', email: DEV_SEED_USERS.editor, n: DEV_SEED_VILLAGES.length },
    ]);
  });
});
