// A hermetic stub gateway for the CLI battery. It serves the
// outcome-batch / pending / flywheel-status / import routes over REAL HTTP so the battery can drive
// the REAL built `ur` bin and assert its PROCESS exit codes. It models the server idempotency
// (`(target, kind, source_event_id)`) so a re-imported file is all DUPLICATES ("re-runs are free"),
// rejects a row whose target key contains `bad` (the partial-rejection path), and 403s any request
// whose Bearer token contains `denied` (the fail-closed path). NEVER logs a body.
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashEvent(event) {
  return createHash('sha256').update(canonical(event)).digest('hex');
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw === '' ? {} : JSON.parse(raw);
}

/** Record one batch event under the server idempotency key → accepted | duplicate | conflict | rejected. */
function recordBatch(seen, event) {
  const target = event.request_id ?? event.artifact_id ?? event.artifact_key ?? 'x';
  if (typeof target === 'string' && target.includes('bad')) {
    return {
      status: 'rejected',
      id: null,
      source_event_id: event.source_event_id ?? null,
      canonical_target_id: target,
      target_kind: 'artifact',
      artifact_version: event.artifact_version ?? null,
      latency_class: null,
      source: null,
      learning_use: null,
      reason: 'unresolvable_target',
      key: target,
    };
  }
  const key = `${target}:${event.kind}:${event.source_event_id}`;
  const hash = hashEvent(event);
  const prior = seen.get(key);
  const same = prior === hash;
  if (prior === undefined) seen.set(key, hash);
  return {
    status: prior === undefined ? 'accepted' : same ? 'duplicate' : 'conflict',
    id: prior === undefined || same ? `oev_${randomUUID().slice(0, 8)}` : null,
    source_event_id: event.source_event_id ?? null,
    canonical_target_id: target,
    target_kind: 'artifact',
    artifact_version: event.artifact_version ?? 1,
    latency_class: event.observed_at ? 'delayed' : 'instant',
    source: prior === undefined || same ? 'declared' : null,
    learning_use: prior === undefined || same ? ['calibrate'] : null,
    reason: same || prior === undefined ? null : 'same idempotency key, different payload',
    key: target,
  };
}

function flywheelStatus() {
  return {
    object: 'flywheel_status',
    workspace_id: 'ws_cli',
    usage: {
      period: '2026-09-01',
      tracked_artifacts: 2,
      accepted_outcomes: 1,
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
      { channel: 'behavioral', accepted_outcomes: 1, last_observed_at: '2026-09-14T00:00:00Z' },
    ],
    imports: { total: 0, completed: 0, running: 0, failed: 0, last_import_at: null },
    learning: {
      flywheel_class: 'unavailable',
      flywheel_class_reason: 'collecting',
      active_levers: [],
      calibration_available: false,
    },
  };
}

function makeImport(body, records) {
  const n = records.length;
  return {
    object: 'import',
    id: `imp_${randomUUID().slice(0, 8)}`,
    format: body.format ?? 'usage_summary',
    format_version: body.format_version ?? '1',
    import_class: 'usage_only',
    status: body.mode === 'preview' ? 'preview' : 'completed',
    key_mode: 'test',
    corrections_consent: false,
    record_count: n,
    accepted_count: n,
    duplicate_count: 0,
    rejected_count: 0,
    unsupported_count: 0,
    report: { class_truth: 'usage-only summaries: no body.', bodies_stored: 0, replayable: false },
    created_at: '2026-09-14T00:00:00Z',
    updated_at: '2026-09-14T00:00:00Z',
  };
}

/** Start the stub. Resolves `{ url, close, calls, seen, imports }`. */
export function startCliStub() {
  const calls = [];
  const seen = new Map();
  /** Every POST /v1/imports body, in order. */
  const imports = [];

  const server = createServer((req, res) => {
    const send = (obj, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    void (async () => {
      const url = req.url ?? '';
      const method = req.method ?? 'GET';
      const path = url.split('?')[0];
      const auth = req.headers.authorization ?? '';
      const body = method === 'GET' ? undefined : await readJson(req);
      calls.push({ method, path, url });

      // Fail-closed path: a "denied" key is a 403 on every route (fail-closed exit 2).
      if (auth.includes('denied')) {
        return send(
          { error: { code: 'forbidden', message: 'denied (stub)', type: 'forbidden' } },
          403,
        );
      }

      if (method === 'POST' && path === '/v1/outcomes/batch') {
        const events = body.outcomes ?? [];
        const data = events.map((e) => recordBatch(seen, e));
        const roll = { accepted: 0, duplicate: 0, conflict: 0, rejected: 0 };
        for (const d of data) roll[d.status] += 1;
        return send({ object: 'list', data, ...roll });
      }

      if (method === 'GET' && path === '/v1/outcomes/pending') {
        const state = new URLSearchParams(url.split('?')[1] ?? '').get('state') ?? 'pending';
        return send({
          object: 'list',
          data: [
            {
              id: 'clm_cli',
              artifact_id: 'art_cli',
              artifact_key: 'thesis:acme',
              archetype: 'forecast',
              claim_key: 'eps_beat',
              claim_type: 'earnings_direction',
              state,
              stated_confidence: 0.7,
              resolves_by: '2026-12-31T00:00:00Z',
              occurred_at: '2026-09-14T00:00:00Z',
              created_at: '2026-09-14T00:00:00Z',
            },
          ],
          next_cursor: null,
        });
      }

      if (method === 'GET' && path === '/v1/flywheel/status') {
        return send(flywheelStatus());
      }

      if (method === 'POST' && path === '/v1/imports') {
        imports.push(body);
        const records = Array.isArray(body.records)
          ? body.records
          : typeof body.jsonl === 'string'
            ? body.jsonl.split('\n').filter((l) => l.trim() !== '')
            : [];
        return send({ import: makeImport(body, records) });
      }

      return send({ error: { code: 'not_found', message: 'no route', type: 'not_found' } }, 404);
    })().catch((err) => send({ error: { code: 'internal', message: String(err) } }, 500));
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => server.close(),
        calls,
        seen,
        imports,
      });
    });
  });
}
