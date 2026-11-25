/** One HTTP answer of the API, as the development seed needs it. */
export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
  etag: string | undefined;
}

/** What one request carries besides its method and path. */
export interface ApiRequestOptions {
  token?: string;
  body?: unknown;
  ifMatch?: string;
  /** Statuses that count as success; anything else throws. Default: 2xx. */
  expect?: readonly number[];
}

/** The seams the tests replace: the network and the clock that waits. */
export interface SeedApiClientDeps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  log: (line: string) => void;
}

/** How many 429 answers in a row one request accepts before the seed gives up. */
export const MAX_RATE_LIMIT_RETRIES = 10;

/**
 * A small JSON client for the versioned API (`<base>/api/v1`).
 *
 * The seed runs against the API with rate limiting on (#25): a 429 is waited
 * out for the `Retry-After` seconds the API sends and the request is sent again,
 * so the seed never needs `RATE_LIMIT_ENABLED=false`. Any other unexpected
 * status throws with the problem `detail`, so a broken seed stops at once.
 */
export class SeedApiClient {
  private readonly root: string;

  constructor(
    baseUrl: string,
    private readonly deps: SeedApiClientDeps = {
      fetch: globalThis.fetch,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      log: (line) => console.log(line),
    },
  ) {
    this.root = `${baseUrl.replace(/\/+$/, '')}/api/v1`;
  }

  /** Sends one request; retries after 429 as the API's `Retry-After` says. */
  async request<T = unknown>(
    method: string,
    path: string,
    options: ApiRequestOptions = {},
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    if (options.ifMatch) headers['if-match'] = options.ifMatch;
    if (options.body !== undefined) headers['content-type'] = 'application/json';

    for (let attempt = 0; ; attempt += 1) {
      const response = await this.deps.fetch(`${this.root}${path}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      if (response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
        const seconds = retryAfterSeconds(response.headers.get('retry-after'));
        this.deps.log(`  rate limited on ${method} ${path}; waiting ${seconds}s (Retry-After)`);
        await response.body?.cancel();
        await this.deps.sleep(seconds * 1000);
        continue;
      }
      const text = await response.text();
      const body = (text ? JSON.parse(text) : undefined) as T;
      const ok = options.expect
        ? options.expect.includes(response.status)
        : response.status >= 200 && response.status < 300;
      if (!ok) {
        const detail = (body as { detail?: string } | undefined)?.detail ?? text;
        throw new Error(`${method} ${path} answered ${response.status}: ${detail}`);
      }
      return { status: response.status, body, etag: response.headers.get('etag') ?? undefined };
    }
  }
}

/** `Retry-After` in seconds (the API sends an integer); 1 when missing or unreadable. */
export function retryAfterSeconds(header: string | null): number {
  const seconds = Number(header);
  return Number.isInteger(seconds) && seconds > 0 ? seconds : 1;
}
