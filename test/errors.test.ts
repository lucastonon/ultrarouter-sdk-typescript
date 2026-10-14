// The error taxonomy: typed `model_unpriced`, taxonomy-driven retryability, and the helpers.
import { describe, expect, it } from 'vitest';

import { UltraRouter } from '../src/client.js';
import {
  GATEWAY_ERROR_CODES,
  GATEWAY_ERROR_TAXONOMY,
  ModelUnpricedError,
  UltraRouterError,
  errorFromResponse,
  isGatewayErrorCode,
  isRetryableStatus,
  isUltraRouterError,
  parseGatewayErrorEnvelope,
} from '../src/errors.js';
import type { FetchLike } from '../src/types.js';

/** A fetch that always answers with the given status + gateway error envelope; counts calls. */
function failing(
  status: number,
  code: string,
  retryable: boolean,
): { fetch: FetchLike; calls: () => number } {
  let n = 0;
  const fetch: FetchLike = async () => {
    n += 1;
    return new Response(
      JSON.stringify({
        error: { code, message: `${code} happened`, request_id: 'req_err_1', retryable },
      }),
      { status, headers: { 'content-type': 'application/json' } },
    );
  };
  return { fetch, calls: () => n };
}

/** A client whose retries never actually wait: maxRetries 3, the default backoff clock is real but tiny for 5xx. */
function client(fetch: FetchLike, maxRetries = 3): UltraRouter {
  return new UltraRouter({
    apiKey: 'ur_sk_test_unit',
    baseURL: 'https://gw.test',
    fetch,
    maxRetries,
  });
}

const CHAT = {
  model: 'example/unpriced-model',
  messages: [{ role: 'user' as const, content: 'hi' }],
};

describe('model_unpriced', () => {
  it('is a stable gateway code with status 403 and never retryable', () => {
    expect(GATEWAY_ERROR_CODES).toContain('model_unpriced');
    expect(isGatewayErrorCode('model_unpriced')).toBe(true);
    expect(GATEWAY_ERROR_TAXONOMY.model_unpriced).toEqual({ status: 403, retryable: false });
  });

  it('surfaces as a typed ModelUnpricedError (and an UltraRouterError)', async () => {
    const f = failing(403, 'model_unpriced', false);
    const err = await client(f.fetch)
      .chat.completions.create(CHAT)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelUnpricedError);
    expect(err).toBeInstanceOf(UltraRouterError);
    expect(err).toMatchObject({
      name: 'ModelUnpricedError',
      code: 'model_unpriced',
      status: 403,
      retryable: false,
      requestId: 'req_err_1',
    });
  });

  it('is never retried — exactly one request even with maxRetries 3', async () => {
    const f = failing(403, 'model_unpriced', false);
    await client(f.fetch)
      .chat.completions.create(CHAT)
      .catch(() => undefined);
    expect(f.calls()).toBe(1);
  });

  it('is never retried even if an envelope or proxy claims it is retryable or a 5xx', async () => {
    const f = failing(503, 'model_unpriced', true);
    const err = await client(f.fetch)
      .chat.completions.create(CHAT)
      .catch((e: unknown) => e);
    expect(f.calls()).toBe(1);
    expect(err).toBeInstanceOf(ModelUnpricedError);
    expect((err as ModelUnpricedError).retryable).toBe(false);
  });

  it('maps a mid-stream error event to ModelUnpricedError too', async () => {
    const sse =
      'event: error\ndata: {"error":{"code":"model_unpriced","message":"no price","request_id":"req_s","retryable":false}}\n\n';
    const fetch: FetchLike = async () =>
      new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    const stream = await client(fetch).chat.completions.create({ ...CHAT, stream: true });
    const err = await (async () => {
      for await (const _chunk of stream) {
        // drain
      }
    })().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelUnpricedError);
  });
});

describe('taxonomy-driven retries', () => {
  it('retries a retryable code (provider_unavailable 502) up to maxRetries', async () => {
    const f = failing(502, 'provider_unavailable', true);
    const err = await client(f.fetch, 1)
      .chat.completions.create(CHAT)
      .catch((e: unknown) => e);
    expect(f.calls()).toBe(2);
    expect(err).toMatchObject({ code: 'provider_unavailable', retryable: true });
  });

  it('does not retry a non-retryable code even on a 5xx status (atomic_spend_guard_unavailable 503)', async () => {
    const f = failing(503, 'atomic_spend_guard_unavailable', false);
    await client(f.fetch)
      .chat.completions.create(CHAT)
      .catch(() => undefined);
    expect(f.calls()).toBe(1);
  });

  it('does not retry a retryable code when the envelope says retryable:false', async () => {
    const f = failing(429, 'rate_limited', false);
    await client(f.fetch)
      .chat.completions.create(CHAT)
      .catch(() => undefined);
    expect(f.calls()).toBe(1);
  });

  it('falls back to the status class for a non-gateway response (a proxy 503 with no envelope)', () => {
    const err = errorFromResponse(503, { error: { message: 'upstream connect error' } });
    expect(err.code).toBe('http_503');
    expect(err.retryable).toBe(true);
    expect(errorFromResponse(400, {}).retryable).toBe(false);
  });

  it('every taxonomy entry agrees with its retryability rule', () => {
    for (const code of GATEWAY_ERROR_CODES) {
      const { status, retryable } = GATEWAY_ERROR_TAXONOMY[code];
      const err = errorFromResponse(status, { error: { code, message: 'x', retryable } });
      expect(err.retryable).toBe(retryable);
      expect(err.code).toBe(code);
    }
  });
});

describe('helpers', () => {
  it('isUltraRouterError narrows, optionally by code', () => {
    const err = errorFromResponse(429, {
      error: { code: 'rate_limited', message: 'slow', retryable: true },
    });
    expect(isUltraRouterError(err)).toBe(true);
    expect(isUltraRouterError(err, 'rate_limited')).toBe(true);
    expect(isUltraRouterError(err, 'not_found')).toBe(false);
    expect(isUltraRouterError(new Error('x'))).toBe(false);
  });

  it('isRetryableStatus covers 408, 429 and 5xx only', () => {
    expect([408, 429, 500, 502, 599].every(isRetryableStatus)).toBe(true);
    expect([200, 304, 400, 401, 403, 404, 409].some(isRetryableStatus)).toBe(false);
  });

  it('the code list includes every code the gateway documents', () => {
    expect(GATEWAY_ERROR_CODES).toEqual(
      expect.arrayContaining([
        'invalid_request',
        'manifest_invalid',
        'manifest_mismatch',
        'authentication',
        'permission',
        'not_found',
        'model_denied_by_policy',
        'model_unpriced',
        'capability_unsupported',
        'prompt_variables_missing',
        'conflict',
        'rate_limited',
        'spend_cap_exceeded',
        'max_cost_exceeded',
        'atomic_spend_guard_unavailable',
        'provider_unavailable',
        'provider_timeout',
        'content_filtered',
        'context_length',
        'cancelled',
        'internal',
      ]),
    );
    expect(GATEWAY_ERROR_CODES).toHaveLength(21);
  });
});

describe('the validated gateway envelope (`UltraRouterError.envelope`)', () => {
  const wellFormed = {
    error: { code: 'invalid_request', message: 'bad', request_id: 'req_1', retryable: false },
  };

  it('is set only for a well-formed { error: { code, message, request_id, retryable } } body', () => {
    expect(errorFromResponse(400, wellFormed).envelope).toEqual(wellFormed.error);
    expect(
      errorFromResponse(502, {
        error: { ...wellFormed.error, code: 'provider_unavailable', provider_code: 'x' },
      }).envelope?.provider_code,
    ).toBe('x');
  });

  it.each([
    ['an HTML body (wrapped as a message)', { error: { message: '<html>400</html>' } }],
    ['an empty body', {}],
    [
      'a missing request_id',
      { error: { code: 'invalid_request', message: 'm', retryable: false } },
    ],
    ['a missing retryable', { error: { code: 'invalid_request', message: 'm', request_id: 'r' } }],
    ['a non-string code', { error: { code: 4, message: 'm', request_id: 'r', retryable: false } }],
    ['an empty code', { error: { code: '', message: 'm', request_id: 'r', retryable: false } }],
    ['a string retryable', { error: { ...wellFormed.error, retryable: 'false' } }],
    ['a non-string provider_code', { error: { ...wellFormed.error, provider_code: 1 } }],
    ['an array', [wellFormed]],
    ['a string error', { error: 'bad' }],
    ['null', null],
  ])('is undefined for %s', (_name, body) => {
    expect(parseGatewayErrorEnvelope(body)).toBeUndefined();
    expect(errorFromResponse(400, body).envelope).toBeUndefined();
  });

  it('reads only fields of the declared type: a non-string code becomes http_<status>', () => {
    const err = errorFromResponse(400, { error: { code: 4, message: 7, retryable: 'yes' } });
    expect(err.code).toBe('http_400');
    expect(err.message).toBe('request failed with status 400');
    expect(err.retryable).toBe(false);
  });

  it('ModelUnpricedError keeps its envelope too', () => {
    const err = errorFromResponse(403, {
      error: { code: 'model_unpriced', message: 'm', request_id: 'r', retryable: false },
    });
    expect(err).toBeInstanceOf(ModelUnpricedError);
    expect(err.envelope?.code).toBe('model_unpriced');
  });

  it('a transport error never has one', async () => {
    const err = await client(async () => {
      throw new TypeError('fetch failed');
    })
      .chat.completions.create(CHAT)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UltraRouterError);
    expect((err as UltraRouterError).envelope).toBeUndefined();
  });
});
