// — the ultrarouter Bench SDK surface.
//
// Covers AC (1)-(6): (1) the `bench` init option stamps X-UR-Bench-* on EVERY request
// incl. streams + retries; (2) a per-call `bench` overrides init (body `ur.bench` wins);
// (3) the UR_BENCH env fallback captures through a raw `asOpenAI()` client; (4)
// `run({ wait: true })` long-polls the umbrella run to a terminal status; (5) a live-key
// bench tag warns exactly once at construction; (6) the `ur.bench.*` namespace drives the
// real - routes.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { UltraRouter } from '../src/client.js';
import { applyChatDefaults, resolveBenchInit } from '../src/config.js';
import { UltraRouterError } from '../src/errors.js';
import type { FetchLike } from '../src/types.js';

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A fetch that records EVERY call and replies via a router `(call) => Response`. */
function recorder(router: (call: Captured, n: number) => Response): {
  fetch: FetchLike;
  calls: Captured[];
} {
  const calls: Captured[] = [];
  const fetch: FetchLike = async (url, init) => {
    const headers: Record<string, string> = {};
    const raw = init?.headers as Record<string, string> | undefined;
    if (raw) for (const [k, v] of Object.entries(raw)) headers[k.toLowerCase()] = v;
    const call: Captured = {
      url: String(url),
      method: init?.method ?? 'GET',
      headers,
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    };
    calls.push(call);
    return router(call, calls.length);
  };
  return { fetch, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const messages = [{ role: 'user' as const, content: 'hi' }];

const CHAT_RESPONSE = {
  id: 'c',
  object: 'chat.completion',
  created: 1,
  model: 'm',
  choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  ur: {
    request_id: 'req_1',
    call_type: null,
    model_served: 'm',
    provider: 'openai',
    routing: { mode: 'off', fallback_used: false },
    compression: { applied: 'off' },
    cost_usd: 0,
    byok: false,
  },
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// --- init header resolution (pure) -----------------------------------------
describe('resolveBenchInit — init tag → X-UR-Bench-* headers', () => {
  it('a bare string is the suite slug', () => {
    const r = resolveBenchInit('nightly', {});
    expect(r?.headers).toEqual({ 'x-ur-bench-suite': 'nightly' });
    expect(r?.traceFactory).toBeUndefined();
  });

  it('the long form carries run + a string trace', () => {
    const r = resolveBenchInit({ suite: 's', run: 'abc123', trace: 't-1' }, {});
    expect(r?.headers).toEqual({
      'x-ur-bench-suite': 's',
      'x-ur-bench-run': 'abc123',
      'x-ur-bench-trace': 't-1',
    });
  });

  it('a trace FUNCTION is a per-request factory (never a static header)', () => {
    const r = resolveBenchInit({ suite: 's', trace: () => 'dyn' }, {});
    expect(r?.headers).toEqual({ 'x-ur-bench-suite': 's' });
    expect(r?.traceFactory?.()).toBe('dyn');
  });

  it('falls back to UR_BENCH (+ run/trace) when no explicit tag is passed', () => {
    const r = resolveBenchInit(undefined, {
      UR_BENCH: 'env-suite',
      UR_BENCH_RUN: 'env-run',
      UR_BENCH_TRACE: 'env-trace',
    });
    expect(r?.headers).toEqual({
      'x-ur-bench-suite': 'env-suite',
      'x-ur-bench-run': 'env-run',
      'x-ur-bench-trace': 'env-trace',
    });
  });

  it('the explicit option WINS over the env fallback', () => {
    const r = resolveBenchInit('explicit', { UR_BENCH: 'env-suite' });
    expect(r?.headers['x-ur-bench-suite']).toBe('explicit');
  });

  it('returns undefined with no tag and no env', () => {
    expect(resolveBenchInit(undefined, {})).toBeUndefined();
    expect(resolveBenchInit(undefined, { UR_BENCH: '  ' })).toBeUndefined();
  });
});

// --- headers on every request incl. streams + retries ----------------
describe('init `bench` stamps the headers on every request', () => {
  it('a non-stream chat carries X-UR-Bench-Suite/-Run', async () => {
    const { fetch, calls } = recorder(() => jsonResponse(CHAT_RESPONSE));
    const ur = new UltraRouter({
      apiKey: 'ur_sk_test_1',
      baseURL: 'http://gw',
      bench: { suite: 'nightly', run: 'sha-abc' },
      fetch,
    });
    await ur.chat.completions.create({ model: 'm', messages });
    expect(calls[0]?.headers['x-ur-bench-suite']).toBe('nightly');
    expect(calls[0]?.headers['x-ur-bench-run']).toBe('sha-abc');
  });

  it('a streaming chat carries the bench headers (and the SSE accept)', async () => {
    const sse = `data: {"id":"1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"content":"y"}}]}\n\ndata: [DONE]\n\n`;
    const { fetch, calls } = recorder(
      () => new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    );
    const ur = new UltraRouter({
      apiKey: 'ur_sk_test_1',
      baseURL: 'http://gw',
      bench: 'strm',
      fetch,
    });
    const stream = await ur.chat.completions.create({ model: 'm', messages, stream: true });
    let text = '';
    for await (const chunk of stream) text += chunk.choices[0]?.delta.content ?? '';
    expect(text).toBe('y');
    expect(calls[0]?.headers['x-ur-bench-suite']).toBe('strm');
    expect(calls[0]?.headers['accept']).toBe('text/event-stream');
  });

  it('embeddings carry the bench headers too', async () => {
    const { fetch, calls } = recorder(() =>
      jsonResponse({
        object: 'list',
        data: [{ object: 'embedding', index: 0, embedding: [0.1] }],
        model: 'm',
        usage: { prompt_tokens: 1, total_tokens: 1 },
        ur: {
          request_id: 'req_e',
          call_type: null,
          model_served: 'm',
          provider: 'openai',
          routing: { mode: 'off', fallback_used: false },
          cost_usd: 0,
          byok: false,
        },
      }),
    );
    const ur = new UltraRouter({
      apiKey: 'ur_sk_test_1',
      baseURL: 'http://gw',
      bench: 'emb',
      fetch,
    });
    await ur.embeddings.create({ model: 'm', input: 'x' });
    expect(calls[0]?.headers['x-ur-bench-suite']).toBe('emb');
  });

  it('the headers survive a retry (429 → 200): BOTH attempts carry them', async () => {
    const { fetch, calls } = recorder((_call, n) =>
      n === 1
        ? new Response(JSON.stringify({ error: { code: 'rate_limited', retryable: true } }), {
            status: 429,
            headers: { 'retry-after': '0' },
          })
        : jsonResponse(CHAT_RESPONSE),
    );
    const ur = new UltraRouter({
      apiKey: 'ur_sk_test_1',
      baseURL: 'http://gw',
      bench: 'retry',
      fetch,
    });
    await ur.chat.completions.create({ model: 'm', messages });
    expect(calls.length).toBe(2);
    expect(calls[0]?.headers['x-ur-bench-suite']).toBe('retry');
    expect(calls[1]?.headers['x-ur-bench-suite']).toBe('retry');
  });

  it('a trace FUNCTION is evaluated fresh per request', async () => {
    let i = 0;
    const { fetch, calls } = recorder(() => jsonResponse(CHAT_RESPONSE));
    const ur = new UltraRouter({
      apiKey: 'ur_sk_test_1',
      baseURL: 'http://gw',
      bench: { suite: 's', trace: () => `trace-${(i += 1)}` },
      fetch,
    });
    await ur.chat.completions.create({ model: 'm', messages });
    await ur.chat.completions.create({ model: 'm', messages });
    expect(calls[0]?.headers['x-ur-bench-trace']).toBe('trace-1');
    expect(calls[1]?.headers['x-ur-bench-trace']).toBe('trace-2');
  });
});

// --- per-call override wins (body ur.bench) ---------------------------
describe('a per-call `bench` overrides init (body wins)', () => {
  it('maps a per-call bench into body.ur.bench (pure)', () => {
    const body = applyChatDefaults({ messages, bench: 'per-call' }, { defaults: {} });
    expect(body.ur?.bench).toBe('per-call');
    expect('bench' in body).toBe(false); // top-level field stripped from the wire body
  });

  it('the wire body carries ur.bench while the init header still rides (body wins server-side)', async () => {
    const { fetch, calls } = recorder(() => jsonResponse(CHAT_RESPONSE));
    const ur = new UltraRouter({
      apiKey: 'ur_sk_test_1',
      baseURL: 'http://gw',
      bench: 'init',
      fetch,
    });
    await ur.chat.completions.create({
      model: 'm',
      messages,
      bench: { suite: 'call', run: 'r9' },
    });
    const body = calls[0]?.body as { ur?: { bench?: unknown }; bench?: unknown };
    expect(body.ur?.bench).toEqual({ suite: 'call', run: 'r9' });
    expect('bench' in body).toBe(false);
    // The init header still ships (the gateway resolves body over header).
    expect(calls[0]?.headers['x-ur-bench-suite']).toBe('init');
  });
});

// --- UR_BENCH env captures through a raw asOpenAI() client ------------
describe('UR_BENCH env fallback works through asOpenAI()', () => {
  it('asOpenAI() presets defaultHeaders with the env bench headers', () => {
    vi.stubEnv('UR_BENCH', 'env-suite');
    vi.stubEnv('UR_BENCH_RUN', 'env-run');
    const ur = new UltraRouter({ apiKey: 'ur_sk_test_1', baseURL: 'http://gw' });
    const preset = ur.asOpenAI();
    expect(preset.defaultHeaders?.['x-ur-bench-suite']).toBe('env-suite');
    expect(preset.defaultHeaders?.['x-ur-bench-run']).toBe('env-run');
  });

  it('an injected OpenAI ctor receives the env bench headers', () => {
    vi.stubEnv('UR_BENCH', 'env-suite');
    class FakeOpenAI {
      constructor(
        readonly opts: { baseURL: string; apiKey: string; defaultHeaders?: Record<string, string> },
      ) {}
    }
    const ur = new UltraRouter({ apiKey: 'ur_sk_test_1', baseURL: 'http://gw' });
    const client = ur.asOpenAI(FakeOpenAI);
    expect(client.opts.defaultHeaders?.['x-ur-bench-suite']).toBe('env-suite');
  });

  it('the env bench headers ride the SDK request path too', async () => {
    vi.stubEnv('UR_BENCH', 'env-suite');
    const { fetch, calls } = recorder(() => jsonResponse(CHAT_RESPONSE));
    const ur = new UltraRouter({ apiKey: 'ur_sk_test_1', baseURL: 'http://gw', fetch });
    await ur.chat.completions.create({ model: 'm', messages });
    expect(calls[0]?.headers['x-ur-bench-suite']).toBe('env-suite');
  });
});

// --- live-key warn fires exactly once --------------------------------
describe('a live key + a bench tag warns exactly once', () => {
  it('warns once at construction on a live key', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    new UltraRouter({ apiKey: 'ur_sk_live_deadbeef', baseURL: 'http://gw', bench: 'oops' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('not honored on a live');
  });

  it('does NOT warn on a test key', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    new UltraRouter({ apiKey: 'ur_sk_test_ok', baseURL: 'http://gw', bench: 'fine' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('does NOT warn on a live key without a bench tag', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    new UltraRouter({ apiKey: 'ur_sk_live_deadbeef', baseURL: 'http://gw' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('surfaces the gateway 400 with its actionable message (the consent gate)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const message =
      'bench capture is not allowed on a live key: use a test key (ur_sk_test_…), or have a ' +
      'workspace owner enable the bench_allow_live_capture setting';
    const { fetch } = recorder(
      () =>
        new Response(
          JSON.stringify({ error: { code: 'invalid_request', message, retryable: false } }),
          {
            status: 400,
            headers: { 'content-type': 'application/json' },
          },
        ),
    );
    const ur = new UltraRouter({
      apiKey: 'ur_sk_live_deadbeef',
      baseURL: 'http://gw',
      bench: 'oops',
      fetch,
      maxRetries: 0,
    });
    await expect(ur.chat.completions.create({ model: 'm', messages })).rejects.toMatchObject({
      code: 'invalid_request',
      status: 400,
      message,
    });
    await expect(ur.chat.completions.create({ model: 'm', messages })).rejects.toBeInstanceOf(
      UltraRouterError,
    );
  });
});

// --- the ur.bench.* namespace over the real routes -------------------
describe('ur.bench.* drives the - routes', () => {
  const key = { apiKey: 'ur_sk_test_1', baseURL: 'http://gw' };

  it('status → GET /v1/bench/suites/:slug/status', async () => {
    const { fetch, calls } = recorder(() =>
      jsonResponse({
        object: 'bench_suite_status',
        suite: 's',
        suite_id: 'bs_1',
        ttl_days: 30,
        total_captured: 3,
        call_types: [],
        capture: { confirmed: 3, queued: 0, failed: 0, non_replayable: 0 },
      }),
    );
    const ur = new UltraRouter({ ...key, fetch });
    const status = await ur.ur.bench.status('my suite');
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.url).toBe('http://gw/v1/bench/suites/my%20suite/status');
    expect(status.object).toBe('bench_suite_status');
  });

  it('freeze → POST /v1/bench/suites/:slug/freeze', async () => {
    const { fetch, calls } = recorder(() =>
      jsonResponse({ object: 'bench_dataset_freeze', suite: 's', suite_id: 'bs_1', datasets: [] }),
    );
    const ur = new UltraRouter({ ...key, fetch });
    const res = await ur.ur.bench.freeze('s');
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.url).toBe('http://gw/v1/bench/suites/s/freeze');
    expect(res.object).toBe('bench_dataset_freeze');
  });

  it('expect → POST …/expectations with the {expectations} body', async () => {
    const { fetch, calls } = recorder(() =>
      jsonResponse({
        object: 'bench_expectations',
        suite: 's',
        suite_id: 'bs_1',
        attached: [],
        accepted: 1,
        rejected: 0,
      }),
    );
    const ur = new UltraRouter({ ...key, fetch });
    const res = await ur.ur.bench.expect('s', [
      { kind: 'json_schema', config: { required_fields: ['x'] } },
    ]);
    expect(calls[0]?.url).toBe('http://gw/v1/bench/suites/s/expectations');
    expect((calls[0]?.body as { expectations: unknown[] }).expectations).toHaveLength(1);
    expect(res.accepted).toBe(1);
  });

  it('record({suite}) → POST …/suites/:slug/outcomes; record({run}) → …/runs/:id/outcomes', async () => {
    const suiteRec = recorder(() =>
      jsonResponse({
        object: 'bench_outcomes',
        suite: 's',
        suite_id: 'bs_1',
        bench_run_id: null,
        recorded: [],
        total: 1,
      }),
    );
    const ur1 = new UltraRouter({ ...key, fetch: suiteRec.fetch });
    await ur1.ur.bench.record({ suite: 's' }, [{ trace: 't1', passed: true }]);
    expect(suiteRec.calls[0]?.url).toBe('http://gw/v1/bench/suites/s/outcomes');
    expect((suiteRec.calls[0]?.body as { outcomes: unknown[] }).outcomes).toHaveLength(1);

    const runRec = recorder(() =>
      jsonResponse({
        object: 'bench_outcomes',
        suite: 's',
        suite_id: 'bs_1',
        bench_run_id: 'br_1',
        recorded: [],
        total: 1,
      }),
    );
    const ur2 = new UltraRouter({ ...key, fetch: runRec.fetch });
    await ur2.ur.bench.record({ run: 'br_1' }, [{ trace: 't1', passed: false }]);
    expect(runRec.calls[0]?.url).toBe('http://gw/v1/bench/runs/br_1/outcomes');
  });

  it('report(json) parses; report(md) returns the raw text export', async () => {
    const jsonRec = recorder(() =>
      jsonResponse({ object: 'bench_report', bench_run_id: 'br_1', version: 1 }),
    );
    const urJson = new UltraRouter({ ...key, fetch: jsonRec.fetch });
    const report = await urJson.ur.bench.report('br_1');
    expect(jsonRec.calls[0]?.url).toBe('http://gw/v1/bench/runs/br_1/report?format=json');
    expect(report.object).toBe('bench_report');

    const mdRec = recorder(() => new Response('# Bench report\n', { status: 200 }));
    const urMd = new UltraRouter({ ...key, fetch: mdRec.fetch });
    const md = await urMd.ur.bench.report('br_1', { format: 'md' });
    expect(mdRec.calls[0]?.url).toBe('http://gw/v1/bench/runs/br_1/report?format=md');
    expect(md).toContain('# Bench report');
  });

  it('run(dry_run) posts the trigger body and returns the estimate', async () => {
    const { fetch, calls } = recorder(() =>
      jsonResponse({
        object: 'bench_run_trigger',
        bench_run_id: null,
        suite: 's',
        dry_run: true,
        mode: 'request',
        selection_mode: 'selection',
        estimate_usd: 0.5,
        allowance: { grant_usd: 1, reserved_usd: 0, spent_usd: 0, available_usd: 1 },
        dispositions: [],
      }),
    );
    const ur = new UltraRouter({ ...key, fetch });
    const res = await ur.ur.bench.run({
      suite: 's',
      max_cost_usd: 5,
      dry_run: true,
      candidates: ['x/c'],
    });
    expect(calls[0]?.url).toBe('http://gw/v1/bench/suites/s/runs');
    const body = calls[0]?.body as Record<string, unknown>;
    expect(body).toEqual({ max_cost_usd: 5, dry_run: true, candidates: ['x/c'] });
    expect(res.object).toBe('bench_run_trigger');
  });

  // — the opt-in pre-spend power gate is threaded into the trigger body.
  it('run(require_power) threads require_power into the trigger body', async () => {
    const { fetch, calls } = recorder(() =>
      jsonResponse({
        object: 'bench_run_trigger',
        bench_run_id: null,
        suite: 's',
        dry_run: true,
        mode: 'request',
        selection_mode: 'selection',
        estimate_usd: 0,
        allowance: { grant_usd: 1, reserved_usd: 0, spent_usd: 0, available_usd: 1 },
        dispositions: [
          {
            call_type_id: 'ct_1',
            disposition: 'runnable',
            unique_count: 12,
            power: {
              margin_pp: 5,
              mde_pp: 8.2,
              cluster_n: 12,
              required_clusters: 30,
              underpowered: true,
            },
            unmatched_candidates: [],
          },
        ],
      }),
    );
    const ur = new UltraRouter({ ...key, fetch });
    const res = await ur.ur.bench.run({
      suite: 's',
      max_cost_usd: 5,
      dry_run: true,
      require_power: true,
      candidates: ['x/c'],
    });
    const body = calls[0]?.body as Record<string, unknown>;
    expect(body).toEqual({
      max_cost_usd: 5,
      require_power: true,
      dry_run: true,
      candidates: ['x/c'],
    });
    // the disposition carries the typed power advisory + the (empty) unmatched list.
    const trigger = res as {
      dispositions: { power?: { underpowered: boolean }; unmatched_candidates?: string[] }[];
    };
    expect(trigger.dispositions[0]?.power?.underpowered).toBe(true);
    expect(trigger.dispositions[0]?.unmatched_candidates).toEqual([]);
  });

  // — run({ wait: true }) long-polls the umbrella run to a terminal status.
  it('run({ wait: true }) long-polls get() until complete, then resolves the run', async () => {
    let polls = 0;
    const { fetch, calls } = recorder((call) => {
      if (call.method === 'POST') {
        return jsonResponse({
          object: 'bench_run_trigger',
          bench_run_id: 'br_9',
          suite: 's',
          dry_run: false,
          mode: 'request',
          selection_mode: 'selection',
          estimate_usd: 1,
          allowance: { grant_usd: 5, reserved_usd: 1, spent_usd: 0, available_usd: 4 },
          dispositions: [{ call_type_id: 'ct_1', disposition: 'runnable' }],
        });
      }
      polls += 1;
      const status = polls < 2 ? 'running' : 'complete';
      return jsonResponse({
        object: 'bench_run',
        id: 'br_9',
        suite: 's',
        mode: 'request',
        selection_mode: 'selection',
        status,
        estimate_usd: 1,
        allowance: { grant_usd: 5, reserved_usd: 1, spent_usd: 0, available_usd: 4 },
        dispositions: [],
        runs: [{ eval_run_id: 'er_1', call_type_id: 'ct_1', status, arms: [] }],
      });
    });
    const ur = new UltraRouter({ ...key, fetch });
    const result = await ur.ur.bench.run({
      suite: 's',
      max_cost_usd: 5,
      wait: true,
      pollIntervalMs: 1,
      waitTimeoutMs: 5000,
    });
    expect(result.object).toBe('bench_run');
    expect((result as { status: string }).status).toBe('complete');
    // one POST (trigger) + ≥2 GETs (poll until complete).
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    expect(calls.filter((c) => c.method === 'GET').length).toBeGreaterThanOrEqual(2);
  });

  it('run({ wait: true }) on a dry-run (no bench_run_id) resolves the trigger — no polling', async () => {
    const { fetch, calls } = recorder(() =>
      jsonResponse({
        object: 'bench_run_trigger',
        bench_run_id: null,
        suite: 's',
        dry_run: true,
        mode: 'request',
        selection_mode: 'selection',
        estimate_usd: 0,
        allowance: { grant_usd: null, reserved_usd: 0, spent_usd: 0, available_usd: 0 },
        dispositions: [],
      }),
    );
    const ur = new UltraRouter({ ...key, fetch });
    const res = await ur.ur.bench.run({ suite: 's', max_cost_usd: 5, dry_run: true, wait: true });
    expect(res.object).toBe('bench_run_trigger');
    expect(calls).toHaveLength(1);
  });

  // — the `code` is a FREE STRING; the SDK surfaces any code verbatim. The live
  // `atomic_spend_guard_unavailable` 503 (bench.paid_dispatch OFF / unseeded) is unreachable on a
  // seeded stack (switch ON), so a shaped fixture proves the mapping passes the code through.
  it('surfaces a 503 atomic_spend_guard_unavailable code verbatim (free-string passthrough)', async () => {
    const { fetch } = recorder(
      () =>
        new Response(
          JSON.stringify({
            error: {
              code: 'atomic_spend_guard_unavailable',
              message: 'live bench dispatch is unavailable (bench.paid_dispatch off)',
              retryable: false,
            },
          }),
          { status: 503, headers: { 'content-type': 'application/json' } },
        ),
    );
    const ur = new UltraRouter({ ...key, fetch, maxRetries: 0 });
    await expect(ur.ur.bench.run({ suite: 's', max_cost_usd: 5 })).rejects.toMatchObject({
      code: 'atomic_spend_guard_unavailable',
      status: 503,
      retryable: false,
    });
  });
});
