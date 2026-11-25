// Read-heavy scenario (#47): what visitors do. 50% search with partial names,
// 30% village profile, 20% population history. Anonymous, like the public site.
// Run: npm run perf:read (docs/performance.md).
import { check, sleep } from 'k6';
import http from 'k6/http';
import { BASE_URL, loadVillages, pick, randomInt, SUMMARY_TREND_STATS } from './lib/common.js';

const ENDPOINTS = ['search', 'profile', 'population'];

// The targets of docs/performance.md. A run that misses them fails (k6 exits
// non-zero) and the summary still records the numbers: misses are reported,
// never hidden. The per-endpoint entries also make k6 report each group.
const thresholds = {
  http_req_failed: ['rate<0.01'],
  http_req_duration: ['p(95)<500'],
  checks: ['rate>0.99'],
};
for (const endpoint of ENDPOINTS) {
  thresholds[`http_req_duration{endpoint:${endpoint}}`] = ['p(95)<500'];
  thresholds[`http_req_failed{endpoint:${endpoint}}`] = ['rate<0.01'];
  thresholds[`http_reqs{endpoint:${endpoint}}`] = ['count>0'];
}

export const options = {
  scenarios: {
    visitors: {
      executor: 'ramping-vus',
      startVUs: 0,
      // Ramp up, hold a steady load (the measured part), ramp down.
      stages: [
        { duration: __ENV.RAMP || '30s', target: Number(__ENV.VUS || 50) },
        { duration: __ENV.HOLD || '2m', target: Number(__ENV.VUS || 50) },
        { duration: '10s', target: 0 },
      ],
      gracefulRampDown: '5s',
    },
  },
  thresholds,
  summaryTrendStats: SUMMARY_TREND_STATS,
};

export function setup() {
  return { villages: loadVillages() };
}

/** A realistic partial name: 3–6 letters of one word of a real village name. */
function partialName(village) {
  const name = Math.random() < 0.5 ? village.nameAr : village.nameEn || village.nameAr;
  const words = name.split(/\s+/).filter((w) => w.length >= 3);
  const word = words.length > 0 ? pick(words) : name;
  return word.slice(0, randomInt(3, Math.min(6, word.length)));
}

export default function (data) {
  const village = pick(data.villages);
  const roll = Math.random();
  let res;
  if (roll < 0.5) {
    const q = encodeURIComponent(partialName(village));
    res = http.get(`${BASE_URL}/villages?q=${q}&size=20`, { tags: { endpoint: 'search' } });
  } else if (roll < 0.8) {
    res = http.get(`${BASE_URL}/villages/${village.slug}/profile`, {
      tags: { endpoint: 'profile' },
    });
  } else {
    res = http.get(`${BASE_URL}/villages/${village.id}/population?size=50`, {
      tags: { endpoint: 'population' },
    });
  }
  check(res, { 'status is 200': (r) => r.status === 200 });
  // Think time of a reader between two pages. THINK=0 removes it: the
  // saturation run of docs/performance.md.
  if (__ENV.THINK !== '0') sleep(0.1 + Math.random() * 0.4);
}
