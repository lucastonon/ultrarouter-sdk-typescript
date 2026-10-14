// — retries, backoff, Retry-After, idempotency-key stability, abort.
import { describe, expect, it } from 'vitest';

import { UltraRouterError } from '../src/errors.js';
import { executeRequest, type HttpRequest, type RetryClock } from '../src/http.js';

/** A deterministic clock: instant sleeps (recorded), fixed jitter, frozen now. */
function fakeClock(): { clock: RetryClock; sleeps: number[] } {
  const sleeps: number[] = [];
  const clock: RetryClock = {
    now: () => 0,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0.5,
  };
  return { clock, sleeps };
}

/** A scripted fetch: returns the i-th response (last repeats); records calls. */
function scriptedFetch(responses: (Response | (() => Response))[]): {
  fetch: (url: string | URL, init?: RequestInit) => Promise<Response>;
  calls: RequestInit[];
} {
  const calls: RequestInit[] = [];
  const fetch = async (_url: string | URL, init?: RequestInit): Promise<Response> => {
    calls.push(init ?? {});
    if (init?.signal?.aborted === true) throw new Error('aborted by signal');
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    const resolved = typeof next === 'function' ? next() : next;
    if (resolved === undefined) throw new Error('no scripted response');
    return resolved;
  };
  return { fetch, calls };
}

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function req(overrides: Partial<HttpRequest> = {}): HttpRequest {
  return {
    method: 'POST',
    url: 'https://gw.test/v1/chat/completions',
    headers: {},
    body: '{}',
    stream: false,
    timeoutMs: 60_000,
    maxRetries: 2,
    ...overrides,
  };
}

describe('executeRequest — retry policy', () => {
  it('retries a 429 then succeeds, honoring Retry-After', async () => {
    const { fetch, calls } = scriptedFetch([
      jsonResponse(429, { error: { code: 'rate_limited' } }, { 'retry-after': '2' }),
      jsonResponse(200, { ok: true }),
    ]);
    const { clock, sleeps } = fakeClock();
    const res = await executeRequest({ fetch, clock }, req());
    expect(res.response.status).toBe(200);
    expect(calls.length).toBe(2);
    expect(sleeps).toEqual([2000]); // Retry-After: 2s honored
  });

  it('retries 5xx with jittered exponential backoff', async () => {
    const { fetch, calls } = scriptedFetch([
      jsonResponse(503, { error: { code: 'provider_unavailable' } }),
      jsonResponse(200, { ok: true }),
    ]);
    const { clock, sleeps } = fakeClock();
    await executeRequest({ fetch, clock }, req());
    expect(calls.length).toBe(2);
    // attempt 0: min(8000, 500*2^0)=500; jitter 0.5 → floor(500 * 0.75) = 375
    expect(sleeps).toEqual([375]);
  });

  it('applies one stable auto idempotency-key across all retries (POST)', async () => {
    const { fetch, calls } = scriptedFetch([
      jsonResponse(500, { error: {} }),
      jsonResponse(500, { error: {} }),
      jsonResponse(200, { ok: true }),
    ]);
    const { clock } = fakeClock();
    await executeRequest({ fetch, clock }, req());
    expect(calls.length).toBe(3);
    const keys = calls.map((c) => (c.headers as Record<string, string>)['idempotency-key']);
    expect(keys[0]).toBeDefined();
    expect(new Set(keys).size).toBe(1); // identical across every retry
  });

  it('honors an explicit idempotency key over the auto key', async () => {
    const { fetch, calls } = scriptedFetch([jsonResponse(200, { ok: true })]);
    const { clock } = fakeClock();
    await executeRequest({ fetch, clock }, req({ idempotencyKey: 'my-key' }));
    expect((calls[0]?.headers as Record<string, string>)['idempotency-key']).toBe('my-key');
  });

  it('does NOT retry a non-retryable 400', async () => {
    const { fetch, calls } = scriptedFetch([
      jsonResponse(400, {
        error: { code: 'invalid_request', message: 'bad', request_id: 'req_1' },
      }),
    ]);
    const { clock } = fakeClock();
    await expect(executeRequest({ fetch, clock }, req())).rejects.toMatchObject({
      code: 'invalid_request',
      status: 400,
      requestId: 'req_1',
      retryable: false,
    });
    expect(calls.length).toBe(1);
  });

  it('throws the last error after exhausting maxRetries', async () => {
    const { fetch, calls } = scriptedFetch([jsonResponse(503, { error: { code: 'x' } })]);
    const { clock } = fakeClock();
    await expect(executeRequest({ fetch, clock }, req({ maxRetries: 2 }))).rejects.toBeInstanceOf(
      UltraRouterError,
    );
    expect(calls.length).toBe(3); // initial + 2 retries
  });

  it('does NOT retry a 5xx whose error body says retryable:false (the explicit flag wins over the status)', async () => {
    const { fetch, calls } = scriptedFetch([
      jsonResponse(503, {
        error: { code: 'upstream_maintenance', message: 'down', retryable: false },
      }),
      jsonResponse(200, { ok: true }),
    ]);
    const { clock, sleeps } = fakeClock();
    await expect(executeRequest({ fetch, clock }, req({ maxRetries: 3 }))).rejects.toMatchObject({
      code: 'upstream_maintenance',
      status: 503,
      retryable: false,
    });
    expect(calls.length).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it('retries a plain 5xx that carries no retryable flag (and no error body at all)', async () => {
    const { fetch, calls } = scriptedFetch([
      jsonResponse(503, { error: { code: 'upstream_maintenance', message: 'down' } }),
      new Response('Service Unavailable', { status: 502 }),
      jsonResponse(200, { ok: true }),
    ]);
    const { clock } = fakeClock();
    const res = await executeRequest({ fetch, clock }, req({ maxRetries: 3 }));
    expect(res.response.status).toBe(200);
    expect(calls.length).toBe(3);
  });

  it('retries a streaming request only on a retryable response (the stream never opened), with no idempotency-key', async () => {
    const { fetch, calls } = scriptedFetch([
      jsonResponse(503, { error: { code: 'provider_unavailable', retryable: true } }),
      new Response('data: [DONE]\n\n', {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    ]);
    const { clock } = fakeClock();
    const res = await executeRequest({ fetch, clock }, req({ stream: true }));
    expect(res.response.status).toBe(200);
    expect(calls.length).toBe(2);
    for (const call of calls)
      expect((call.headers as Record<string, string>)['idempotency-key']).toBeUndefined();
  });

  it('never retries a streaming request after a transport failure (it may have reached the gateway)', async () => {
    let n = 0;
    const fetch = async (): Promise<Response> => {
      n += 1;
      throw new Error('ECONNRESET');
    };
    const { clock } = fakeClock();
    await expect(executeRequest({ fetch, clock }, req({ stream: true }))).rejects.toMatchObject({
      code: 'connection',
    });
    expect(n).toBe(1);
  });

  it('never retries a streaming request on a non-retryable response', async () => {
    const { fetch, calls } = scriptedFetch([
      jsonResponse(400, { error: { code: 'invalid_request' } }),
    ]);
    const { clock } = fakeClock();
    await expect(executeRequest({ fetch, clock }, req({ stream: true }))).rejects.toMatchObject({
      code: 'invalid_request',
    });
    expect(calls.length).toBe(1);
  });

  it('retries a transport error, then surfaces it if it never resolves', async () => {
    let n = 0;
    const fetch = async (): Promise<Response> => {
      n += 1;
      throw new Error('ECONNRESET');
    };
    const { clock } = fakeClock();
    await expect(executeRequest({ fetch, clock }, req({ maxRetries: 1 }))).rejects.toMatchObject({
      code: 'connection',
      retryable: true,
    });
    expect(n).toBe(2);
  });

  it('a passed deadline is a non-retryable timeout error (distinct from a caller abort)', async () => {
    const fetch = (_url: string | URL, init?: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted by deadline')));
      });
    const clock: RetryClock = { now: () => 0, sleep: async () => undefined, random: () => 0.5 };
    await expect(
      executeRequest({ fetch, clock }, req({ timeoutMs: 20, maxRetries: 3 })),
    ).rejects.toMatchObject({
      code: 'timeout',
      retryable: false,
    });
  });

  it('does not retry when the caller AbortSignal is already aborted', async () => {
    const { fetch, calls } = scriptedFetch([jsonResponse(200, { ok: true })]);
    const { clock } = fakeClock();
    const controller = new AbortController();
    controller.abort();
    await expect(
      executeRequest({ fetch, clock }, req({ signal: controller.signal })),
    ).rejects.toMatchObject({ code: 'aborted', retryable: false });
    expect(calls.length).toBe(1);
  });
});
