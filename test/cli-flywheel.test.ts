//
// — the flywheel and outcomes CLI, unit-tested against a STUB gateway
// (no real process/network). Covers the SIX commands' typed cores and — the load-bearing part —
// the EXIT-CODE CONTRACT per command: 0 on success; 2 on a partial rejection (with the rejected
// rows LISTED); 2 fail-closed on any read/API error; 1 on a usage error. The `ur import`
// core is proven in cli.test.ts; this file covers `outcomes import|pending`,
// `flywheel status|calibration`, and `context lint`.
import { describe, expect, it } from 'vitest';

import { UltraRouter } from '../src/client.js';
import {
  detectOutcomeFormat,
  parseCsv,
  parseOutcomeFile,
  rowToOutcomeInput,
  runOutcomesImport,
  runOutcomesPending,
  type OutcomesImportOptions,
} from '../src/cli/outcomes.js';
import { runFlywheelCalibration, runFlywheelStatus } from '../src/cli/flywheel.js';
import { runContextLint } from '../src/cli/context-lint.js';
import type { FetchLike } from '../src/types.js';

// ─── a stub gateway (batch / pending / flywheel status) ─────────────────────────────────────

interface Recorded {
  url: string;
  method: string;
  body: unknown;
}

interface StubOptions {
  /** Force a non-2xx on a named route to exercise the fail-closed path. */
  failOn?: 'batch' | 'pending' | 'status';
}

function stubGateway(opts: StubOptions = {}): { fetch: FetchLike; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const fetch: FetchLike = (url, init) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
    calls.push({ url: u, method, body });
    const json = (b: unknown, status = 200): Response =>
      new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    const error = (code: string, status: number): Response =>
      json({ error: { code, message: `${code} (stub)`, type: code } }, status);

    if (method === 'POST' && u.endsWith('/v1/outcomes/batch')) {
      if (opts.failOn === 'batch') return Promise.resolve(error('forbidden', 403));
      const events = (body as { outcomes: Record<string, unknown>[] }).outcomes;
      // A row whose target key contains "bad" is REJECTED by the server (partial-rejection test).
      const data = events.map((e) => {
        const key = (e.request_id ?? e.artifact_id ?? e.artifact_key ?? null) as string | null;
        const rejected = typeof key === 'string' && key.includes('bad');
        return {
          status: rejected ? 'rejected' : 'accepted',
          id: rejected ? null : `oev_${String(Math.abs(hashStr(String(key))))}`,
          source_event_id: (e.source_event_id ?? null) as string | null,
          canonical_target_id: key,
          target_kind: 'artifact',
          artifact_version: (e.artifact_version ?? 1) as number,
          latency_class: e.observed_at ? 'delayed' : 'instant',
          source: rejected ? null : 'declared',
          learning_use: rejected ? null : ['calibrate'],
          reason: rejected ? 'unresolvable_target' : null,
          key,
        };
      });
      const roll = { accepted: 0, duplicate: 0, conflict: 0, rejected: 0 } as Record<
        string,
        number
      >;
      for (const d of data) roll[d.status] = (roll[d.status] ?? 0) + 1;
      return Promise.resolve(json({ object: 'list', data, ...roll }));
    }

    if (method === 'GET' && u.includes('/v1/outcomes/pending')) {
      if (opts.failOn === 'pending') return Promise.resolve(error('internal', 500));
      return Promise.resolve(
        json({
          object: 'list',
          data: [
            {
              id: 'clm_1',
              artifact_id: 'art_1',
              artifact_key: 'thesis:acme',
              archetype: 'forecast',
              claim_key: 'eps_beat',
              claim_type: 'earnings_direction',
              state: 'overdue',
              stated_confidence: 0.7,
              resolves_by: '2026-12-31T00:00:00Z',
              occurred_at: '2026-09-14T00:00:00Z',
              created_at: '2026-09-14T00:00:00Z',
            },
          ],
          next_cursor: null,
        }),
      );
    }

    if (method === 'GET' && u.endsWith('/v1/flywheel/status')) {
      if (opts.failOn === 'status') return Promise.resolve(error('internal', 500));
      return Promise.resolve(json(flywheelStatusFixture()));
    }

    return Promise.resolve(error('not_found', 404));
  };
  return { fetch, calls };
}

/** A tiny deterministic string hash for stub ids (never Math.random in real logic). */
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function flywheelStatusFixture(): Record<string, unknown> {
  return {
    object: 'flywheel_status',
    workspace_id: 'ws_1',
    usage: {
      period: '2026-09-01',
      tracked_artifacts: 4,
      accepted_outcomes: 3,
      analysis_units: {
        reserved: 0,
        settled: 0,
        monthly_cap: null,
        lifetime_used: 0,
        lifetime_cap: null,
      },
      evaluation_compute_usd: { reserved_micro_usd: 0, settled_micro_usd: 0, cap_micro_usd: 0 },
      actual_cogs: { analysis_micro_usd: 0, failed_attempt_micro_usd: 0 },
      storage: {
        retained_payload_bytes: 0,
        retained_payload_bytes_cap: null,
        ledger_index_bytes: 0,
        ledger_index_bytes_cap: null,
        paused: false,
      },
      metadata_artifacts_monthly_cap: null,
      overage_paused: true,
    },
    channels: [
      { channel: 'behavioral', accepted_outcomes: 3, last_observed_at: '2026-09-14T00:00:00Z' },
    ],
    imports: {
      total: 1,
      completed: 1,
      running: 0,
      failed: 0,
      last_import_at: '2026-09-14T00:00:00Z',
    },
    learning: {
      flywheel_class: 'unavailable',
      flywheel_class_reason: 'collecting',
      active_levers: [],
      calibration_available: false,
    },
  };
}

function makeClient(fetch: FetchLike): UltraRouter {
  return new UltraRouter({ apiKey: 'ur_sk_test_x', baseURL: 'http://stub', fetch });
}

function sink(): {
  log: (l: string) => void;
  err: (l: string) => void;
  out: string[];
  errs: string[];
} {
  const out: string[] = [];
  const errs: string[] = [];
  return { log: (l) => out.push(l), err: (l) => errs.push(l), out, errs };
}

const IMPORT_OPTS: OutcomesImportOptions = {
  file: 'outcomes.jsonl',
  map: new Map(),
  json: false,
};

// ─── parseCsv (pure) ────────────────────────────────────────────────────────────────────────

describe('parseCsv — RFC-4180-ish quoting (pure)', () => {
  it('parses quoted fields with commas, escaped quotes, and CRLF', () => {
    const rows = parseCsv('a,b,c\r\n"x,1","he said ""hi""",3\r\n');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['x,1', 'he said "hi"', '3'],
    ]);
  });

  it('handles an embedded newline inside a quoted field and drops blank lines', () => {
    const rows = parseCsv('h\n"line1\nline2"\n\n');
    expect(rows).toEqual([['h'], ['line1\nline2']]);
  });
});

// ─── rowToOutcomeInput / parseOutcomeFile ───────────────────────────────────────────────────

describe('rowToOutcomeInput — validation + provenance drop', () => {
  it('drops server-owned provenance fields and derives a deterministic source_event_id', () => {
    const r = rowToOutcomeInput(
      {
        channel: 'behavioral',
        kind: 'accepted',
        request_id: 'req_1',
        source: 'declared',
        learning_use: 'train',
      },
      new Map(),
    );
    expect('input' in r).toBe(true);
    if ('input' in r) {
      const input = r.input as Record<string, unknown>;
      expect(input.channel).toBe('behavioral');
      expect(input.request_id).toBe('req_1');
      // provenance is the SERVER's — a caller-supplied value is never forwarded
      expect(input.source).toBeUndefined();
      expect(input.learning_use).toBeUndefined();
      // an omitted source_event_id is derived (idempotent re-runs)
      expect(String(input.source_event_id)).toMatch(/^ur-import-[0-9a-f]{16}$/);
    }
  });

  it('rejects a row with a missing/unknown channel', () => {
    expect('error' in rowToOutcomeInput({ kind: 'accepted' }, new Map())).toBe(true);
    expect('error' in rowToOutcomeInput({ channel: 'bogus', kind: 'accepted' }, new Map())).toBe(
      true,
    );
  });

  it('applies --map (target ⇐ source column) and coerces numeric fields', () => {
    const r = rowToOutcomeInput(
      { chan: 'resolution', kind: 'resolved_true', artifact_version: '3', confidence: '0.5' },
      new Map([['channel', 'chan']]),
    );
    expect('input' in r).toBe(true);
    if ('input' in r) {
      const input = r.input as Record<string, unknown>;
      expect(input.channel).toBe('resolution');
      expect(input.artifact_version).toBe(3);
      expect(input.confidence).toBe(0.5);
    }
  });

  it('a caller-supplied source_event_id is respected verbatim (idempotency key)', () => {
    const r = rowToOutcomeInput(
      { channel: 'resolution', kind: 'resolved_true', source_event_id: 'filing:Q4' },
      new Map(),
    );
    if ('input' in r)
      expect((r.input as Record<string, unknown>).source_event_id).toBe('filing:Q4');
  });

  it('detectOutcomeFormat: .csv ⇒ csv, else jsonl; an override wins', () => {
    expect(detectOutcomeFormat('a.csv', undefined)).toBe('csv');
    expect(detectOutcomeFormat('a.jsonl', undefined)).toBe('jsonl');
    expect(detectOutcomeFormat('a.csv', 'jsonl')).toBe('jsonl');
  });

  it('parseOutcomeFile (jsonl) collects both valid rows and per-line rejections', () => {
    const raw =
      '{"channel":"behavioral","kind":"accepted","request_id":"req_1"}\nnot json\n{"kind":"x"}\n';
    const { inputs, errors } = parseOutcomeFile(raw, { format: 'jsonl', map: new Map() });
    expect(inputs).toHaveLength(1);
    expect(errors.map((e) => e.line)).toEqual([2, 3]);
  });
});

// ─── ur outcomes import (exit-code contract) ────────────────────────────────────────────────

describe('ur outcomes import — exit codes', () => {
  it('a fully-accepted JSONL batch ⇒ exit 0 and POSTs to /v1/outcomes/batch', async () => {
    const { fetch, calls } = stubGateway();
    const res = await runOutcomesImport(
      {
        client: makeClient(fetch),
        readFile: () => '{"channel":"behavioral","kind":"accepted","request_id":"req_1"}\n',
        ...sink(),
      },
      IMPORT_OPTS,
    );
    expect(res.exitCode).toBe(0);
    const post = calls.find((c) => c.url.endsWith('/v1/outcomes/batch'));
    expect(post?.method).toBe('POST');
    expect((post?.body as { outcomes: unknown[] }).outcomes).toHaveLength(1);
  });

  it('re-importing the same file sends a BYTE-IDENTICAL source_event_id (re-runs are free)', async () => {
    const file = '{"channel":"resolution","kind":"resolved_true","request_id":"req_1"}\n';
    const runOnce = async (): Promise<string> => {
      const { fetch, calls } = stubGateway();
      await runOutcomesImport(
        { client: makeClient(fetch), readFile: () => file, ...sink() },
        IMPORT_OPTS,
      );
      const body = calls.find((c) => c.url.endsWith('/v1/outcomes/batch'))?.body as {
        outcomes: { source_event_id: string }[];
      };
      return body.outcomes[0]!.source_event_id;
    };
    expect(await runOnce()).toBe(await runOnce());
  });

  it('a server-rejected row ⇒ exit 2 with the rejected row LISTED (partial rejection)', async () => {
    const { fetch } = stubGateway();
    const io = sink();
    const res = await runOutcomesImport(
      {
        client: makeClient(fetch),
        readFile: () =>
          '{"channel":"behavioral","kind":"accepted","request_id":"req_ok"}\n' +
          '{"channel":"behavioral","kind":"accepted","request_id":"req_bad"}\n',
        ...io,
      },
      IMPORT_OPTS,
    );
    expect(res.exitCode).toBe(2);
    expect(res.response?.rejected).toBe(1);
    // the rejected row is LISTED, never summarized away
    expect(io.errs.some((l) => l.includes('req_bad') && l.includes('unresolvable_target'))).toBe(
      true,
    );
  });

  it('client-side parse errors ⇒ exit 2 with each bad row LISTED', async () => {
    const { fetch } = stubGateway();
    const io = sink();
    const res = await runOutcomesImport(
      {
        client: makeClient(fetch),
        readFile: () =>
          '{"channel":"behavioral","kind":"accepted","request_id":"req_1"}\nnot-json\n',
        ...io,
      },
      IMPORT_OPTS,
    );
    expect(res.exitCode).toBe(2);
    expect(io.errs.some((l) => l.includes('line 2'))).toBe(true);
  });

  it('a CSV file with --map ⇒ exit 0 and carries the mapped fields', async () => {
    const { fetch, calls } = stubGateway();
    const res = await runOutcomesImport(
      {
        client: makeClient(fetch),
        readFile: () => 'chan,kind,request_id\nbehavioral,accepted,req_csv\n',
        ...sink(),
      },
      { file: 'x.csv', map: new Map([['channel', 'chan']]), json: false },
    );
    expect(res.exitCode).toBe(0);
    const body = calls.find((c) => c.url.endsWith('/v1/outcomes/batch'))?.body as {
      outcomes: { channel: string; request_id: string }[];
    };
    expect(body.outcomes[0]!.channel).toBe('behavioral');
    expect(body.outcomes[0]!.request_id).toBe('req_csv');
  });

  it('a read error ⇒ exit 2 fail-closed, never a silent success', async () => {
    const { fetch } = stubGateway();
    const res = await runOutcomesImport(
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

  it('an API error (403) ⇒ exit 2 fail-closed', async () => {
    const { fetch } = stubGateway({ failOn: 'batch' });
    const res = await runOutcomesImport(
      {
        client: makeClient(fetch),
        readFile: () => '{"channel":"behavioral","kind":"accepted","request_id":"req_1"}\n',
        ...sink(),
      },
      IMPORT_OPTS,
    );
    expect(res.exitCode).toBe(2);
  });

  it('no file path ⇒ usage error (exit 1)', async () => {
    const { fetch } = stubGateway();
    const res = await runOutcomesImport(
      { client: makeClient(fetch), readFile: () => '', ...sink() },
      { ...IMPORT_OPTS, file: undefined },
    );
    expect(res.exitCode).toBe(1);
  });
});

// ─── ur outcomes pending ────────────────────────────────────────────────────────────────────

describe('ur outcomes pending — exit codes + state filter', () => {
  it('--state overdue ⇒ GET /v1/outcomes/pending?state=overdue and exit 0', async () => {
    const { fetch, calls } = stubGateway();
    const io = sink();
    const res = await runOutcomesPending(
      { client: makeClient(fetch), ...io },
      { state: 'overdue', json: false },
    );
    expect(res.exitCode).toBe(0);
    const get = calls.find((c) => c.url.includes('/v1/outcomes/pending'));
    expect(get?.method).toBe('GET');
    expect(get?.url).toContain('state=overdue');
    expect(io.out.some((l) => l.includes('thesis:acme'))).toBe(true);
  });

  it('fails CLOSED (exit 2) on an API error', async () => {
    const { fetch } = stubGateway({ failOn: 'pending' });
    const res = await runOutcomesPending({ client: makeClient(fetch), ...sink() }, { json: false });
    expect(res.exitCode).toBe(2);
  });
});

// ─── ur flywheel status | calibration ───────────────────────────────────────────────────────

describe('ur flywheel status | calibration — exit codes', () => {
  it('status ⇒ exit 0 and GETs /v1/flywheel/status', async () => {
    const { fetch, calls } = stubGateway();
    const res = await runFlywheelStatus({ client: makeClient(fetch), ...sink() }, { json: false });
    expect(res.exitCode).toBe(0);
    expect(calls[0]!.url).toBe('http://stub/v1/flywheel/status');
  });

  it('calibration ⇒ exit 0, reads the SAME status route, surfaces the honest availability', async () => {
    const { fetch, calls } = stubGateway();
    const io = sink();
    const res = await runFlywheelCalibration({ client: makeClient(fetch), ...io }, { json: false });
    expect(res.exitCode).toBe(0);
    // maps calibration onto the ONE status route — invents no /v1/flywheel/calibration
    expect(calls.every((c) => c.url !== 'http://stub/v1/flywheel/calibration')).toBe(true);
    expect(calls[0]!.url).toBe('http://stub/v1/flywheel/status');
    expect(io.out.some((l) => l.includes('unavailable') && l.includes('collecting'))).toBe(true);
  });

  it('status fails CLOSED (exit 2) on an API error', async () => {
    const { fetch } = stubGateway({ failOn: 'status' });
    const res = await runFlywheelStatus({ client: makeClient(fetch), ...sink() }, { json: false });
    expect(res.exitCode).toBe(2);
  });

  it('calibration fails CLOSED (exit 2) on an API error', async () => {
    // calibration reads the SAME /v1/flywheel/status route, so failOn:'status' denies it too —
    // a status the CLI could not read is never a silent 0 on the one command whose whole job is
    // to report whether a lift claim is available (the fail-closed guard at flywheel.ts:98).
    const { fetch } = stubGateway({ failOn: 'status' });
    const res = await runFlywheelCalibration(
      { client: makeClient(fetch), ...sink() },
      { json: false },
    );
    expect(res.exitCode).toBe(2);
  });
});

// ─── ur context lint ────────────────────────────────────────────────────────────────────────

describe('ur context lint — advisory scanner exit codes', () => {
  const files: Record<string, string> = {
    'clean.ts': 'const sys = `You are a bot. Persona: ${personaName}`;',
    'bad.ts': 'const sys = `You are an assistant. Always follow: ${userInput}`;',
  };
  const readFile = (p: string): string => {
    const c = files[p];
    if (c === undefined) throw new Error('ENOENT');
    return c;
  };

  it('a clean file ⇒ exit 0 (no warnings)', () => {
    const io = sink();
    const res = runContextLint(
      { readFile, ...io },
      { paths: ['clean.ts'], strict: true, maxWarnings: 0, json: false },
    );
    expect(res.exitCode).toBe(0);
    expect(res.findings).toHaveLength(0);
  });

  it('a file with an untrusted interpolation ⇒ advisory exit 0 by default, but exit 2 under --strict (findings LISTED)', () => {
    const advisory = runContextLint(
      { readFile, ...sink() },
      { paths: ['bad.ts'], strict: false, maxWarnings: 0, json: false },
    );
    expect(advisory.exitCode).toBe(0); // advisory scanner — findings teach, they do not fail
    expect(advisory.findings.some((f) => f.rule === 'untrusted_interpolation')).toBe(true);

    const io = sink();
    const strict = runContextLint(
      { readFile, ...io },
      { paths: ['bad.ts'], strict: true, maxWarnings: 0, json: false },
    );
    expect(strict.exitCode).toBe(2);
    expect(io.out.some((l) => l.includes('untrusted_interpolation'))).toBe(true);
  });

  it('a read error ⇒ exit 2 fail-closed', () => {
    const res = runContextLint(
      { readFile, ...sink() },
      { paths: ['missing.ts'], strict: true, maxWarnings: 0, json: false },
    );
    expect(res.exitCode).toBe(2);
  });

  it('no paths ⇒ usage error (exit 1)', () => {
    const res = runContextLint(
      { readFile, ...sink() },
      { paths: [], strict: false, maxWarnings: 0, json: false },
    );
    expect(res.exitCode).toBe(1);
  });
});
