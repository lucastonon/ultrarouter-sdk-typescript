// — client surface: request shaping, method surface, asOpenAI (11/12).
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UltraRouter } from '../src/client.js';
import { UltraRouterError } from '../src/errors.js';
import type { FetchLike } from '../src/types.js';

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A fetch that records the request and returns a canned JSON response. */
function recordingFetch(
  response: unknown,
  status = 200,
): { fetch: FetchLike; last: () => Captured } {
  let captured: Captured | undefined;
  const fetch: FetchLike = async (url, init) => {
    captured = {
      url: String(url),
      method: init?.method ?? 'GET',
      headers: (init?.headers as Record<string, string>) ?? {},
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    };
    return new Response(JSON.stringify(response), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  };
  return {
    fetch,
    last: () => {
      if (captured === undefined) throw new Error('no request captured');
      return captured;
    },
  };
}

const CHAT_RESPONSE = {
  id: 'chatcmpl-1',
  object: 'chat.completion',
  created: 1,
  model: 'openai/gpt-5.2-mini',
  choices: [{ index: 0, message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  ur: {
    request_id: 'req_1',
    call_type: null,
    model_served: 'openai/gpt-5.2-mini',
    provider: 'openai',
    routing: { mode: 'off', fallback_used: false },
    compression: { applied: 'off' },
    cost_usd: 0.0001,
    byok: false,
  },
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('UltraRouter — construction', () => {
  it('throws a clear error when no API key is available', () => {
    vi.stubEnv('ULTRAROUTER_API_KEY', '');
    vi.stubEnv('UR_API_KEY', '');
    expect(() => new UltraRouter()).toThrow(UltraRouterError);
  });

  it('throws a configuration error naming baseURL and both env vars when no base URL is set', () => {
    vi.stubEnv('ULTRAROUTER_BASE_URL', '');
    vi.stubEnv('UR_BASE_URL', '');
    let thrown: unknown;
    try {
      new UltraRouter({ apiKey: 'ur_sk_test_env' });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(UltraRouterError);
    const e = thrown as UltraRouterError;
    expect(e.code).toBe('configuration');
    expect(e.message).toContain('baseURL');
    expect(e.message).toContain('ULTRAROUTER_BASE_URL');
    expect(e.message).toContain('UR_BASE_URL');
    expect(e.message).toContain('http://localhost:8080');
  });

  it('reads the API key from ULTRAROUTER_API_KEY', async () => {
    vi.stubEnv('ULTRAROUTER_API_KEY', 'ur_sk_test_env');
    const { fetch, last } = recordingFetch(CHAT_RESPONSE);
    const ur = new UltraRouter({ baseURL: 'http://gw', fetch });
    await ur.chat.completions.create({ model: 'm', messages: [{ role: 'user', content: 'hi' }] });
    expect(last().headers['authorization']).toBe('Bearer ur_sk_test_env');
  });
});

describe('UltraRouter — method surface mirrors openai v5', () => {
  it('chat.completions.create posts to /v1/chat/completions with defaults applied', async () => {
    const { fetch, last } = recordingFetch(CHAT_RESPONSE);
    const ur = new UltraRouter({
      apiKey: 'ur_sk_test_1',
      baseURL: 'http://localhost:8080',
      defaultModel: 'openai/gpt-5.2-mini',
      defaults: { compression: 'lossless' },
      fetch,
    });
    const res = await ur.chat.completions.create({ messages: [{ role: 'user', content: 'hi' }] });
    const req = last();
    expect(req.url).toBe('http://localhost:8080/v1/chat/completions');
    expect(req.method).toBe('POST');
    expect(req.headers['authorization']).toBe('Bearer ur_sk_test_1');
    expect((req.body as { model: string }).model).toBe('openai/gpt-5.2-mini');
    expect((req.body as { compression: string }).compression).toBe('lossless');
    expect(res.ur.request_id).toBe('req_1');
  });

  it('chat.completions.create with stream:true returns an async iterable of chunks', async () => {
    const encoder = new TextEncoder();
    const sse =
      `data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"content":"hey"}}]}\n\n` +
      `data: [DONE]\n\n`;
    const fetch: FetchLike = async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(c) {
            c.enqueue(encoder.encode(sse));
            c.close();
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      );
    const ur = new UltraRouter({ apiKey: 'k', baseURL: 'http://gw', fetch });
    const stream = await ur.chat.completions.create({
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    });
    let text = '';
    for await (const chunk of stream) text += chunk.choices[0]?.delta.content ?? '';
    expect(text).toBe('hey');
  });

  it('embeddings.create posts to /v1/embeddings', async () => {
    const { fetch, last } = recordingFetch({
      object: 'list',
      data: [{ object: 'embedding', index: 0, embedding: [0.1] }],
      model: 'm',
      usage: { prompt_tokens: 1, total_tokens: 1 },
      ur: {
        request_id: 'req_2',
        call_type: null,
        model_served: 'm',
        provider: 'openai',
        routing: { mode: 'off', fallback_used: false },
        cost_usd: 0,
        byok: false,
      },
    });
    const ur = new UltraRouter({ apiKey: 'k', baseURL: 'http://gw', fetch });
    const res = await ur.embeddings.create({ model: 'm', input: 'x' });
    expect(last().url).toBe('http://gw/v1/embeddings');
    expect(res.ur.request_id).toBe('req_2');
  });

  it('models.list appends provider/capability filters', async () => {
    const { fetch, last } = recordingFetch({ object: 'list', data: [] });
    const ur = new UltraRouter({ apiKey: 'k', baseURL: 'http://gw', fetch });
    await ur.models.list({ provider: 'openai', capability: 'vision' });
    expect(last().url).toBe('http://gw/v1/models?provider=openai&capability=vision');
  });

  it('ur.requests.feedback unwraps the { feedback } envelope and builds the right path', async () => {
    // The gateway wraps this route in `{ feedback: … }` — the SDK returns the bare row.
    const fb = recordingFetch({
      feedback: {
        object: 'request_feedback',
        id: 'fb_1',
        request_id: 'req_1',
        rating: 1,
        tags: [],
        comment: null,
        created_at: 'now',
      },
    });
    const ur = new UltraRouter({ apiKey: 'k', baseURL: 'http://gw', fetch: fb.fetch });
    const result = await ur.ur.requests.feedback('req_1', { rating: 1 });
    expect(result.object).toBe('request_feedback');
    expect(result.id).toBe('fb_1');
    expect(fb.last().url).toBe('http://gw/v1/requests/req_1/feedback');
    expect(fb.last().method).toBe('POST');

    const gen = recordingFetch({});
    const ur2 = new UltraRouter({ apiKey: 'k', baseURL: 'http://gw', fetch: gen.fetch });
    await ur2.ur.generation.get('req_1');
    expect(gen.last().url).toBe('http://gw/v1/generation?id=req_1');
  });

  it('ur.callTypes.* build the right paths', async () => {
    const rec = recordingFetch({ object: 'list', data: [] });
    const ur = new UltraRouter({ apiKey: 'k', baseURL: 'http://gw', fetch: rec.fetch });
    await ur.ur.callTypes.list();
    expect(rec.last().url).toBe('http://gw/v1/call-types');
  });

  it('ur.callTypes.enqueueEval POSTs the manual eval trigger and returns the enqueued run', async () => {
    const rec = recordingFetch(
      { object: 'eval_run', enqueued: true, run_id: 'evr_1', candidate_count: 3 },
      202,
    );
    const ur = new UltraRouter({ apiKey: 'k', baseURL: 'http://gw', fetch: rec.fetch });
    const res = await ur.ur.callTypes.enqueueEval('ct_1', { mode: 'task' });
    expect(rec.last().url).toBe('http://gw/v1/call-types/ct_1/evals');
    expect(rec.last().method).toBe('POST');
    expect(rec.last().body).toEqual({ mode: 'task' });
    // narrow on the discriminant so the enqueued branch exposes run_id
    if (res.enqueued) {
      expect(res.run_id).toBe('evr_1');
      expect(res.candidate_count).toBe(3);
    } else {
      throw new Error('expected an enqueued response');
    }
  });

  it('ur.callTypes.enqueueEval — a DEDUPE names the run it deduped onto', async () => {
    const rec = recordingFetch(
      {
        object: 'eval_run',
        enqueued: false,
        reason: 'deduped',
        deduped: true,
        prior_run_id: 'evr_prior',
        trigger: 'model.release',
        status: 'scored',
      },
      200,
    );
    const ur = new UltraRouter({ apiKey: 'k', baseURL: 'http://gw', fetch: rec.fetch });
    const res = await ur.ur.callTypes.enqueueEval('ct_1');
    expect(rec.last().body).toEqual({});
    // narrow on the discriminant so the no-op branch exposes prior_run_id + trigger/status
    if (res.enqueued) throw new Error('expected a deduped no-op');
    expect(res.deduped).toBe(true);
    expect(res.reason).toBe('deduped');
    expect(res.prior_run_id).toBe('evr_prior');
    expect(res.trigger).toBe('model.release');
    expect(res.status).toBe('scored');
  });
});

describe('UltraRouter — asOpenAI drop-in', () => {
  it('returns a baseURL+key preset config', () => {
    const ur = new UltraRouter({ apiKey: 'ur_sk_test_1', baseURL: 'http://localhost:8080' });
    expect(ur.asOpenAI()).toEqual({ baseURL: 'http://localhost:8080/v1', apiKey: 'ur_sk_test_1' });
  });

  it('constructs an instance when given a client constructor', () => {
    class FakeOpenAI {
      baseURL: string;
      apiKey: string;
      constructor(opts: { baseURL: string; apiKey: string }) {
        this.baseURL = opts.baseURL;
        this.apiKey = opts.apiKey;
      }
    }
    const ur = new UltraRouter({ apiKey: 'k', baseURL: 'http://gw' });
    const client = ur.asOpenAI(FakeOpenAI);
    expect(client).toBeInstanceOf(FakeOpenAI);
    expect(client.baseURL).toBe('http://gw/v1');
    expect(client.apiKey).toBe('k');
  });

  it('is also reachable as ur.asOpenAI', () => {
    const ur = new UltraRouter({ apiKey: 'k', baseURL: 'http://gw' });
    expect(ur.ur.asOpenAI().baseURL).toBe('http://gw/v1');
  });
});
