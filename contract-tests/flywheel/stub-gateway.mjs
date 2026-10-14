// A hermetic stub gateway for the outcome-ledger battery. It serves the artifact-type / artifact /
// outcome routes over real HTTP and implements the server's `(target, kind, source_event_id)`
// idempotency, so the battery can prove the retry rule end to end: a verbatim replay is a DUPLICATE, a same-key different-payload is a
// CONFLICT. It records every request for assertions and can inject a one-shot "recorded, then 503"
// failure (the classic "inserted, response lost" case the retry guarantee exists for). NEVER logs a body.
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

/** Canonical JSON (sorted keys) so a verbatim replay hashes identically and a mutation does not. */
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

/**
 * Record one outcome event under the server idempotency key. Returns the per-event result verdict
 * (`accepted` | `duplicate` | `conflict`). `seen` is the Map<key, hash> that models the ledger.
 */
function recordOutcome(seen, targetId, event) {
  const key = `${targetId}:${event.kind}:${event.source_event_id}`;
  const hash = hashEvent(event);
  const prior = seen.get(key);
  if (prior === undefined) {
    seen.set(key, hash);
    return {
      status: 'accepted',
      id: `oev_${randomUUID().slice(0, 8)}`,
      source_event_id: event.source_event_id ?? null,
      canonical_target_id: targetId,
      target_kind: 'artifact',
      artifact_version: event.artifact_version ?? 1,
      latency_class: event.observed_at ? 'delayed' : 'instant',
      source: 'declared',
      learning_use: ['calibrate'],
      reason: null,
    };
  }
  const same = prior === hash;
  return {
    status: same ? 'duplicate' : 'conflict',
    id: same ? `oev_${randomUUID().slice(0, 8)}` : null,
    source_event_id: event.source_event_id ?? null,
    canonical_target_id: targetId,
    target_kind: 'artifact',
    artifact_version: event.artifact_version ?? 1,
    latency_class: event.observed_at ? 'delayed' : 'instant',
    source: same ? 'declared' : null,
    learning_use: same ? ['calibrate'] : null,
    reason: same ? null : 'same idempotency key, different payload',
  };
}

/**
 * Build a usage-only import job. A usage-only import can never manufacture a
 * body — the capability report carries counts only (bodies_stored 0, replayable false).
 */
function makeImport(body, records, isPreview, id, status) {
  const n = records.length;
  const format = body.format ?? 'usage_summary';
  const formatVersion = body.format_version ?? '1';
  return {
    object: 'import',
    id: id ?? body.import_id ?? `imp_${randomUUID().slice(0, 8)}`,
    format,
    format_version: formatVersion,
    import_class: 'usage_only',
    status: status ?? (isPreview ? 'preview' : 'completed'),
    key_mode: 'test',
    corrections_consent: false,
    record_count: n,
    accepted_count: n,
    duplicate_count: 0,
    rejected_count: 0,
    unsupported_count: 0,
    report: {
      format,
      format_version: formatVersion,
      import_class: 'usage_only',
      class_truth: 'usage-only summaries: no prompt, output, quality figure or replayable case.',
      record_count: n,
      accepted: n,
      duplicate: 0,
      rejected: 0,
      unsupported: 0,
      redacted: 0,
      missing_lineage: 0,
      bodies_stored: 0,
      reasons: {},
      unsupported_fields: [],
      parse_errors: [],
      replayable: false,
      usage_exposure: [],
      spend_micro_usd: 0,
    },
    created_at: '2026-09-14T00:00:00Z',
    updated_at: '2026-09-14T00:00:00Z',
  };
}

/** Start the stub. Resolves `{ url, close, calls, failNextOutcome, seen }`. */
export function startFlywheelStub() {
  const calls = [];
  const seen = new Map();
  const importsStore = [];
  const state = { failNextOutcome: false };

  const server = createServer((req, res) => {
    const send = (obj, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    void (async () => {
      const url = req.url ?? '';
      const method = req.method ?? 'GET';
      const path = url.split('?')[0];
      const body = method === 'GET' ? undefined : await readJson(req);
      calls.push({ method, url, path, body });

      // Control endpoint (test harness only) — arm the one-shot recorded-then-503 failure.
      if (method === 'POST' && path === '/_control/fail-next-outcome') {
        state.failNextOutcome = true;
        return send({ ok: true });
      }

      if (method === 'POST' && path === '/v1/artifact-types') {
        return send({
          artifact_type: {
            object: 'artifact_type',
            id: `atv_${randomUUID().slice(0, 8)}`,
            name: body.name,
            archetype: body.archetype,
            version: 1,
            objective: body.objective,
            created_at: '2026-09-14T00:00:00Z',
          },
        });
      }

      if (method === 'POST' && path === '/v1/artifacts') {
        return send(
          {
            artifact: {
              object: 'artifact',
              id: 'art_ct',
              key: body.key,
              archetype: body.archetype ?? 'answer',
              artifact_type_version_id: body.artifact_type ? 'atv_ct' : null,
              call_type_id: null,
              situation_key: null,
              occurred_at: '2026-09-14T00:00:00Z',
              exposure_arm: 'pre_lever',
              exposure_epoch: 0,
              lifecycle: 'open',
              current_version: 1,
              request_ids: body.request_ids ?? [],
              claims: (body.claims ?? []).map((c, i) => ({
                id: `clm_${String(i)}`,
                claim_key: c.key,
                claim_type: c.claim_type,
                state: 'pending',
                state_version: 1,
                stated_confidence: c.stated_confidence ?? null,
                resolves_by: c.resolves_by ?? null,
                artifact_version: 1,
                created_at: '2026-09-14T00:00:00Z',
              })),
              created_at: '2026-09-14T00:00:00Z',
              updated_at: '2026-09-14T00:00:00Z',
            },
          },
          201,
        );
      }

      const getArtifact = path.match(/^\/v1\/artifacts\/([^/]+)$/);
      if (method === 'GET' && path === '/v1/artifacts') {
        return send({ object: 'list', data: [], next_cursor: null });
      }
      if (method === 'GET' && getArtifact) {
        return send({
          artifact: {
            object: 'artifact',
            id: decodeURIComponent(getArtifact[1]),
            key: 'thesis:ct',
            archetype: 'forecast',
            artifact_type_version_id: null,
            call_type_id: null,
            situation_key: null,
            occurred_at: '2026-09-14T00:00:00Z',
            exposure_arm: 'pre_lever',
            exposure_epoch: 0,
            lifecycle: 'open',
            current_version: 1,
            request_ids: [],
            claims: [],
            created_at: '2026-09-14T00:00:00Z',
            updated_at: '2026-09-14T00:00:00Z',
          },
        });
      }

      const finalMatch = path.match(/^\/v1\/artifacts\/([^/]+)\/final$/);
      if (method === 'POST' && finalMatch) {
        return send({
          object: 'artifact_version',
          id: 'av_ct',
          artifact_id: decodeURIComponent(finalMatch[1]),
          version: 2,
          final_hash: body.final_hash ?? body.diff_stats?.final_hash ?? null,
          diff_stats: body.diff_stats ?? {},
          client_computed: body.final === undefined,
          stored: body.final === undefined ? 'metadata_only' : 'blob',
          created_at: '2026-09-14T00:00:00Z',
        });
      }

      const outcomesMatch = path.match(/^\/v1\/artifacts\/([^/]+)\/outcomes$/);
      if (method === 'POST' && outcomesMatch) {
        const targetId = decodeURIComponent(outcomesMatch[1]);
        const events = body.outcomes ?? [];
        const data = events.map((e) => recordOutcome(seen, targetId, e));
        if (state.failNextOutcome) {
          // "Recorded, then the response is lost" — the event IS in the ledger, but we 503.
          state.failNextOutcome = false;
          return send({ error: { code: 'provider_unavailable', message: 'stub 503' } }, 503);
        }
        return send({ object: 'list', data }, 202);
      }

      const reqOutcome = path.match(/^\/v1\/requests\/([^/]+)\/outcomes$/);
      if (method === 'POST' && reqOutcome) {
        const targetId = decodeURIComponent(reqOutcome[1]);
        return send(recordOutcome(seen, targetId, body), 202);
      }

      if (method === 'POST' && path === '/v1/outcomes/batch') {
        const events = body.outcomes ?? [];
        const data = events.map((e) => ({
          ...recordOutcome(seen, e.artifact_id ?? e.request_id ?? e.artifact_key ?? 'x', e),
          key: e.request_id ?? e.artifact_id ?? e.artifact_key ?? null,
        }));
        const roll = { accepted: 0, duplicate: 0, conflict: 0, rejected: 0 };
        for (const d of data) roll[d.status] += 1;
        return send({ object: 'list', data, ...roll });
      }

      if (method === 'GET' && path === '/v1/outcomes/pending') {
        return send({ object: 'list', data: [], next_cursor: null });
      }

      // Flywheel status; calibration availability is the `learning` block (the SDK
      // reads THIS route for both status() and calibration(), inventing no calibration surface).
      if (method === 'GET' && path === '/v1/flywheel/status') {
        return send({
          object: 'flywheel_status',
          workspace_id: 'ws_ct',
          usage: {
            period: '2026-09-01',
            tracked_artifacts: 1,
            accepted_outcomes: 1,
            analysis_units: {
              reserved: 0,
              settled: 0,
              monthly_cap: null,
              lifetime_used: 0,
              lifetime_cap: null,
            },
            evaluation_compute_usd: {
              reserved_micro_usd: 0,
              settled_micro_usd: 0,
              cap_micro_usd: 0,
            },
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
            {
              channel: 'behavioral',
              accepted_outcomes: 1,
              last_observed_at: '2026-09-14T00:00:00Z',
            },
          ],
          imports: {
            total: importsStore.length,
            completed: importsStore.length,
            running: 0,
            failed: 0,
            last_import_at: importsStore.length > 0 ? '2026-09-14T00:00:00Z' : null,
          },
          learning: {
            flywheel_class: 'unavailable',
            flywheel_class_reason: 'collecting',
            active_levers: [],
            calibration_available: false,
          },
        });
      }

      // History imports (drives the EXISTING route). A usage-only import never
      // manufactures a body; preview stores nothing, commit ingests.
      if (method === 'POST' && path === '/v1/imports') {
        const isPreview = body.mode === 'preview';
        const records = Array.isArray(body.records)
          ? body.records
          : typeof body.jsonl === 'string'
            ? body.jsonl.split('\n').filter((l) => l.trim() !== '')
            : [];
        const imp = makeImport(body, records, isPreview);
        if (!isPreview) importsStore.push(imp);
        return send({ import: imp });
      }
      if (method === 'GET' && path === '/v1/imports') {
        return send({ object: 'list', data: importsStore, next_cursor: null });
      }
      const getImportMatch = path.match(/^\/v1\/imports\/([^/]+)$/);
      if (method === 'GET' && getImportMatch) {
        const id = decodeURIComponent(getImportMatch[1]);
        const found =
          importsStore.find((i) => i.id === id) ??
          makeImport({ format: 'usage_summary' }, [], false, id);
        return send({ import: found });
      }
      const cancelImportMatch = path.match(/^\/v1\/imports\/([^/]+)\/cancel$/);
      if (method === 'POST' && cancelImportMatch) {
        const id = decodeURIComponent(cancelImportMatch[1]);
        return send({
          import: makeImport({ format: 'usage_summary' }, [], false, id, 'cancelled'),
        });
      }

      // Chat that ECHOES nothing but records the received body, so the contract can
      // prove `ur.manifest` (the toWire shape) rode the wire verbatim (the gateway is a witness).
      if (method === 'POST' && path === '/v1/chat/completions') {
        return send({
          id: 'c_ct',
          object: 'chat.completion',
          created: 1,
          model: body.model ?? 'm',
          choices: [
            { index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          ur: {
            request_id: 'req_ct',
            call_type: null,
            model_served: body.model ?? 'm',
            provider: 'stub',
            routing: { mode: 'off', fallback_used: false },
            compression: { applied: 'off' },
            cost_usd: 0,
            byok: false,
          },
        });
      }

      return send({ error: { code: 'not_found', message: 'no route', type: 'not_found' } }, 404);
    })().catch((err) => {
      send({ error: { code: 'internal', message: String(err) } }, 500);
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => server.close(),
        calls,
        seen,
        armFailNextOutcome: () => {
          state.failNextOutcome = true;
        },
      });
    });
  });
}
