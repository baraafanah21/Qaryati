import { Client } from 'pg';
import { PERF_USERS, seedPerf } from '../../src/seed/perf/perf-seed';
import { generatePerfVillages } from '../../src/seed/perf/perf-generator';
import {
  CONTAINER_STARTUP_TIMEOUT_MS,
  startTestDatabase,
  type TestDatabase,
} from '../support/test-database';

const COUNT = 30;

describe('db:seed:perf: synthetic villages (PostGIS)', () => {
  let database: TestDatabase;
  let owner: Client;

  beforeAll(async () => {
    database = await startTestDatabase();
    owner = new Client({ connectionString: database.ownerUrl });
    await owner.connect();
  }, CONTAINER_STARTUP_TIMEOUT_MS);

  afterAll(async () => {
    await owner?.end();
    await database?.stop();
  });

  it('writes every village with its facts, and a second run inserts nothing', async () => {
    const villages = generatePerfVillages(COUNT);
    const facts = (pick: (v: (typeof villages)[number]) => number) =>
      villages.reduce((sum, v) => sum + pick(v), 0);

    const first = await seedPerf(owner, COUNT);
    expect(first.inserted).toEqual({
      village: COUNT,
      claim: first.inserted.claim,
      village_name: COUNT * 2,
      village_location: COUNT,
      village_affiliation: COUNT,
      population_record: facts((v) => v.population.length),
      landmark: facts((v) => v.landmarks.length),
      village_product: facts((v) => v.products.length),
    });
    expect(first.inserted.claim).toBe(
      COUNT * 4 + facts((v) => v.population.length + v.landmarks.length + v.products.length),
    );

    const second = await seedPerf(owner, COUNT);
    expect(Object.values(second.inserted).every((n) => n === 0)).toBe(true);
    expect(second.tableCounts).toEqual(first.tableCounts);
  });

  it('writes only verified, preferred claims reviewed by another account (four eyes)', async () => {
    const { rows } = await owner.query<{ status: string; preferred: boolean; n: number }>(
      `SELECT status, is_preferred AS preferred, count(*)::int AS n FROM claim
       WHERE created_by = $1 AND reviewed_by = $2 AND source_id IS NOT NULL
       GROUP BY status, is_preferred`,
      [PERF_USERS.author.id, PERF_USERS.editor.id],
    );
    const total = await owner.query<{ n: number }>('SELECT count(*)::int AS n FROM claim');
    expect(rows).toEqual([{ status: 'VERIFIED', preferred: true, n: total.rows[0]!.n }]);
  });

  it('keeps each projection equal to its preferred claim', async () => {
    const { rows } = await owner.query<{ mismatches: number }>(
      `SELECT count(*)::int AS mismatches FROM village v
       WHERE v.display_name_ar IS DISTINCT FROM (
               SELECT n.name FROM village_name n JOIN claim c ON c.id = n.claim_id
               WHERE c.village_id = v.id AND c.is_preferred AND n.lang = 'ar' AND n.name_type = 'CURRENT')
          OR v.display_name_en IS DISTINCT FROM (
               SELECT n.name FROM village_name n JOIN claim c ON c.id = n.claim_id
               WHERE c.village_id = v.id AND c.is_preferred AND n.lang = 'en' AND n.name_type = 'CURRENT')
          OR NOT ST_Equals(v.location::geometry, (
               SELECT l.point::geometry FROM village_location l JOIN claim c ON c.id = l.claim_id
               WHERE c.village_id = v.id AND c.is_preferred))`,
    );
    expect(rows[0]!.mismatches).toBe(0);
  });
});
