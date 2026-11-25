// Write-heavy scenario (#48): logged-in contributors at work. 60% add a
// population record, 30% add a landmark, 10% PATCH a village with If-Match.
// Run: npm run perf:write (docs/performance.md).
//
// 412 Precondition Failed is the API working as designed (optimistic locking):
// it is counted in its own metric, `precondition_failed_412`, and is not an
// error. Two VUs share each account and its draft village, so their PATCHes
// really race and some lose.
import { check, sleep } from 'k6';
import http from 'k6/http';
import { Counter } from 'k6/metrics';
import {
  BASE_URL,
  JSON_HEADERS,
  loadVillages,
  pick,
  randomInt,
  SUMMARY_TREND_STATS,
} from './lib/common.js';

const preconditionFailed = new Counter('precondition_failed_412');
const patchesApplied = new Counter('patch_applied_200');

// 412 is an expected answer here; anything else outside 2xx counts as failed.
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 299 }, 412));

const ENDPOINTS = ['population_add', 'landmark_add', 'village_read', 'village_patch'];
const thresholds = {
  http_req_failed: ['rate<0.01'],
  http_req_duration: ['p(95)<800'],
  checks: ['rate>0.99'],
  precondition_failed_412: ['count>=0'],
  patch_applied_200: ['count>=0'],
};
for (const endpoint of ENDPOINTS) {
  thresholds[`http_req_duration{endpoint:${endpoint}}`] = ['p(95)<800'];
  thresholds[`http_req_failed{endpoint:${endpoint}}`] = ['rate<0.01'];
  thresholds[`http_reqs{endpoint:${endpoint}}`] = ['count>0'];
}

const USERS = Number(__ENV.USERS || 20);

export const options = {
  scenarios: {
    contributors: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: __ENV.RAMP || '20s', target: Number(__ENV.VUS || 40) },
        { duration: __ENV.HOLD || '2m', target: Number(__ENV.VUS || 40) },
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '5s',
    },
  },
  // Registration hashes passwords (Argon2): give setup time for N accounts.
  setupTimeout: '120s',
  thresholds,
  summaryTrendStats: SUMMARY_TREND_STATS,
};

const LANDMARK_TYPES = ['MOSQUE', 'CHURCH', 'MAQAM', 'SPRING', 'WELL', 'MILL', 'OLIVE_PRESS'];
const COUNT_TYPES = ['CENSUS', 'ESTIMATE', 'REGISTERED'];

function post(path, body, token, endpoint) {
  return http.post(`${BASE_URL}${path}`, JSON.stringify(body), {
    headers: { ...JSON_HEADERS, Authorization: `Bearer ${token}` },
    tags: { endpoint },
  });
}

/**
 * N accounts registered and logged in through the API (no back door), each
 * with its own source (population claims require one) and its own draft
 * village, which its creator may PATCH while it is a draft.
 */
export function setup() {
  const villages = loadVillages();
  const run = `${Date.now()}`;
  const users = [];
  for (let i = 0; i < USERS; i += 1) {
    const credentials = { email: `k6-${run}-${i}@qaryati.test`, password: 'k6-load-test-password' };
    const registered = http.post(`${BASE_URL}/auth/register`, JSON.stringify(credentials), {
      headers: JSON_HEADERS,
      tags: { endpoint: 'setup' },
    });
    if (registered.status !== 201) throw new Error(`setup: register answered ${registered.status}`);
    const login = http.post(`${BASE_URL}/auth/login`, JSON.stringify(credentials), {
      headers: JSON_HEADERS,
      tags: { endpoint: 'setup' },
    });
    if (login.status !== 200) throw new Error(`setup: login answered ${login.status}`);
    const token = login.json('accessToken');
    const source = post(
      '/sources',
      { sourceType: 'ORAL_HISTORY', title: `k6 load test source ${run}-${i}`, reliability: 2 },
      token,
      'setup',
    );
    const draft = post(
      '/villages',
      { slug: `k6-${run}-${i}`, settlementStatus: 'INHABITED', displayNameAr: `قرية تجريبية ${i}` },
      token,
      'setup',
    );
    if (source.status !== 201 || draft.status !== 201) {
      throw new Error(`setup: source ${source.status}, draft village ${draft.status}`);
    }
    users.push({ token, sourceId: source.json('id'), draftId: draft.json('id') });
  }
  return { villages, users };
}

export default function (data) {
  const user = data.users[(__VU - 1) % data.users.length];
  const roll = Math.random();

  if (roll < 0.6) {
    const village = pick(data.villages);
    const res = post(
      `/villages/${village.id}/population`,
      {
        population: randomInt(0, 1000000),
        referenceYear: randomInt(1800, 2025),
        countType: pick(COUNT_TYPES),
        sourceId: user.sourceId,
      },
      user.token,
      'population_add',
    );
    check(res, { 'population added (201)': (r) => r.status === 201 });
  } else if (roll < 0.9) {
    const village = pick(data.villages);
    const res = post(
      `/villages/${village.id}/landmarks`,
      {
        name: `معلم ${__VU}-${__ITER}-${randomInt(0, 1e9)}`,
        landmarkType: pick(LANDMARK_TYPES),
        description: 'k6 load test landmark',
      },
      user.token,
      'landmark_add',
    );
    check(res, { 'landmark added (201)': (r) => r.status === 201 });
  } else {
    const auth = { Authorization: `Bearer ${user.token}` };
    const current = http.get(`${BASE_URL}/villages/${user.draftId}`, {
      headers: auth,
      tags: { endpoint: 'village_read' },
    });
    const res = http.patch(
      `${BASE_URL}/villages/${user.draftId}`,
      JSON.stringify({ displayNameEn: `k6 draft ${randomInt(0, 1e9)}` }),
      {
        headers: { ...JSON_HEADERS, ...auth, 'If-Match': current.headers.Etag },
        tags: { endpoint: 'village_patch' },
      },
    );
    if (res.status === 412) preconditionFailed.add(1);
    if (res.status === 200) patchesApplied.add(1);
    check(res, {
      'patch applied (200) or stale (412)': (r) => r.status === 200 || r.status === 412,
    });
  }
  // THINK=0 removes the think time: the saturation run of docs/performance.md.
  if (__ENV.THINK !== '0') sleep(0.1 + Math.random() * 0.4);
}
