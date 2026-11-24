import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../../src/app.module';
import type { AppEnv } from '../../src/config/app-env';
import { CLAIM_TYPES } from '../../src/modules/curation';
import { createTestTokenIssuer, Role } from '../../src/modules/iam';
import { configureApp } from '../../src/platform/http/configure-app';
import { CLOCK, type Clock } from '../../src/shared/kernel';
import {
  SEED_CLAIM_TYPES,
  SEEDED_PRODUCT,
  SEEDED_UNIT,
  seedClaim,
  type SeedClaimType,
} from '../support/claim-seed';

const VILLAGES = '/api/v1/villages';

const USERS = {
  contributor: { id: '00000000-0000-7000-8000-000000390001', role: Role.CONTRIBUTOR },
  editor: { id: '00000000-0000-7000-8000-000000390002', role: Role.EDITOR },
  admin: { id: '00000000-0000-7000-8000-000000390003', role: Role.ADMIN },
} as const;
type UserName = keyof typeof USERS;

const SOURCE_ID = '00000000-0000-7000-8000-000000390020';

interface Fact extends Record<string, unknown> {
  claimId: string;
  source: { id: string; title: string; reliability: number };
  verifiedAt: string | null;
}

interface ProfileBody {
  village: { id: string; slug: string; publicationStatus: string };
  names: Fact[];
  origin: Fact | null;
  affiliations: Fact[];
  location: Fact | null;
  measures: Fact[];
  relations: Fact[];
  population: { latest: Fact | null; history: Fact[] };
  heritage: { history: Fact | null; events: Fact[]; landmarks: Fact[]; culturalItems: Fact[] };
  economy: { products: Fact[]; facilities: Fact[] };
}

describe('profile: /api/v1/villages/{idOrSlug}/profile and /{id}/completeness (e2e)', () => {
  let app: INestApplication<App>;
  let owner: Pool;
  const tokens: Record<UserName, string> = { contributor: '', editor: '', admin: '' };

  const http = () => request(app.getHttpServer());
  const as = (user: UserName) => `Bearer ${tokens[user]}`;

  async function village(status = 'PUBLISHED'): Promise<{ id: string; slug: string }> {
    const slug = `profile-e2e-${randomUUID().slice(0, 8)}`;
    const result = await owner.query<{ id: string }>(
      `INSERT INTO village (id, slug, settlement_status, publication_status, display_name_ar,
         created_by, version, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, 'INHABITED', $2, 'قرية', $3, 1, now(), now())
       RETURNING id`,
      [slug, status, USERS.editor.id],
    );
    return { id: result.rows[0]!.id, slug };
  }

  const seed = (type: SeedClaimType, villageId: string, text?: string, preferred = true) =>
    seedClaim(owner, {
      type,
      villageId,
      sourceId: SOURCE_ID,
      authorId: USERS.contributor.id,
      text,
      preferred,
    });

  const profile = (idOrSlug: string, user?: UserName) => {
    const req = http().get(`${VILLAGES}/${idOrSlug}/profile`);
    return user ? req.set('Authorization', as(user)) : req;
  };

  beforeAll(async () => {
    app = (
      await Test.createTestingModule({ imports: [AppModule] }).compile()
    ).createNestApplication();
    configureApp(app);
    await app.init();

    owner = new Pool({ connectionString: process.env.TEST_DATABASE_OWNER_URL });
    for (const [name, user] of Object.entries(USERS)) {
      await owner.query(
        `INSERT INTO user_account (id, email, password_hash, role, status, version, created_at, updated_at)
         VALUES ($1, $2, 'hash', $3, 'ACTIVE', 1, now(), now()) ON CONFLICT (id) DO NOTHING`,
        [user.id, `profile-e2e-${name}@test.local`, user.role],
      );
    }
    await owner.query(
      `INSERT INTO source (id, source_type, title, reliability, created_by, version, created_at, updated_at)
       VALUES ($1, 'BOOK', 'Profile e2e source', 4, $2, 1, now(), now()) ON CONFLICT (id) DO NOTHING`,
      [SOURCE_ID, USERS.editor.id],
    );

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

  afterAll(async () => {
    await owner?.end();
    await app?.close();
  });

  describe('GET /villages/{idOrSlug}/profile', () => {
    let full: { id: string; slug: string };
    let neighbour: { id: string; slug: string };
    const preferred = new Map<SeedClaimType, string>();
    const unpublished: string[] = [];

    beforeAll(async () => {
      full = await village();
      neighbour = await village();
      for (const type of SEED_CLAIM_TYPES) {
        preferred.set(
          type,
          await seed(type, full.id, type === 'RELATION' ? neighbour.id : undefined),
        );
      }
      // Claims that are not preferred must not appear: an unverified landmark
      // and name, and a relation to a draft village.
      unpublished.push(await seed('LANDMARK', full.id, 'Unverified landmark', false));
      unpublished.push(await seed('VILLAGE_NAME', full.id, 'Unverified name', false));
    });

    it('assembles a fact of every type, each with its provenance, by id and by slug', async () => {
      const res = await profile(full.id).expect(200);
      const body = res.body as ProfileBody;
      const bySlug = (await profile(full.slug).expect(200)).body as ProfileBody;
      expect(bySlug).toEqual(body);

      expect(body.village).toMatchObject({
        id: full.id,
        slug: full.slug,
        publicationStatus: 'PUBLISHED',
      });
      const facts: Record<SeedClaimType, Fact | null | undefined> = {
        VILLAGE_NAME: body.names[0],
        NAME_ORIGIN: body.origin,
        AFFILIATION: body.affiliations[0],
        LOCATION: body.location,
        MEASURE: body.measures[0],
        RELATION: body.relations[0],
        POPULATION: body.population.history[0],
        HISTORY_OVERVIEW: body.heritage.history,
        HISTORICAL_EVENT: body.heritage.events[0],
        LANDMARK: body.heritage.landmarks[0],
        CULTURAL_ITEM: body.heritage.culturalItems[0],
        VILLAGE_PRODUCT: body.economy.products[0],
        FACILITY: body.economy.facilities[0],
      };
      for (const type of SEED_CLAIM_TYPES) {
        expect(facts[type]).toMatchObject({
          claimId: preferred.get(type),
          source: { id: SOURCE_ID, title: 'Profile e2e source', reliability: 4 },
          sourceLocator: null,
          verifiedAt: '2026-11-01T09:00:00.000Z',
        });
      }
      expect(body.population.latest?.claimId).toBe(preferred.get('POPULATION'));
      expect(body.affiliations[0]).toMatchObject({
        adminUnit: { id: SEEDED_UNIT.id, code: SEEDED_UNIT.code, nameAr: SEEDED_UNIT.nameAr },
        validFrom: '1995-01-01',
      });
      expect(body.relations[0]).toMatchObject({
        relationType: 'ADJACENT',
        relatedVillage: { id: neighbour.id, slug: neighbour.slug },
      });
      expect(body.economy.products[0]).toMatchObject({
        product: { id: SEEDED_PRODUCT.id, code: SEEDED_PRODUCT.code },
        significance: 'PRIMARY',
      });
      expect(body.location).toMatchObject({
        latitude: 32.22,
        longitude: 35.25,
        precision: 'EXACT',
      });
      // The internal comparison key of a name is not part of the profile.
      expect(body.names[0]).not.toHaveProperty('nameNormalized');
    });

    it('shows only preferred claims', async () => {
      const body = (await profile(full.id, 'editor').expect(200)).body as ProfileBody;
      const text = JSON.stringify(body);
      for (const claimId of unpublished) expect(text).not.toContain(claimId);
      expect(body.heritage.landmarks).toHaveLength(1);
      expect(body.names).toHaveLength(1);
    });

    it('hides a relation to a draft village from anonymous readers only', async () => {
      const withDraft = await village();
      const draft = await village('DRAFT');
      await seed('RELATION', withDraft.id, draft.id);

      const anonymous = (await profile(withDraft.id).expect(200)).body as ProfileBody;
      expect(anonymous.relations).toEqual([]);
      const loggedIn = (await profile(withDraft.id, 'contributor').expect(200)).body as ProfileBody;
      expect(loggedIn.relations).toHaveLength(1);
    });

    it('returns empty sections for a village without published facts', async () => {
      const empty = await village();
      const body = (await profile(empty.id).expect(200)).body as ProfileBody;
      expect(body).toMatchObject({
        names: [],
        origin: null,
        location: null,
        population: { latest: null, history: [] },
        heritage: { history: null, events: [], landmarks: [], culturalItems: [] },
        economy: { products: [], facilities: [] },
      });
    });

    it('hides a draft from anonymous readers (404) and shows it with a token', async () => {
      const draft = await village('DRAFT');
      await profile(draft.id).expect(404);
      await profile(draft.slug).expect(404);
      const body = (await profile(draft.id, 'contributor').expect(200)).body as ProfileBody;
      expect(body.village.publicationStatus).toBe('DRAFT');
    });

    it('404 for an unknown village', async () => {
      await profile(randomUUID()).expect(404);
      await profile('no-such-village').expect(404);
    });
  });

  describe('GET /villages/{id}/completeness', () => {
    const completeness = (id: string, user?: UserName) => {
      const req = http().get(`${VILLAGES}/${id}/completeness`);
      return user ? req.set('Authorization', as(user)) : req;
    };

    it('lists the claim types without a preferred claim, with a score, for an editor', async () => {
      const partial = await village('DRAFT');
      await seed('VILLAGE_NAME', partial.id);
      await seed('LANDMARK', partial.id);
      await seed('POPULATION', partial.id, '1922', false);

      const res = await completeness(partial.id, 'editor').expect(200);
      expect(res.body).toEqual({
        villageId: partial.id,
        score: Math.floor((2 * 100) / CLAIM_TYPES.length),
        present: ['VILLAGE_NAME', 'LANDMARK'],
        missing: CLAIM_TYPES.filter((t) => t !== 'VILLAGE_NAME' && t !== 'LANDMARK'),
      });
    });

    it('is 100 with nothing missing when every type is published (admin too)', async () => {
      const complete = await village();
      const other = await village();
      for (const type of SEED_CLAIM_TYPES) {
        await seed(type, complete.id, type === 'RELATION' ? other.id : undefined);
      }
      const res = await completeness(complete.id, 'admin').expect(200);
      expect(res.body).toMatchObject({ score: 100, missing: [] });
    });

    it('403 for a contributor, 401 without a token, 404 for an unknown village, 400 for a slug', async () => {
      const target = await village();
      await completeness(target.id, 'contributor').expect(403);
      await completeness(target.id).expect(401);
      await completeness(randomUUID(), 'editor').expect(404);
      await completeness('a-slug', 'editor').expect(400);
    });
  });
});
