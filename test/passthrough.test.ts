// The native passthrough operations — createResponse (POST /v1/responses, the OpenAI Responses API)
// and createMessage (POST /v1/messages, the Anthropic Messages API) — are opaque passthrough
// surfaces with no dedicated method. This proves the SDK reaches both through `ur.request()`: the
// JSON body round-trips verbatim to the gateway, the realistic response shape comes back, the two
// X-UR-* response headers (request id + booked cost) are present, and the ur extension request
// headers (X-UR-Call-Type, X-UR-Trace, X-UR-Timeout-Ms) pass through `ur.request`'s header option.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { UltraRouter } from '../src/client.js';
import type { FetchLike } from '../src/types.js';
// @ts-expect-error -- plain ESM test helper without type declarations
import { startMockGateway } from './support/mock-gateway.mjs';

interface Gateway {
  url: string;
  close: () => Promise<void>;
}

/** One request the client made, captured verbatim, plus the Response the gateway returned. */
interface Seen {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  response: Response;
}

/** A fetch that forwards to the real mock gateway and records the request init and the Response. */
function instrument(): { fetch: FetchLike; calls: Seen[] } {
  const calls: Seen[] = [];
  const fetch: FetchLike = async (url, init) => {
    const response = await globalThis.fetch(url, init);
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      headers: (init?.headers as Record<string, string> | undefined) ?? {},
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      response,
    });
    return response;
  };
  return { fetch, calls };
}

const KEY = 'ur_sk_test_passthrough';
let gw: Gateway;

beforeAll(async () => {
  gw = (await startMockGateway()) as Gateway;
});
afterAll(async () => {
  await gw.close();
});

function client(fetch: FetchLike): UltraRouter {
  return new UltraRouter({ apiKey: KEY, baseURL: gw.url, fetch, maxRetries: 0 });
}

/** The ur extension request headers a caller tags a passthrough call with. */
const TRACE = JSON.stringify({ run: 'run_1', case: 'case_1', stage: 'draft', attempt: 1 });
const EXT_HEADERS = {
  'X-UR-Call-Type': 'drafting',
  'X-UR-Trace': TRACE,
  'X-UR-Timeout-Ms': '30000',
};

function last(calls: Seen[]): Seen {
  const c = calls.at(-1);
  if (c === undefined) throw new Error('no request captured');
  return c;
}

describe('native passthrough: createResponse (POST /v1/responses) + createMessage (POST /v1/messages)', () => {
  it('createResponse: body round-trips, the OpenAI Responses shape returns, X-UR-* headers come back', async () => {
    const { fetch, calls } = instrument();
    const body = {
      model: 'openai/gpt-5.2-mini',
      input: 'Give me one word for "fast".',
      metadata: { stage: 'draft' },
    };
    const res = (await client(fetch).request('post', '/v1/responses', {
      body: body as never,
      headers: EXT_HEADERS,
    })) as unknown as {
      object: string;
      model: string;
      status: string;
      output: { type: string; role: string; content: { type: string; text: string }[] }[];
      usage: { input_tokens: number; output_tokens: number; total_tokens: number };
    };

    // A realistic, non-streaming OpenAI Responses object with `output` items and `usage`.
    expect(res.object).toBe('response');
    expect(res.status).toBe('completed');
    expect(res.model).toBe('openai/gpt-5.2-mini'); // the exact model called, echoed back
    expect(res.output[0]?.type).toBe('message');
    expect(res.output[0]?.role).toBe('assistant');
    expect(res.output[0]?.content[0]?.type).toBe('output_text');
    expect(typeof res.output[0]?.content[0]?.text).toBe('string');
    expect(res.usage.total_tokens).toBe(res.usage.input_tokens + res.usage.output_tokens);

    const sent = last(calls);
    expect(sent.method).toBe('POST');
    expect(sent.url).toBe(`${gw.url}/v1/responses`);
    // The body is forwarded unchanged (round-trips verbatim through `ur.request`).
    expect(sent.body).toEqual(body);
    // The ur extension request headers pass through the header option, byte-for-byte.
    expect(sent.headers['X-UR-Call-Type']).toBe('drafting');
    expect(sent.headers['X-UR-Trace']).toBe(TRACE);
    expect(sent.headers['X-UR-Timeout-Ms']).toBe('30000');
    // The two X-UR-* response headers come back: the request id and the booked cost (micro-USD).
    expect(sent.response.headers.get('x-ur-request-id')).toMatch(/^req_mock_/);
    expect(Number(sent.response.headers.get('x-ur-cost-micro-usd'))).toBeGreaterThan(0);
  });

  it('createMessage: body round-trips, the Anthropic Messages shape returns, X-UR-* headers come back', async () => {
    const { fetch, calls } = instrument();
    const body = {
      model: 'anthropic/claude-sonnet-4.6',
      max_tokens: 64,
      system: 'Answer in one word.',
      messages: [{ role: 'user', content: 'A synonym for "fast"?' }],
    };
    const res = (await client(fetch).request('post', '/v1/messages', {
      body: body as never,
      headers: EXT_HEADERS,
    })) as unknown as {
      type: string;
      role: string;
      model: string;
      content: { type: string; text: string }[];
      stop_reason: string;
      usage: { input_tokens: number; output_tokens: number };
    };

    // A realistic, non-streaming Anthropic Message with `content`, `stop_reason` and `usage`.
    expect(res.type).toBe('message');
    expect(res.role).toBe('assistant');
    expect(res.model).toBe('anthropic/claude-sonnet-4.6'); // the exact model called, echoed back
    expect(res.content[0]?.type).toBe('text');
    expect(typeof res.content[0]?.text).toBe('string');
    expect(res.stop_reason).toBe('end_turn');
    expect(res.usage.input_tokens).toBeGreaterThan(0);
    expect(res.usage.output_tokens).toBeGreaterThan(0);

    const sent = last(calls);
    expect(sent.method).toBe('POST');
    expect(sent.url).toBe(`${gw.url}/v1/messages`);
    // The body is forwarded unchanged (round-trips verbatim through `ur.request`).
    expect(sent.body).toEqual(body);
    // The ur extension request headers pass through the header option, byte-for-byte.
    expect(sent.headers['X-UR-Call-Type']).toBe('drafting');
    expect(sent.headers['X-UR-Trace']).toBe(TRACE);
    expect(sent.headers['X-UR-Timeout-Ms']).toBe('30000');
    // The two X-UR-* response headers come back: the request id and the booked cost (micro-USD).
    expect(sent.response.headers.get('x-ur-request-id')).toMatch(/^req_mock_/);
    expect(Number(sent.response.headers.get('x-ur-cost-micro-usd'))).toBeGreaterThan(0);
  });
});
