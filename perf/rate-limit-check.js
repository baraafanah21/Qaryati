// Rate-limit check (#25): the load tests run with rate limiting off
// (docs/performance.md), so this short script shows it works when it is on.
// One anonymous client sends requests until the API answers 429, and checks
// that the 429 carries a positive integer Retry-After.
// Run against the normal stack (rate limiting on): npm run perf:ratelimit.
import { check, fail } from 'k6';
import http from 'k6/http';
import { Counter } from 'k6/metrics';
import { BASE_URL } from './lib/common.js';

const limited = new Counter('rate_limited_429');

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    rate_limited_429: ['count>0'],
    checks: ['rate==1'],
  },
};

// The anonymous limit is 120 per minute by default; send a little more.
const MAX_REQUESTS = Number(__ENV.MAX_REQUESTS || 200);

export default function () {
  // 429 is the answer this script is looking for, not a failure.
  http.setResponseCallback(http.expectedStatuses(200, 429));
  for (let i = 1; i <= MAX_REQUESTS; i += 1) {
    const res = http.get(`${BASE_URL}/villages?size=1`);
    if (res.status === 429) {
      limited.add(1);
      const retryAfter = res.headers['Retry-After'];
      check(res, {
        '429 has a positive integer Retry-After': () => /^[1-9][0-9]*$/.test(retryAfter || ''),
        '429 is application/problem+json RATE_LIMITED': (r) =>
          String(r.headers['Content-Type']).startsWith('application/problem+json') &&
          r.json('code') === 'RATE_LIMITED',
      });
      console.log(`429 after ${i} requests, Retry-After: ${retryAfter}s`);
      return;
    }
    if (res.status !== 200) fail(`unexpected ${res.status}`);
  }
  console.error(`no 429 after ${MAX_REQUESTS} requests: is RATE_LIMIT_ENABLED=false?`);
}
