// The resources added for the current API: models.retrieve, key, call-type evals / recommendations /
// hosted prompts / verified memory, improvement reads, verdict sources, oracles (signed pull transport),
// the typed request() escape hatch, base-URL env resolution and the VERSION constant.
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { UltraRouter } from '../src/client.js';
import { UltraRouterError } from '../src/errors.js';
import { ORACLE_SIGNATURE_HEADER, ORACLE_TIMESTAMP_HEADER } from '../src/resources.js';
import type { FetchLike } from '../src/types.js';
import { VERSION } from '../src/version.js';

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  rawBody: string | undefined;
}

/** A fetch that records every request and answers with a canned JSON body (or text). */
function recorder(
  response: unknown = { ok: true },
  init: { status?: number; text?: boolean } = {},
) {
  const calls: Captured[] = [];
  const fetch: FetchLike = async (url, req) => {
    calls.push({
      url: String(url),
      method: req?.method ?? 'GET',
      headers: (req?.headers as Record<string, string>) ?? {},
      rawBody: req?.body === undefined ? undefined : String(req.body),
    });
    return new Response(init.text === true ? String(response) : JSON.stringify(response), {
      status: init.status ?? 200,
      headers: { 'content-type': init.text === true ? 'text/plain' : 'application/json' },
    });
  };
  const last = (): Captured => {
    const c = calls.at(-1);
    if (c === undefined) throw new Error('no request captured');
    return c;
  };
  return { fetch, calls, last };
}

const BASE = 'https://gw.test';

function client(fetch: FetchLike): UltraRouter {
  return new UltraRouter({ apiKey: 'ur_sk_test_unit', baseURL: BASE, fetch, maxRetries: 0 });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('models.retrieve', () => {
  it('GETs /v1/models/{id}, keeping the provider slash and encoding each part', async () => {
    const rec = recorder({ id: 'openai/gpt-5.2-mini', offers: [] });
    const res = await client(rec.fetch).models.retrieve('openai/gpt-5.2-mini');
    expect(rec.last().url).toBe(`${BASE}/v1/models/openai/gpt-5.2-mini`);
    expect(rec.last().method).toBe('GET');
    expect(res.id).toBe('openai/gpt-5.2-mini');
    await client(rec.fetch).models.retrieve('acme/model v1?x');
    expect(rec.last().url).toBe(`${BASE}/v1/models/acme/model%20v1%3Fx`);
  });

  it('refuses a traversal or empty segment before any request', async () => {
    const rec = recorder();
    for (const bad of ['../workspaces', 'a//b', 'openai/.', '']) {
      await expect(client(rec.fetch).models.retrieve(bad)).rejects.toMatchObject({
        code: 'invalid_request',
      });
    }
    expect(rec.calls).toHaveLength(0);
  });
});

describe('ur.key / call types / prompts / verified memory / reads', () => {
  const cases: {
    label: string;
    call: (ur: UltraRouter) => Promise<unknown>;
    method: string;
    path: string;
    body?: unknown;
  }[] = [
    { label: 'key.get', call: (ur) => ur.ur.key.get(), method: 'GET', path: '/v1/key' },
    {
      label: 'callTypes.listEvals',
      call: (ur) => ur.ur.callTypes.listEvals('ct_1'),
      method: 'GET',
      path: '/v1/call-types/ct_1/evals',
    },
    {
      label: 'callTypes.recommendations',
      call: (ur) => ur.ur.callTypes.recommendations('support'),
      method: 'GET',
      path: '/v1/call-types/support/recommendations',
    },
    {
      label: 'prompts.list',
      call: (ur) => ur.ur.callTypes.prompts.list('ct_1'),
      method: 'GET',
      path: '/v1/call-types/ct_1/prompts',
    },
    {
      label: 'prompts.create',
      call: (ur) =>
        ur.ur.callTypes.prompts.create('ct_1', {
          template: 'You are a {{role}} assistant.',
          variables: [{ name: 'role', required: true }],
        }),
      method: 'POST',
      path: '/v1/call-types/ct_1/prompts',
      body: {
        template: 'You are a {{role}} assistant.',
        variables: [{ name: 'role', required: true }],
      },
    },
    {
      label: 'prompts.get',
      call: (ur) => ur.ur.callTypes.prompts.get('ct_1', 3),
      method: 'GET',
      path: '/v1/call-types/ct_1/prompts/3',
    },
    {
      label: 'prompts.activate',
      call: (ur) => ur.ur.callTypes.prompts.activate('ct_1', 3, { gateway_apply: true }),
      method: 'POST',
      path: '/v1/call-types/ct_1/prompts/3/activate',
      body: { gateway_apply: true },
    },
    {
      label: 'prompts.deactivate',
      call: (ur) => ur.ur.callTypes.prompts.deactivate('ct_1'),
      method: 'POST',
      path: '/v1/call-types/ct_1/prompts/deactivate',
    },
    {
      label: 'prompts.proposal',
      call: (ur) => ur.ur.callTypes.prompts.proposal('ct_1'),
      method: 'GET',
      path: '/v1/call-types/ct_1/prompts/proposal',
    },
    {
      label: 'verifiedMemory.get',
      call: (ur) => ur.ur.callTypes.verifiedMemory.get('ct_1'),
      method: 'GET',
      path: '/v1/call-types/ct_1/verified-memory',
    },
    {
      label: 'verifiedMemory.enable',
      call: (ur) => ur.ur.callTypes.verifiedMemory.enable('ct_1', { target_precision: 0.97 }),
      method: 'POST',
      path: '/v1/call-types/ct_1/verified-memory/enable',
      body: { target_precision: 0.97 },
    },
    {
      label: 'verifiedMemory.disable',
      call: (ur) => ur.ur.callTypes.verifiedMemory.disable('ct_1'),
      method: 'POST',
      path: '/v1/call-types/ct_1/verified-memory/disable',
    },
    {
      label: 'improvementReads.list',
      call: (ur) => ur.ur.improvementReads.list(),
      method: 'GET',
      path: '/v1/improvement-reads',
    },
    {
      label: 'flywheel.sources',
      call: (ur) => ur.ur.flywheel.sources(),
      method: 'GET',
      path: '/v1/flywheel/sources',
    },
    {
      label: 'flywheel.sourceChecks.issue',
      call: (ur) => ur.ur.flywheel.sourceChecks.issue({ call_type_id: 'ct_1' }),
      method: 'POST',
      path: '/v1/flywheel/source-checks',
      body: { call_type_id: 'ct_1' },
    },
    {
      label: 'flywheel.sourceChecks.answer',
      call: (ur) =>
        ur.ur.flywheel.sourceChecks.answer('chk_1', {
          verdicts: [{ probe_id: 'p1', kind: 'resolved_false' }],
        }),
      method: 'POST',
      path: '/v1/flywheel/source-checks/chk_1/verdicts',
      body: { verdicts: [{ probe_id: 'p1', kind: 'resolved_false' }] },
    },
    {
      label: 'oracles.register',
      call: (ur) =>
        ur.ur.oracles.register({ kind: 'label_set', spec: { labels: ['spam', 'ham'] } }),
      method: 'POST',
      path: '/v1/flywheel/oracles',
      body: { kind: 'label_set', spec: { labels: ['spam', 'ham'] } },
    },
    {
      label: 'oracles.get',
      call: (ur) => ur.ur.oracles.get('orc_1'),
      method: 'GET',
      path: '/v1/flywheel/oracles/orc_1',
    },
    {
      label: 'oracles.qualify',
      call: (ur) => ur.ur.oracles.qualify('orc_1', { examples: [{ input: 'q', output: 'a' }] }),
      method: 'POST',
      path: '/v1/flywheel/oracles/orc_1/qualify',
      body: { examples: [{ input: 'q', output: 'a' }] },
    },
    {
      label: 'oracles.test',
      call: (ur) => ur.ur.oracles.test('orc_1'),
      method: 'POST',
      path: '/v1/flywheel/oracles/orc_1/test',
      body: {},
    },
    {
      label: 'oracles.revoke',
      call: (ur) => ur.ur.oracles.revoke('orc_1'),
      method: 'POST',
      path: '/v1/flywheel/oracles/orc_1/revoke',
      body: {},
    },
  ];

  for (const c of cases) {
    it(`${c.label} → ${c.method} ${c.path}`, async () => {
      const rec = recorder({ object: 'ok' });
      const res = await c.call(client(rec.fetch));
      expect(res).toEqual({ object: 'ok' });
      expect(rec.last().method).toBe(c.method);
      expect(rec.last().url).toBe(`${BASE}${c.path}`);
      expect(rec.last().headers.authorization).toBe('Bearer ur_sk_test_unit');
      if (c.body === undefined) expect(rec.last().rawBody).toBeUndefined();
      else expect(JSON.parse(rec.last().rawBody ?? 'null')).toEqual(c.body);
    });
  }

  it('bench.freeze sends max_items only when given', async () => {
    const rec = recorder({ object: 'bench_dataset_freeze' });
    const ur = client(rec.fetch);
    await ur.ur.bench.freeze('suite-a');
    expect(rec.last().rawBody).toBeUndefined();
    await ur.ur.bench.freeze('suite-a', { max_items: 25 });
    expect(JSON.parse(rec.last().rawBody ?? '{}')).toEqual({ max_items: 25 });
  });
});

describe('oracle pull transport is signed over the exact bytes sent', () => {
  const SECRET = 'oracle-secret-for-tests';

  function verify(c: Captured): void {
    const ts = c.headers[ORACLE_TIMESTAMP_HEADER];
    const sig = c.headers[ORACLE_SIGNATURE_HEADER];
    expect(ts).toBe('1700000000');
    const expected = `sha256=${createHmac('sha256', SECRET)
      .update(`${ts}.${c.rawBody ?? ''}`)
      .digest('hex')}`;
    expect(sig).toBe(expected);
  }

  it('claimJobs signs `<timestamp>.<raw body>` with the oracle secret', async () => {
    const rec = recorder({ data: [] });
    await client(rec.fetch).ur.oracles.claimJobs(
      'orc_1',
      { max: 5 },
      { secret: SECRET, timestamp: 1_700_000_000 },
    );
    expect(rec.last().url).toBe(`${BASE}/v1/flywheel/oracles/orc_1/jobs/claim`);
    expect(JSON.parse(rec.last().rawBody ?? '{}')).toEqual({ max: 5 });
    verify(rec.last());
  });

  it('submitVerdicts signs its body the same way', async () => {
    const rec = recorder({ accepted: 1 });
    const params = {
      verdicts: [
        {
          job_id: 'job_1',
          oracle_version: 'v1',
          candidate_sha256: 'abc',
          verdict: 'pass' as const,
        },
      ],
    };
    await client(rec.fetch).ur.oracles.submitVerdicts('orc_1', params as never, {
      secret: SECRET,
      timestamp: 1_700_000_000,
    });
    expect(rec.last().url).toBe(`${BASE}/v1/flywheel/oracles/orc_1/verdicts`);
    verify(rec.last());
  });

  it('a wrong secret produces a different signature (the MAC is bound to the key)', async () => {
    const rec = recorder({ data: [] });
    await client(rec.fetch).ur.oracles.claimJobs(
      'orc_1',
      {},
      { secret: 'other', timestamp: 1_700_000_000 },
    );
    const c = rec.last();
    const forged = `sha256=${createHmac('sha256', SECRET)
      .update(`1700000000.${c.rawBody ?? ''}`)
      .digest('hex')}`;
    expect(c.headers[ORACLE_SIGNATURE_HEADER]).not.toBe(forged);
  });
});

describe('request(): the typed escape hatch', () => {
  it('fills path params (percent-encoded), appends the query and sends the JSON body', async () => {
    const rec = recorder({ object: 'list', data: [] });
    const ur = client(rec.fetch);
    await ur.request('get', '/v1/models/{id}', { path: { id: 'openai/gpt-5.2-mini' } });
    expect(rec.last().url).toBe(`${BASE}/v1/models/openai%2Fgpt-5.2-mini`);
    await ur.request('get', '/v1/outcomes/pending', {
      query: { state: 'overdue', limit: 10, cursor: undefined },
    });
    expect(rec.last().url).toBe(`${BASE}/v1/outcomes/pending?state=overdue&limit=10`);
    await ur.request('post', '/v1/flywheel/grants', {
      body: { call_type: 'support', artifact_key: 'a-1' } as never,
    });
    expect(rec.last().method).toBe('POST');
    expect(JSON.parse(rec.last().rawBody ?? '{}')).toEqual({
      call_type: 'support',
      artifact_key: 'a-1',
    });
    expect(rec.last().headers['idempotency-key']).toBeDefined();
  });

  it('refuses a missing path parameter without sending anything', async () => {
    const rec = recorder();
    await expect(
      client(rec.fetch).request('get', '/v1/imports/{id}', {} as never),
    ).rejects.toMatchObject({
      code: 'invalid_request',
    });
    expect(rec.calls).toHaveLength(0);
  });

  it('returns raw text for a non-JSON body and {} for an empty one', async () => {
    const text = recorder('# report', { text: true });
    expect(
      await client(text.fetch).request('get', '/v1/bench/runs/{id}/report', {
        path: { id: 'br_1' },
      }),
    ).toBe('# report');
    const empty: FetchLike = async () => new Response('', { status: 200 });
    expect(await client(empty).request('get', '/v1/key')).toEqual({});
  });

  it('surfaces gateway errors as UltraRouterError', async () => {
    const rec = recorder(
      { error: { code: 'not_found', message: 'nope', request_id: 'req_9', retryable: false } },
      { status: 404 },
    );
    const err = await client(rec.fetch)
      .request('get', '/v1/imports/{id}', { path: { id: 'imp_1' } })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UltraRouterError);
    expect(err).toMatchObject({ code: 'not_found', status: 404, requestId: 'req_9' });
  });
});

describe('configuration from the environment', () => {
  it('reads ULTRAROUTER_BASE_URL, then UR_BASE_URL, and strips trailing slashes', () => {
    vi.stubEnv('ULTRAROUTER_API_KEY', 'ur_sk_test_env');
    vi.stubEnv('UR_BASE_URL', 'https://second.test/');
    expect(new UltraRouter().baseURL).toBe('https://second.test');
    vi.stubEnv('ULTRAROUTER_BASE_URL', 'https://first.test//');
    expect(new UltraRouter().baseURL).toBe('https://first.test');
    expect(new UltraRouter({ baseURL: 'https://explicit.test' }).baseURL).toBe(
      'https://explicit.test',
    );
  });

  it('throws a typed configuration error when no base URL is set (there is no hosted default)', () => {
    vi.stubEnv('ULTRAROUTER_API_KEY', '');
    vi.stubEnv('UR_API_KEY', 'ur_sk_test_env');
    vi.stubEnv('ULTRAROUTER_BASE_URL', '');
    vi.stubEnv('UR_BASE_URL', '');
    let thrown: unknown;
    try {
      new UltraRouter();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(UltraRouterError);
    const e = thrown as UltraRouterError;
    expect(e.code).toBe('configuration');
    // The message names the option, both env vars, and the local-gateway example.
    expect(e.message).toBe(
      'missing gateway base URL: pass `baseURL` or set ULTRAROUTER_BASE_URL / UR_BASE_URL (for example http://localhost:8080 for a local gateway)',
    );
  });

  it('treats an empty base-URL env value as unset and throws', () => {
    vi.stubEnv('ULTRAROUTER_API_KEY', 'ur_sk_test_env');
    vi.stubEnv('ULTRAROUTER_BASE_URL', '');
    vi.stubEnv('UR_BASE_URL', '');
    expect(() => new UltraRouter()).toThrow(UltraRouterError);
  });

  it('throws a typed authentication error when no key is configured', () => {
    vi.stubEnv('ULTRAROUTER_API_KEY', '');
    vi.stubEnv('UR_API_KEY', '');
    expect(() => new UltraRouter()).toThrow(UltraRouterError);
  });
});

describe('VERSION', () => {
  it('equals package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version: string;
    };
    expect(VERSION).toBe(pkg.version);
  });
});
