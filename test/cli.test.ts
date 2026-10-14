// — the `ur bench run` CLI, unit-tested against a
// STUB gateway (no real process/network). Covers AC (1)-(4): (1) a regression fixture ⇒ exit 2 with a
// named cause; a green fixture ⇒ 0; inconclusive ⇒ 2 by default (0 with --allow-inconclusive); (2) the
// budget flag is respected end-to-end; (3) a deduped-capture re-run still gates correctly; (4) the
// `--json` output schema is versioned + snapshot-tested. Plus: fail CLOSED on any API error (exit 2).
import { describe, expect, it } from 'vitest';

import { UltraRouter } from '../src/client.js';
import { buildGateJson, exitCodeFor, GATE_JSON_SCHEMA, resolveBaseline } from '../src/cli/gate.js';
import { runBench, type BenchRunOptions } from '../src/cli/run.js';
import { runImport, type ImportRunOptions } from '../src/cli/import.js';
import type { BenchCompareGate, FetchLike } from '../src/types.js';

// --- a stub gateway (routes freeze / trigger / run-poll / gate / baseline) --------------------------

interface StubOptions {
  /** The gate response the stub returns from GET …/gate. Absent ⇒ 404. */
  gate?: BenchCompareGate;
  /** Force a non-2xx on a named route to exercise the fail-closed path. */
  failOn?: 'freeze' | 'run' | 'gate';
  /** The umbrella run id the trigger mints. */
  benchRunId?: string;
  /** Mark the trigger dispositions as deduped (with a linked prior run). */
  deduped?: boolean;
}

interface Recorded {
  url: string;
  method: string;
  body: unknown;
}

function stubGateway(opts: StubOptions): { fetch: FetchLike; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const runId = opts.benchRunId ?? 'br_run1';
  const fetch: FetchLike = async (url, init) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    calls.push({
      url: u,
      method,
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    const json = (body: unknown, status = 200): Response =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    const error = (code: string, status: number): Response =>
      json({ error: { code, message: `${code} (stub)`, type: code } }, status);

    if (method === 'POST' && u.endsWith('/freeze')) {
      if (opts.failOn === 'freeze') return error('internal', 500);
      return json({ object: 'bench_dataset_freeze', suite: 's', suite_id: 'bs_1', datasets: [] });
    }
    if (method === 'POST' && u.endsWith('/runs')) {
      if (opts.failOn === 'run') return error('internal', 500);
      return json({
        object: 'bench_run_trigger',
        bench_run_id: runId,
        suite: 's',
        dry_run: false,
        mode: 'request',
        selection_mode: 'noninferiority',
        estimate_usd: 0.01,
        allowance: { grant_usd: 10, reserved_usd: 0, spent_usd: 0, available_usd: 10 },
        dispositions:
          opts.deduped === true
            ? [
                {
                  call_type_id: 'ct_x',
                  disposition: 'deduped',
                  reason: 'deduped',
                  tier: 'standard',
                  tier_summary: '',
                  unique_count: 40,
                  dataset_hash: 'h',
                  estimate_usd: 0,
                  reserved_usd: 0,
                  eval_run_id: null,
                  prior_run_id: 'er_prior',
                },
              ]
            : [
                {
                  call_type_id: 'ct_x',
                  disposition: 'runnable',
                  reason: null,
                  tier: 'standard',
                  tier_summary: '',
                  unique_count: 40,
                  dataset_hash: 'h',
                  estimate_usd: 0.01,
                  reserved_usd: 0.01,
                  eval_run_id: 'er_x',
                  prior_run_id: null,
                },
              ],
      });
    }
    if (method === 'GET' && /\/bench\/runs\/[^/]+$/.test(u)) {
      // The wait long-poll target — terminal immediately.
      return json({
        object: 'bench_run',
        id: runId,
        suite: 's',
        mode: 'request',
        selection_mode: 'noninferiority',
        status: 'complete',
        estimate_usd: 0.01,
        allowance: { grant_usd: 10, reserved_usd: 0, spent_usd: 0, available_usd: 10 },
        dispositions: [],
        runs: [],
      });
    }
    if (method === 'GET' && u.endsWith('/gate')) {
      if (opts.failOn === 'gate') return error('internal', 500);
      if (opts.gate === undefined) return error('not_found', 404);
      return json(opts.gate);
    }
    if (method === 'POST' && u.endsWith('/baseline')) {
      return json({
        object: 'bench_baseline',
        suite: 's',
        suite_id: 'bs_1',
        baseline_run_id: runId,
        previous_baseline_run_id: 'br_old',
      });
    }
    return error('not_found', 404);
  };
  return { fetch, calls };
}

function makeClient(fetch: FetchLike): UltraRouter {
  return new UltraRouter({ apiKey: 'ur_sk_test_x', baseURL: 'http://stub', fetch });
}

/** A canonical gate response for a given verdict (deterministic — safe for snapshots). */
function gate(
  verdict: 'pass' | 'fail' | 'inconclusive',
  extra: Partial<BenchCompareGate['call_types'][number]> = {},
): BenchCompareGate {
  const ct = {
    call_type_id: 'ct_checkout',
    eval_run_id: 'er_cand',
    baseline_eval_run_id: 'er_base',
    verdict,
    quality: verdict,
    cost: verdict,
    quality_interval: { low: 0.01, high: 0.03, point: 0.02, n: 40, clusters: 40, bar: -0.05 },
    cost_interval: { low: 0.25, high: 0.35, point: 0.3, n: 40, clusters: 40, bar: 0.1 },
    quality_margin_pp: 5,
    cost_min_savings: 0.1,
    mde_pp: 2.3,
    cost_ceiling: {
      enabled: false,
      ceiling_micro_usd: null,
      observed_mean_micro_usd: null,
      breached: false,
    },
    pairing: {
      candidate_items: 40,
      eligible_pairs: 40,
      ineligible_missing_artifact: 0,
      unpaired: 0,
      eligible_clusters: 40,
    },
    reasons: [] as string[],
    ...extra,
  };
  return {
    object: 'bench_compare_gate',
    bench_run_id: 'br_run1',
    baseline_run_id: 'br_base1',
    verdict,
    cost_ceiling_micro_usd: null,
    // Entitlement — required on the gate since the re-sync (a free workspace still
    // gets the verdict, WITH the Team-gate notice). A Team fixture keeps the CI gate entitled.
    entitlement: {
      plan: 'team',
      gate_entitled: true,
      run_count_limit: null,
      run_count_used: null,
      max_candidates: null,
      max_items_per_call_type: null,
      notice: null,
    },
    call_types: [ct],
    reasons: ct.reasons,
  };
}

const BASE_OPTS: BenchRunOptions = {
  suite: 'checkout',
  budgetUsd: 3,
  gate: true,
  allowInconclusive: false,
  baseline: 'bench:main',
  costCeilingUsd: undefined,
  mode: undefined,
  selectionMode: undefined,
  runTag: 'abc123',
  captureCmd: undefined,
  json: false,
  waitTimeoutMs: undefined,
  pinBaseline: false,
};

function sink(): { log: (l: string) => void; err: (l: string) => void; out: string[] } {
  const out: string[] = [];
  return { log: (l) => out.push(l), err: () => {}, out };
}

describe('exitCodeFor + resolveBaseline (pure)', () => {
  it('maps the tri-state to exit codes (inconclusive gated by --allow-inconclusive)', () => {
    expect(exitCodeFor('pass', false)).toBe(0);
    expect(exitCodeFor('fail', false)).toBe(2);
    expect(exitCodeFor('inconclusive', false)).toBe(2);
    expect(exitCodeFor('inconclusive', true)).toBe(0);
    expect(exitCodeFor('error', true)).toBe(2); // an error is always fail-closed
  });

  it('resolves a br_* baseline ref to a concrete run; a symbolic ref uses the pinned baseline', () => {
    expect(resolveBaseline('br_123')).toEqual({
      compare: true,
      baselineRunId: 'br_123',
      ref: 'br_123',
    });
    expect(resolveBaseline('bench:main')).toEqual({
      compare: true,
      baselineRunId: undefined,
      ref: 'bench:main',
    });
    expect(resolveBaseline(undefined)).toEqual({
      compare: false,
      baselineRunId: undefined,
      ref: null,
    });
  });
});

describe('ur bench run — gate exit codes', () => {
  it('a green fixture ⇒ exit 0', async () => {
    const { fetch } = stubGateway({ gate: gate('pass') });
    const io = sink();
    const res = await runBench({ client: makeClient(fetch), ...io }, BASE_OPTS);
    expect(res.exitCode).toBe(0);
    expect(res.json.verdict).toBe('pass');
  });

  it('a regression fixture ⇒ exit 2 with a named cause', async () => {
    const { fetch } = stubGateway({
      gate: gate('fail', { verdict: 'fail', quality: 'fail', reasons: ['quality_regression'] }),
    });
    const io = sink();
    const res = await runBench({ client: makeClient(fetch), ...io }, BASE_OPTS);
    expect(res.exitCode).toBe(2);
    expect(res.json.verdict).toBe('fail');
    expect(res.json.gate?.call_types[0]?.reasons).toContain('quality_regression');
  });

  it('inconclusive ⇒ exit 2 by default, exit 0 with --allow-inconclusive', async () => {
    const stub = stubGateway({ gate: gate('inconclusive') });
    const strict = await runBench({ client: makeClient(stub.fetch), ...sink() }, BASE_OPTS);
    expect(strict.exitCode).toBe(2);
    const lax = await runBench(
      { client: makeClient(stub.fetch), ...sink() },
      { ...BASE_OPTS, allowInconclusive: true },
    );
    expect(lax.exitCode).toBe(0);
    expect(lax.json.verdict).toBe('inconclusive');
  });

  it('a cost-ceiling breach ⇒ exit 2 independent of quality', async () => {
    const { fetch } = stubGateway({
      gate: gate('fail', {
        verdict: 'fail',
        quality: 'pass',
        cost: 'fail',
        cost_ceiling: {
          enabled: true,
          ceiling_micro_usd: 1_000_000,
          observed_mean_micro_usd: 1_200_000,
          breached: true,
        },
        reasons: ['cost_ceiling_breach'],
      }),
    });
    const res = await runBench({ client: makeClient(fetch), ...sink() }, BASE_OPTS);
    expect(res.exitCode).toBe(2);
    expect(res.json.gate?.call_types[0]?.cost_ceiling.breached).toBe(true);
  });

  it('fails CLOSED (exit 2) on an API error', async () => {
    for (const failOn of ['freeze', 'run', 'gate'] as const) {
      const { fetch } = stubGateway({ gate: gate('pass'), failOn });
      const res = await runBench({ client: makeClient(fetch), ...sink() }, BASE_OPTS);
      expect(res.exitCode, `failOn=${failOn}`).toBe(2);
      expect(res.json.verdict).toBe('error');
    }
  });

  it('respects the --budget flag end-to-end (the trigger body carries max_cost_usd)', async () => {
    const { fetch, calls } = stubGateway({ gate: gate('pass') });
    await runBench({ client: makeClient(fetch), ...sink() }, { ...BASE_OPTS, budgetUsd: 7 });
    const trigger = calls.find((c) => c.url.endsWith('/runs'));
    expect((trigger?.body as { max_cost_usd?: number }).max_cost_usd).toBe(7);
    expect((trigger?.body as { compare?: boolean }).compare).toBe(true);
  });

  it('a deduped capture re-run still gates correctly (idempotent CI re-run)', async () => {
    const { fetch } = stubGateway({ gate: gate('pass'), deduped: true });
    const res = await runBench({ client: makeClient(fetch), ...sink() }, BASE_OPTS);
    // The server-side gate follows the linked prior run; the CLI gates the effective run either way.
    expect(res.exitCode).toBe(0);
    expect(res.json.verdict).toBe('pass');
  });

  it('--gate without a baseline is a fail-closed error (nothing to compare)', async () => {
    const { fetch } = stubGateway({ gate: gate('pass') });
    const res = await runBench(
      { client: makeClient(fetch), ...sink() },
      { ...BASE_OPTS, baseline: undefined },
    );
    expect(res.exitCode).toBe(2);
    expect(res.json.verdict).toBe('error');
  });

  it('--capture runs the command with the bench env; a non-zero capture fails closed', async () => {
    const { fetch } = stubGateway({ gate: gate('pass') });
    const seen: Record<string, string>[] = [];
    const spawnCapture = async (_cmd: string, env: Record<string, string>): Promise<number> => {
      seen.push(env);
      return 0;
    };
    const ok = await runBench(
      { client: makeClient(fetch), spawnCapture, ...sink() },
      { ...BASE_OPTS, captureCmd: 'pnpm test:agent' },
    );
    expect(ok.exitCode).toBe(0);
    expect(seen[0]).toEqual({ UR_BENCH: 'checkout', UR_BENCH_RUN: 'abc123' });

    const fail = await runBench(
      { client: makeClient(fetch), spawnCapture: async () => 1, ...sink() },
      { ...BASE_OPTS, captureCmd: 'exit 1' },
    );
    expect(fail.exitCode).toBe(2);
    expect(fail.json.verdict).toBe('error');
  });

  it('--pin-baseline advances the baseline only on a pass', async () => {
    const { fetch, calls } = stubGateway({ gate: gate('pass') });
    await runBench({ client: makeClient(fetch), ...sink() }, { ...BASE_OPTS, pinBaseline: true });
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/baseline'))).toBe(true);

    const { fetch: f2, calls: c2 } = stubGateway({ gate: gate('fail', { verdict: 'fail' }) });
    await runBench({ client: makeClient(f2), ...sink() }, { ...BASE_OPTS, pinBaseline: true });
    expect(c2.some((c) => c.url.endsWith('/baseline'))).toBe(false); // never pin on a fail
  });
});

describe('ur bench run — versioned --json (snapshot)', () => {
  it('builds a stable, versioned JSON object', () => {
    const json = buildGateJson({
      suite: 'checkout',
      runTag: 'abc123',
      benchRunId: 'br_run1',
      baseline: resolveBaseline('bench:main'),
      verdict: 'pass',
      allowInconclusive: false,
      gate: gate('pass'),
    });
    expect(json.schema).toBe(GATE_JSON_SCHEMA);
    expect(json).toMatchSnapshot();
  });
});

// --- ur import — the history importer CLI, unit-tested against a stub ---------------

/** A stub /v1/imports gateway: returns the `{ import }` envelope, or a 403 when `fail`. */
function importStub(opts: { status?: string; fail?: boolean } = {}): {
  fetch: FetchLike;
  calls: Recorded[];
} {
  const calls: Recorded[] = [];
  const fetch: FetchLike = async (url, init) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    calls.push({
      url: u,
      method,
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    const json = (body: unknown, status = 200): Response =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    if (opts.fail)
      return json({ error: { code: 'forbidden', message: 'no consent', type: 'forbidden' } }, 403);
    return json({
      import: {
        object: 'import',
        id: 'imp_1',
        format: 'usage_summary',
        format_version: '1',
        import_class: 'usage_only',
        status: opts.status ?? 'completed',
        key_mode: 'test',
        corrections_consent: false,
        record_count: 1,
        accepted_count: 1,
        duplicate_count: 0,
        rejected_count: 0,
        unsupported_count: 0,
        report: {},
        created_at: 't',
        updated_at: 't',
      },
    });
  };
  return { fetch, calls };
}

const IMPORT_OPTS: ImportRunOptions = {
  file: 'export.json',
  format: 'usage_summary',
  formatVersion: undefined,
  preview: false,
  resumeId: undefined,
  json: false,
};

describe('ur import — the history importer CLI', () => {
  it('reads a JSON array file and POSTs `records` (commit) ⇒ exit 0', async () => {
    const { fetch, calls } = importStub();
    const res = await runImport(
      { client: makeClient(fetch), readFile: () => '[{"model":"m","requests":1}]', ...sink() },
      IMPORT_OPTS,
    );
    expect(res.exitCode).toBe(0);
    const post = calls.find((c) => c.url.endsWith('/v1/imports'));
    expect(post?.method).toBe('POST');
    expect((post?.body as { records?: unknown[] }).records).toEqual([{ model: 'm', requests: 1 }]);
    expect((post?.body as { mode?: string }).mode).toBe('commit');
    expect((post?.body as { format?: string }).format).toBe('usage_summary');
  });

  it('JSONL input is sent as the `jsonl` field (never `records`)', async () => {
    const { fetch, calls } = importStub();
    const res = await runImport(
      { client: makeClient(fetch), readFile: () => '{"a":1}\n{"a":2}\n', ...sink() },
      IMPORT_OPTS,
    );
    expect(res.exitCode).toBe(0);
    const post = calls.find((c) => c.url.endsWith('/v1/imports'));
    expect((post?.body as { jsonl?: string }).jsonl).toBe('{"a":1}\n{"a":2}\n');
    expect((post?.body as { records?: unknown[] }).records).toBeUndefined();
  });

  it('--preview carries mode=preview (nothing stored)', async () => {
    const { fetch, calls } = importStub({ status: 'preview' });
    await runImport(
      { client: makeClient(fetch), readFile: () => '[]', ...sink() },
      { ...IMPORT_OPTS, preview: true },
    );
    const post = calls.find((c) => c.url.endsWith('/v1/imports'));
    expect((post?.body as { mode?: string }).mode).toBe('preview');
  });

  it('--call-type binds the import to a call type (call_type_id); omitted otherwise', async () => {
    const { fetch, calls } = importStub();
    await runImport(
      { client: makeClient(fetch), readFile: () => '[]', ...sink() },
      { ...IMPORT_OPTS, callTypeId: 'ct_invoice' },
    );
    await runImport({ client: makeClient(fetch), readFile: () => '[]', ...sink() }, IMPORT_OPTS);
    const posts = calls.filter((c) => c.url.endsWith('/v1/imports'));
    expect((posts[0]?.body as { call_type_id?: string }).call_type_id).toBe('ct_invoice');
    expect(posts[1]?.body).not.toHaveProperty('call_type_id');
  });

  it('a missing file path is a usage error (exit 1)', async () => {
    const { fetch } = importStub();
    const res = await runImport(
      { client: makeClient(fetch), readFile: () => '', ...sink() },
      { ...IMPORT_OPTS, file: undefined },
    );
    expect(res.exitCode).toBe(1);
  });

  it('a read error fails CLOSED (exit 2), never a silent success', async () => {
    const { fetch } = importStub();
    const res = await runImport(
      {
        client: makeClient(fetch),
        readFile: () => {
          throw new Error('ENOENT');
        },
        ...sink(),
      },
      IMPORT_OPTS,
    );
    expect(res.exitCode).toBe(2);
  });

  it('an API error (403 no-consent) fails CLOSED (exit 2)', async () => {
    const { fetch } = importStub({ fail: true });
    const res = await runImport(
      { client: makeClient(fetch), readFile: () => '[]', ...sink() },
      IMPORT_OPTS,
    );
    expect(res.exitCode).toBe(2);
  });

  it('a terminal `failed` import fails CLOSED (exit 2)', async () => {
    const { fetch } = importStub({ status: 'failed' });
    const res = await runImport(
      { client: makeClient(fetch), readFile: () => '[]', ...sink() },
      IMPORT_OPTS,
    );
    expect(res.exitCode).toBe(2);
  });
});
