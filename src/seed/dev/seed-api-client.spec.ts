import { MAX_RATE_LIMIT_RETRIES, retryAfterSeconds, SeedApiClient } from './seed-api-client';

function answer(status: number, body?: unknown, headers: Record<string, string> = {}): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
}

function client(responses: Response[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const waits: number[] = [];
  const fetchFake = (url: string, init?: RequestInit) => {
    calls.push({ url, init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error('no more responses');
    return Promise.resolve(next);
  };
  const api = new SeedApiClient('http://api:3000/', {
    fetch: fetchFake as unknown as typeof fetch,
    sleep: (ms) => {
      waits.push(ms);
      return Promise.resolve();
    },
    log: () => undefined,
  });
  return { api, calls, waits };
}

describe('SeedApiClient', () => {
  it('sends JSON with the token and If-Match to /api/v1, and returns the ETag', async () => {
    const { api, calls } = client([answer(201, { id: 'x' }, { etag: '"1"' })]);

    const result = await api.request('POST', '/villages', {
      token: 't',
      ifMatch: '"3"',
      body: { a: 1 },
    });

    expect(result).toEqual({ status: 201, body: { id: 'x' }, etag: '"1"' });
    expect(calls[0]!.url).toBe('http://api:3000/api/v1/villages');
    expect(calls[0]!.init.headers).toMatchObject({
      authorization: 'Bearer t',
      'if-match': '"3"',
      'content-type': 'application/json',
    });
    expect(calls[0]!.init.body).toBe('{"a":1}');
  });

  it('waits Retry-After seconds after a 429 and sends the request again', async () => {
    const { api, calls, waits } = client([
      answer(429, { detail: 'slow down' }, { 'retry-after': '7' }),
      answer(200, { ok: true }),
    ]);

    const result = await api.request('GET', '/villages');

    expect(result.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(waits).toEqual([7000]);
  });

  it('gives up after the retry limit and throws the 429', async () => {
    const responses = Array.from({ length: MAX_RATE_LIMIT_RETRIES + 1 }, () =>
      answer(429, { detail: 'Too many requests' }, { 'retry-after': '1' }),
    );
    const { api, waits } = client(responses);

    await expect(api.request('GET', '/villages')).rejects.toThrow(
      'GET /villages answered 429: Too many requests',
    );
    expect(waits).toHaveLength(MAX_RATE_LIMIT_RETRIES);
  });

  it('throws the problem detail of an unexpected status', async () => {
    const { api } = client([answer(422, { detail: 'bad slug' })]);

    await expect(api.request('POST', '/villages', { body: {} })).rejects.toThrow(
      'POST /villages answered 422: bad slug',
    );
  });

  it('accepts the statuses the caller expects', async () => {
    const { api } = client([answer(409, { detail: 'exists' })]);

    const result = await api.request('POST', '/auth/register', { body: {}, expect: [201, 409] });

    expect(result.status).toBe(409);
  });
});

describe('retryAfterSeconds', () => {
  it.each([
    ['30', 30],
    [null, 1],
    ['0', 1],
    ['soon', 1],
  ])('%s → %d', (header, seconds) => {
    expect(retryAfterSeconds(header)).toBe(seconds);
  });
});
