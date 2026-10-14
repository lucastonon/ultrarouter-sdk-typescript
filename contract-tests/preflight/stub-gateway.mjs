// A hermetic stub gateway for the preflight battery.
// It serves `POST /v1/preflight` with the TWO cache lifetimes the real gateway declares — a strong
// config-versioned `ETag` (`Cache-Control: private, max-age=5`), the 30 s LIVE part
// (`X-UR-Live-Max-Age: 30`), and the grant on the UNCACHED `X-UR-Grant` header (present on
// BOTH a 200 AND a 304). It honours `If-None-Match` (⇒ 304, no body, fresh grant header), MINTS a
// DETERMINISTIC idempotent grant per (cluster key, epoch) the way the gateway does, and
// serves the artifact + outcome routes so the whole non-proxied loop (preflight → apply → record the
// grant → outcome) runs over a real socket. It records every request for assertions. NEVER logs a body.
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

const EPOCH = 3;

/** The deterministic grant for a cluster key — the SAME derivation across idempotent calls. */
function mintGrant(clusterKey) {
  const grantId = `grant_${createHash('sha256')
    .update(`ws:${clusterKey}:${String(EPOCH)}`)
    .digest('hex')
    .slice(0, 32)}`;
  // Deterministic 2-arm split on the key hash (treated vs holdout) — arm-blind to the caller.
  const bucket =
    parseInt(createHash('sha256').update(`arm:${clusterKey}`).digest('hex').slice(0, 8), 16) % 100;
  const arm = bucket < 20 ? 'holdout' : 'treated';
  return {
    grant_id: grantId,
    arm,
    lever_id: null,
    epoch: EPOCH,
    valid_until_epoch_close: '2026-10-01T00:00:00Z',
    request_id: `req_pf_${createHash('sha256').update(`req:${clusterKey}`).digest('hex').slice(0, 12)}`,
  };
}

/**
 * The learned module preflight would inject (derived statistics only; suppressed on a holdout arm).
 * `delivery` tells a NON-proxied consumer HOW the module is delivered — `off` (the gateway
 * does NOT inject, so `useLearned().apply()` must) or `gateway_inject_after_stable_prefix` (the gateway
 * injects on the proxy path, so `apply()` must NOT double-inject).
 */
function knowledgeFor(arm, delivery = 'off') {
  if (arm === 'holdout') return { knowledge: null, knowledge_reason: 'holdout' };
  return {
    knowledge: {
      module: {
        id: 'lcm_contract',
        version: 'lcm1_contract',
        kind: 'ur:learned',
        slot: 'learned',
        state: 'screened',
        content_hash: createHash('sha256').update('LEARNED-CONTRACT-BLOCK').digest('hex'),
        tokens: 12,
        content: 'LEARNED-CONTRACT-BLOCK',
        lineage: {
          pack_hash: 'lcp1_contract',
          epoch: EPOCH,
          item_ids: ['fact_contract'],
          ranker_version: 'lcr1_contract',
          k: 3,
          key_spec: 'sit1',
          source_snapshot: '2026-09-01T00:00:00Z',
        },
      },
      placement: 'after_stable_prefix',
      delivery,
    },
    knowledge_reason: null,
  };
}

/** A call type whose learned context is delivered BY THE GATEWAY (so the SDK must not inject). */
function deliveryForCallType(callType) {
  return callType === 'ct-gateway' ? 'gateway_inject_after_stable_prefix' : 'off';
}

/** The config-versioned ETag — the part the ETag content-addresses (NOT the live part, NOT the grant). */
function configEtag(clusterKey, arm, delivery) {
  const k = knowledgeFor(arm, delivery);
  const subject = JSON.stringify({
    v: 1,
    config_version: 7,
    mode: 'candidates',
    model: 'openai/gpt-5.2-mini',
    knowledge: k.knowledge,
    knowledge_reason: k.knowledge_reason,
  });
  return `"${createHash('sha256').update(subject).digest('hex')}"`;
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw === '' ? {} : JSON.parse(raw);
}

/** Does an If-None-Match header satisfy our ETag (handles weak prefixes + `*`)? */
function ifNoneMatchSatisfies(header, etag) {
  return header
    .split(',')
    .map((t) => t.trim().replace(/^W\//, ''))
    .some((t) => t === '*' || t === etag);
}

/** Start the stub. Resolves `{ url, close, calls }`. */
export function startPreflightStub() {
  const calls = [];

  const server = createServer((req, res) => {
    void (async () => {
      const url = req.url ?? '';
      const method = req.method ?? 'GET';
      const path = url.split('?')[0];
      const reqHeaders = {};
      for (const [k, v] of Object.entries(req.headers))
        reqHeaders[k.toLowerCase()] = Array.isArray(v) ? v.join(',') : v;
      const body = method === 'GET' ? undefined : await readJson(req);
      calls.push({ method, url, path, headers: reqHeaders, body });

      const sendJson = (obj, status = 200, extra = {}) => {
        res.writeHead(status, { 'content-type': 'application/json', ...extra });
        res.end(JSON.stringify(obj));
      };

      if (method === 'POST' && path === '/v1/preflight') {
        const clusterKey = body.artifact_key ?? body.trace_id ?? null;
        const grant = clusterKey !== null ? mintGrant(clusterKey) : null;
        const arm = grant?.arm ?? 'treated';
        const delivery = deliveryForCallType(body.call_type);
        const k = knowledgeFor(arm, delivery);
        const etag = configEtag(clusterKey ?? '(none)', arm, delivery);
        const cacheHeaders = {
          etag,
          'cache-control': 'private, max-age=5',
          'x-ur-live-max-age': '30',
          ...(grant !== null ? { 'x-ur-grant': JSON.stringify(grant) } : {}),
        };
        const ifNoneMatch = reqHeaders['if-none-match'];
        if (ifNoneMatch !== undefined && ifNoneMatchSatisfies(ifNoneMatch, etag)) {
          // 304: no body; the config part is unchanged, and the grant rides the FRESH header.
          res.writeHead(304, cacheHeaders);
          res.end();
          return;
        }
        const response = {
          object: 'preflight',
          config_version: 7,
          routing: {
            mode: 'candidates',
            model: { id: 'openai/gpt-5.2-mini', evidence: 'none', score: null },
            fallbacks: [{ id: 'openai/gpt-5.2', score: null }],
            why: null,
            max_age_s: 30,
          },
          knowledge: k.knowledge,
          knowledge_reason: k.knowledge_reason,
          grant,
          grant_reason: grant === null ? 'no_cluster_key' : null,
          provisional: true,
          reason: 'not_benchmarkable',
        };
        sendJson(response, 200, cacheHeaders);
        return;
      }

      if (method === 'POST' && path === '/v1/artifacts') {
        const grant = body.grant_id !== undefined ? { arm: 'treated' } : null;
        sendJson(
          {
            artifact: {
              object: 'artifact',
              id: 'art_pf_loop',
              key: body.key,
              archetype: body.archetype ?? 'answer',
              artifact_type_version_id: null,
              call_type_id: null,
              situation_key: null,
              occurred_at: '2026-09-14T00:00:00Z',
              exposure_arm: grant !== null ? 'treated' : 'pre_lever',
              exposure_epoch: EPOCH,
              grant_id: body.grant_id ?? null,
              grant_attestation: body.attestation ?? null,
              lifecycle: 'open',
              current_version: 1,
              request_ids: [],
              claims: [],
              created_at: '2026-09-14T00:00:00Z',
              updated_at: '2026-09-14T00:00:00Z',
            },
          },
          201,
        );
        return;
      }

      const outcomesMatch = path.match(/^\/v1\/artifacts\/([^/]+)\/outcomes$/);
      if (method === 'POST' && outcomesMatch) {
        const events = body.outcomes ?? [];
        const data = events.map((e) => ({
          status: 'accepted',
          id: 'oev_pf',
          source_event_id: e.source_event_id ?? null,
          canonical_target_id: decodeURIComponent(outcomesMatch[1]),
          target_kind: 'artifact',
          artifact_version: 1,
          latency_class: e.observed_at ? 'delayed' : 'instant',
          source: 'declared',
          learning_use: ['calibrate'],
          reason: null,
        }));
        sendJson({ object: 'list', data }, 202);
        return;
      }

      // The manual eval trigger. The FIRST trigger for a call type ENQUEUES (202); an
      // identical re-trigger DEDUPES (200) and NAMES the run it deduped onto (prior_run_id + trigger/
      // status), so the client can follow the run it asked for (idempotent re-triggers are free).
      const evalsMatch = path.match(/^\/v1\/call-types\/([^/]+)\/evals$/);
      if (method === 'POST' && evalsMatch) {
        const callType = decodeURIComponent(evalsMatch[1]);
        const runId = `evr_${createHash('sha256').update(`run:${callType}`).digest('hex').slice(0, 24)}`;
        // Count PRIOR eval POSTs for this call type (this request is already in `calls`).
        const priorTriggers = calls.filter((c) => c.method === 'POST' && c.path === path).length;
        if (priorTriggers <= 1) {
          sendJson({ object: 'eval_run', enqueued: true, run_id: runId, candidate_count: 3 }, 202);
          return;
        }
        sendJson(
          {
            object: 'eval_run',
            enqueued: false,
            reason: 'deduped',
            deduped: true,
            prior_run_id: runId,
            trigger: 'manual',
            status: 'queued',
          },
          200,
        );
        return;
      }

      sendJson({ error: { code: 'not_found', message: 'no route', type: 'not_found' } }, 404);
    })().catch((err) => {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'internal', message: String(err) } }));
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close(), calls });
    });
  });
}
