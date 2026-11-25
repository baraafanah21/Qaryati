// Shared helpers of the k6 scenarios (docs/performance.md). Plain k6 JavaScript:
// k6 runs it in its own runtime, not in Node.
import http from 'k6/http';

/** The API inside the Compose network; scripts/perf/run-k6.sh sets it. */
export const BASE_URL = `${__ENV.BASE_URL || 'http://api:3000'}/api/v1`;

export const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** A whole number in [min, max]. */
export function randomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/** One element of a non-empty array. */
export function pick(items) {
  return items[Math.floor(Math.random() * items.length)];
}

/**
 * Every published village, read page by page in setup() (anonymous, like a
 * visitor). Fails the run at once when the database is empty: a load test on
 * an empty catalogue would measure nothing.
 */
export function loadVillages() {
  const villages = [];
  for (let page = 0; ; page += 1) {
    const res = http.get(`${BASE_URL}/villages?size=100&page=${page}&sort=createdAt,asc`, {
      tags: { endpoint: 'setup' },
    });
    if (res.status !== 200) throw new Error(`setup: GET /villages answered ${res.status}`);
    const body = res.json();
    for (const v of body.content) {
      villages.push({ id: v.id, slug: v.slug, nameAr: v.displayNameAr, nameEn: v.displayNameEn });
    }
    if (page + 1 >= body.page.totalPages) break;
  }
  if (villages.length === 0) {
    throw new Error('setup: no published village. Run npm run db:seed:perf first.');
  }
  return villages;
}

/** Trend statistics written to the JSON summary (the baseline reads avg and p95). */
export const SUMMARY_TREND_STATS = ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max', 'count'];
