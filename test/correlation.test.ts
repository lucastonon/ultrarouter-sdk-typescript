// Request and episode correlation: the `x-ur-request-id` / `x-ur-artifact` headers the client sends,
// the `requestId` it exposes on chat (streaming and not), embeddings and the official `openai`
// client path, and client-side minting.
import OpenAI from 'openai';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { UltraRouter } from '../src/client.js';
import {
  EPISODE_HEADER,
  REQUEST_ID_HEADER,
  correlationHeaders,
  isValidRequestId,
  mintEpisodeKey,
  mintRequestId,
  readRequestId,
} from '../src/correlation.js';
import { UltraRouterError } from '../src/errors.js';
import type { FetchLike } from '../src/types.js';
// @ts-expect-error -- plain ESM test helper without type declarations
import { startMockGateway } from './support/mock-gateway.mjs';

interface Gateway {
  url: string;
  requests: { method: string; path: string; headers: Record<string, string>; body: unknown }[];
  close: () => Promise<void>;
}

let gw: Gateway;
beforeAll(async () => {
  gw = (await startMockGateway()) as Gateway;
});
afterAll(async () => {
  await gw.close();
});

const lastChat = () => gw.requests.filter((r) => r.path === '/v1/chat/completions').at(-1)!;
const MESSAGES = [{ role: 'user' as const, content: 'hello' }];

function client(extra: ConstructorParameters<typeof UltraRouter>[0] = {}): UltraRouter {
  return new UltraRouter({
    apiKey: 'ur_sk_test_corr',
    baseURL: gw.url,
    defaultModel: 'openai/gpt-5.2-mini',
    maxRetries: 0,
    ...extra,
  });
}

describe('request ids', () => {
  it('mintRequestId is a valid, client-prefixed, unique id', () => {
    const a = mintRequestId();
    const b = mintRequestId();
    expect(a).toMatch(/^req_c_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(isValidRequestId(a)).toBe(true);
    expect(a).not.toBe(b);
    expect(mintEpisodeKey()).toMatch(/^ep_[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('isValidRequestId accepts 1-64 of [A-Za-z0-9_-] only', () => {
    expect(isValidRequestId('a')).toBe(true);
    expect(isValidRequestId('x'.repeat(64))).toBe(true);
    expect(isValidRequestId('x'.repeat(65))).toBe(false);
    expect(isValidRequestId('')).toBe(false);
    for (const bad of ['a b', 'a/b', 'a.b', 'é', 'a\nb']) expect(isValidRequestId(bad)).toBe(false);
    expect(isValidRequestId(42)).toBe(false);
  });

  it('a non-streaming chat exposes the echoed gateway id as a non-enumerable requestId', async () => {
    const res = await client().chat.completions.create({ messages: MESSAGES });
    expect(res.requestId).toMatch(/^req_mock_/);
    expect(res.requestId).toBe(res.ur.request_id);
    expect(Object.keys(res)).not.toContain('requestId');
    expect(JSON.stringify(res)).not.toContain('"requestId"');
    expect(lastChat().headers[REQUEST_ID_HEADER]).toBeUndefined();
  });

  it('a caller-chosen requestId is sent and echoed', async () => {
    const id = mintRequestId();
    const res = await client().chat.completions.create({ messages: MESSAGES }, { requestId: id });
    expect(lastChat().headers[REQUEST_ID_HEADER]).toBe(id);
    expect(res.requestId).toBe(id);
    expect(res.ur.request_id).toBe(id);
  });

  it("requestIds: 'client' mints an id for every inference call that has none", async () => {
    const ur = client({ requestIds: 'client' });
    const a = await ur.chat.completions.create({ messages: MESSAGES });
    const sentA = lastChat().headers[REQUEST_ID_HEADER];
    expect(sentA).toMatch(/^req_c_/);
    expect(a.requestId).toBe(sentA);
    const b = await ur.chat.completions.create({ messages: MESSAGES });
    expect(b.requestId).not.toBe(a.requestId);
    // An explicit id still wins.
    const c = await ur.chat.completions.create({ messages: MESSAGES }, { requestId: 'mine_1' });
    expect(c.requestId).toBe('mine_1');
    // Management calls are not given an id.
    await ur.models.list();
    expect(gw.requests.at(-1)!.headers[REQUEST_ID_HEADER]).toBeUndefined();
  });

  it('the same minted id rides every retry of one call', async () => {
    const seen: string[] = [];
    let calls = 0;
    const fetch: FetchLike = async (_url, init) => {
      calls += 1;
      seen.push((init?.headers as Record<string, string>)[REQUEST_ID_HEADER] ?? '');
      if (calls === 1) {
        return Response.json(
          { error: { code: 'rate_limited', message: 'slow', request_id: 'r', retryable: true } },
          { status: 429, headers: { 'retry-after': '0' } },
        );
      }
      return Response.json(
        {
          id: 'c',
          object: 'chat.completion',
          created: 0,
          model: 'm',
          choices: [],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          ur: { request_id: 'ignored_body_id' },
        },
        { headers: { [REQUEST_ID_HEADER]: seen[0] ?? '' } },
      );
    };
    const ur = new UltraRouter({
      apiKey: 'k',
      baseURL: 'http://gw',
      fetch,
      maxRetries: 2,
      requestIds: 'client',
    });
    const res = await ur.chat.completions.create({ model: 'm', messages: MESSAGES });
    expect(calls).toBe(2);
    expect(seen[0]).toMatch(/^req_c_/);
    expect(seen[1]).toBe(seen[0]);
    expect(res.requestId).toBe(seen[0]);
  });

  it('falls back to the body ur.request_id, then to the sent id, when no header is echoed', async () => {
    const body = (rid: string | undefined) => ({
      id: 'c',
      object: 'chat.completion',
      created: 0,
      model: 'm',
      choices: [],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      ur: rid === undefined ? {} : { request_id: rid },
    });
    const fromBody = new UltraRouter({
      apiKey: 'k',
      baseURL: 'http://gw',
      fetch: async () => Response.json(body('req_body')),
    });
    expect(
      (await fromBody.chat.completions.create({ model: 'm', messages: MESSAGES })).requestId,
    ).toBe('req_body');
    const fromSent = new UltraRouter({
      apiKey: 'k',
      baseURL: 'http://gw',
      fetch: async () => Response.json(body(undefined)),
    });
    const res = await fromSent.chat.completions.create(
      { model: 'm', messages: MESSAGES },
      { requestId: 'sent_1' },
    );
    expect(res.requestId).toBe('sent_1');
  });

  it('a malformed requestId is refused before anything is sent', async () => {
    let calls = 0;
    const ur = new UltraRouter({
      apiKey: 'k',
      baseURL: 'http://gw',
      fetch: async () => {
        calls += 1;
        return Response.json({});
      },
    });
    for (const bad of ['has space', 'x'.repeat(65), '']) {
      await expect(
        ur.chat.completions.create({ model: 'm', messages: MESSAGES }, { requestId: bad }),
      ).rejects.toMatchObject({ code: 'invalid_request', status: 0 });
    }
    expect(calls).toBe(0);
  });

  it('the gateway refuses a malformed id it receives (mock parity)', async () => {
    const res = await fetch(`${gw.url}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ur_sk_test_x',
        'content-type': 'application/json',
        [REQUEST_ID_HEADER]: 'bad id!',
      },
      body: JSON.stringify({ model: 'openai/gpt-5.2-mini', messages: MESSAGES }),
    });
    expect(res.status).toBe(400);
  });
});

describe('streaming', () => {
  it('exposes requestId as soon as the stream opens (before the first chunk)', async () => {
    const id = mintRequestId();
    const stream = await client().chat.completions.create(
      { stream: true, messages: MESSAGES },
      { requestId: id, episodeKey: 'ep-stream-1' },
    );
    expect(stream.requestId).toBe(id);
    expect(lastChat().headers[REQUEST_ID_HEADER]).toBe(id);
    expect(lastChat().headers[EPISODE_HEADER]).toBe('ep-stream-1');
    let finalId: string | undefined;
    for await (const chunk of stream) if (chunk.ur !== undefined) finalId = chunk.ur.request_id;
    expect(finalId).toBe(id);
  });

  it('carries the gateway-minted id from the header when none was sent', async () => {
    const stream = await client().chat.completions.create({ stream: true, messages: MESSAGES });
    expect(stream.requestId).toMatch(/^req_mock_/);
    let finalId: string | undefined;
    for await (const chunk of stream) if (chunk.ur !== undefined) finalId = chunk.ur.request_id;
    expect(finalId).toBe(stream.requestId);
  });

  it('is null only when there is neither a header nor a sent id', async () => {
    const sse =
      'data: {"id":"c","object":"chat.completion.chunk","created":0,"model":"m","choices":[]}\n\ndata: [DONE]\n\n';
    const ur = new UltraRouter({
      apiKey: 'k',
      baseURL: 'http://gw',
      fetch: async () => new Response(sse, { headers: { 'content-type': 'text/event-stream' } }),
    });
    const stream = await ur.chat.completions.create({
      model: 'm',
      stream: true,
      messages: MESSAGES,
    });
    expect(stream.requestId).toBeNull();
    for await (const chunk of stream) void chunk;
  });
});

describe('episodes', () => {
  it('episodeKey rides x-ur-artifact and binds the request to the episode artifact', async () => {
    const res = await client().chat.completions.create(
      { messages: MESSAGES },
      { episodeKey: 'ticket-4821' },
    );
    expect(lastChat().headers[EPISODE_HEADER]).toBe('ticket-4821');
    expect(res.ur.artifact_id).toMatch(/^art_/);
  });

  it('two steps of one episode share the key; a concurrent task gets its own', async () => {
    const ur = client();
    const a = mintEpisodeKey();
    const b = mintEpisodeKey();
    const [r1, r2, r3] = await Promise.all([
      ur.chat.completions.create({ messages: MESSAGES }, { episodeKey: a }),
      ur.chat.completions.create({ messages: MESSAGES }, { episodeKey: a }),
      ur.chat.completions.create({ messages: MESSAGES }, { episodeKey: b }),
    ]);
    expect(r1.ur.artifact_id).toBe(r2.ur.artifact_id);
    expect(r3.ur.artifact_id).not.toBe(r1.ur.artifact_id);
    expect(new Set([r1.requestId, r2.requestId, r3.requestId]).size).toBe(3);
  });

  it('refuses an episode key that cannot travel as a header', async () => {
    const ur = client();
    for (const bad of ['', ' padded', 'tab\there', 'é', 'x'.repeat(257)]) {
      await expect(
        ur.chat.completions.create({ messages: MESSAGES }, { episodeKey: bad }),
      ).rejects.toBeInstanceOf(UltraRouterError);
    }
    expect(correlationHeaders({ episodeKey: 'x'.repeat(256) })[EPISODE_HEADER]).toHaveLength(256);
  });
});

describe('embeddings', () => {
  it('exposes requestId and sends a chosen one', async () => {
    const res = await client().embeddings.create(
      { model: 'openai/text-embedding-3-small', input: 'a' },
      { requestId: 'emb_1' },
    );
    expect(res.requestId).toBe('emb_1');
    expect(gw.requests.at(-1)!.headers[REQUEST_ID_HEADER]).toBe('emb_1');
    const minted = await client({ requestIds: 'client' }).embeddings.create({
      model: 'openai/text-embedding-3-small',
      input: 'b',
    });
    expect(minted.requestId).toMatch(/^req_c_/);
  });
});

describe('correlationHeaders and readRequestId', () => {
  it('builds validated headers', () => {
    expect(correlationHeaders({})).toEqual({});
    expect(correlationHeaders({ requestId: 'r_1', episodeKey: 'ep 1' })).toEqual({
      [REQUEST_ID_HEADER]: 'r_1',
      [EPISODE_HEADER]: 'ep 1',
    });
    expect(() => correlationHeaders({ requestId: 'no spaces' })).toThrow(UltraRouterError);
  });

  it('reads the id from results, bodies, responses, Headers and header records', () => {
    const headers = new Headers({ [REQUEST_ID_HEADER]: 'req_h' });
    expect(readRequestId(headers)).toBe('req_h');
    expect(readRequestId(new Response('', { headers }))).toBe('req_h');
    expect(readRequestId({ headers: { 'X-UR-Request-Id': 'req_rec' } })).toBe('req_rec');
    expect(readRequestId({ headers: { 'x-ur-request-id': ['req_arr'] } })).toBe('req_arr');
    expect(readRequestId({ ur: { request_id: 'req_body' } })).toBe('req_body');
    expect(readRequestId({ requestId: 'req_own', ur: { request_id: 'other' } })).toBe('req_own');
    expect(readRequestId({ 'x-ur-request-id': 'req_flat' })).toBe('req_flat');
    for (const none of [null, undefined, 'str', 1, {}, { ur: {} }, { headers: new Headers() }]) {
      expect(readRequestId(none)).toBeNull();
    }
  });
});

describe('the official openai client path', () => {
  it('per-call correlation headers + readRequestId on the body and the raw response', async () => {
    const openai = client().asOpenAI(OpenAI);
    const id = mintRequestId();
    const { data, response } = await openai.chat.completions
      .create(
        { model: 'openai/gpt-5.2-mini', messages: MESSAGES },
        { headers: correlationHeaders({ requestId: id, episodeKey: 'ep-openai' }) },
      )
      .withResponse();
    expect(lastChat().headers[REQUEST_ID_HEADER]).toBe(id);
    expect(lastChat().headers[EPISODE_HEADER]).toBe('ep-openai');
    expect(readRequestId(response)).toBe(id);
    expect(readRequestId(data)).toBe(id);
  });

  it('streaming through the openai client: the id is on the response before the first chunk', async () => {
    const openai = client().asOpenAI(OpenAI);
    const id = mintRequestId();
    const { data: stream, response } = await openai.chat.completions
      .create(
        { model: 'openai/gpt-5.2-mini', stream: true, messages: MESSAGES },
        { headers: correlationHeaders({ requestId: id }) },
      )
      .withResponse();
    expect(readRequestId(response)).toBe(id);
    let text = '';
    for await (const chunk of stream) text += chunk.choices[0]?.delta.content ?? '';
    expect(text).toContain('hello');
  });
});
