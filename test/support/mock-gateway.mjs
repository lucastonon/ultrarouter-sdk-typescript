/**
 * A local, dependency-free mock of the ultrarouter gateway for tests, doctests, examples and the
 * pack smoke. It never calls a model provider. Every operation in `openapi/openapi.yaml` answers:
 * the common ones (chat, streaming, tools, structured outputs, embeddings, models, key, call types,
 * feedback, generation, preflight, artifacts, outcomes, imports, reviewer, oracles, Bench) with
 * hand-written behaviour, and every other operation with a sample generated from its published
 * response schema. `test/mock-gateway.test.ts` proves the bodies validate against the schema.
 *
 * Special inputs (to exercise error handling):
 * - model `example/unpriced-model` → 403 `model_unpriced`
 * - model `example/rate-limited`   → 429 `rate_limited` (always)
 * - model `example/flaky`          → 502 `provider_unavailable` on the first attempt of each request, then success
 * - model `example/no-tools`       → 400 `capability_unsupported` when `tools` are sent
 * - API key `ur_sk_test_invalid`   → 401 `authentication`
 *
 * Usage: `const gw = await startMockGateway(); … gw.url … await gw.close();`
 * or run it directly: `node test/support/mock-gateway.mjs [--port 8787]`.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The secret the mock issues for pull-transport oracles (claim / verdict signatures). */
export const MOCK_ORACLE_SECRET = 'mock-oracle-secret';

const NOW = '2026-01-01T00:00:00.000Z';
const NOW_S = 1767225600;

let specCache;
function spec() {
  if (specCache === undefined) {
    const yaml = require('js-yaml');
    specCache = yaml.load(readFileSync(join(ROOT, 'openapi', 'openapi.yaml'), 'utf8'));
  }
  return specCache;
}

// ─────────────────────────────── schema-driven samples ───────────────────────────────

function resolveRef(ref) {
  let node = spec();
  for (const p of ref.replace(/^#\//, '').split('/')) node = node?.[p];
  return node;
}

/** A minimal instance of a schema: required properties only, first enum value, first non-null branch. */
export function sampleFromSchema(schema, name = 'value', depth = 0) {
  if (schema === undefined || schema === null || depth > 12) return null;
  if (typeof schema.$ref === 'string')
    return sampleFromSchema(resolveRef(schema.$ref), name, depth + 1);
  if (Array.isArray(schema.allOf)) {
    return Object.assign({}, ...schema.allOf.map((s) => sampleFromSchema(s, name, depth + 1)));
  }
  for (const key of ['anyOf', 'oneOf']) {
    if (Array.isArray(schema[key])) {
      const branch =
        schema[key].find((s) => s?.nullable !== true || s.type !== undefined) ?? schema[key][0];
      return sampleFromSchema(branch, name, depth + 1);
    }
  }
  if (Array.isArray(schema.enum)) return schema.enum[0];
  switch (schema.type) {
    case 'object': {
      const out = {};
      for (const req of schema.required ?? []) {
        const prop = schema.properties?.[req];
        // A nullable pagination cursor is null, so a "fetch every page" loop terminates.
        out[req] =
          /cursor$/.test(req) && prop?.nullable === true
            ? null
            : sampleFromSchema(prop, req, depth + 1);
      }
      return out;
    }
    case 'array':
      return (schema.minItems ?? 0) > 0 ? [sampleFromSchema(schema.items, name, depth + 1)] : [];
    case 'integer':
    case 'number':
      return typeof schema.minimum === 'number'
        ? schema.exclusiveMinimum === true
          ? schema.minimum + 1
          : schema.minimum
        : 0;
    case 'boolean':
      return false;
    case 'string':
      if (/(_at|_until|^since|^from|^to)$/.test(name)) return NOW;
      return `mock_${name}`;
    default:
      return schema.nullable === true ? null : {};
  }
}

/** Find the spec operation for a concrete path: returns `{ template, op, params }` or null. */
function matchOperation(method, pathname) {
  const paths = spec().paths ?? {};
  for (const [template, item] of Object.entries(paths)) {
    const op = item[method.toLowerCase()];
    if (op === undefined) continue;
    const names = [];
    const re = new RegExp(
      `^${template.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{([^}]+)\}/g, (_m, n) => {
        names.push(n);
        return n === 'id' && template.startsWith('/v1/models/') ? '(.+)' : '([^/]+)';
      })}$`,
    );
    const m = re.exec(pathname);
    if (m !== null) {
      const params = {};
      names.forEach((n, i) => {
        params[n] = decodeURIComponent(m[i + 1] ?? '');
      });
      return { template, op, params };
    }
  }
  return null;
}

function successStatus(op) {
  for (const s of ['200', '201', '202']) if (op.responses?.[s] !== undefined) return Number(s);
  return 200;
}

// ─────────────────────────────── helpers ───────────────────────────────

function sha(text) {
  return createHash('sha256').update(text).digest('hex');
}

function ur(model, extra = {}) {
  return {
    request_id: `req_mock_${sha(String(Math.random())).slice(0, 12)}`,
    call_type: null,
    model_served: model,
    provider: model.split('/')[0] ?? 'mock',
    routing: { mode: 'off', fallback_used: false },
    compression: { applied: 'off' },
    cost_usd: 0.000042,
    byok: false,
    ...extra,
  };
}

function lastUserText(messages) {
  for (let i = (messages ?? []).length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m?.role !== 'user') continue;
    if (typeof m.content === 'string') return m.content;
    if (Array.isArray(m.content)) return m.content.map((p) => p?.text ?? '').join(' ');
  }
  return '';
}

/** A JSON value shaped like a JSON Schema (for structured-output requests). */
function sampleJson(schema, name = 'value', depth = 0) {
  if (schema === undefined || schema === null || depth > 8) return null;
  if (Array.isArray(schema.enum)) return schema.enum[0];
  const t = Array.isArray(schema.type) ? schema.type.find((x) => x !== 'null') : schema.type;
  switch (t) {
    case 'object': {
      const out = {};
      for (const [k, v] of Object.entries(schema.properties ?? {}))
        out[k] = sampleJson(v, k, depth + 1);
      return out;
    }
    case 'array':
      return [sampleJson(schema.items ?? { type: 'string' }, name, depth + 1)];
    case 'integer':
      return 1;
    case 'number':
      return 1.5;
    case 'boolean':
      return true;
    default:
      return `example ${name}`;
  }
}

function errorBody(code, message, retryable = false) {
  return { error: { code, message, request_id: 'req_mock_error', retryable } };
}

const MODELS = [
  {
    id: 'openai/gpt-5.2-mini',
    provider: 'openai',
    name: 'GPT-5.2 mini',
    context: 400000,
    caps: { tools: true, json_schema: true, vision: true },
    inUsd: 0.25,
    outUsd: 2,
  },
  {
    id: 'openai/gpt-5.2',
    provider: 'openai',
    name: 'GPT-5.2',
    context: 400000,
    caps: { tools: true, json_schema: true, vision: true },
    inUsd: 1.25,
    outUsd: 10,
  },
  {
    id: 'openai/text-embedding-3-small',
    provider: 'openai',
    name: 'text-embedding-3-small',
    context: 8191,
    caps: { embeddings: true },
    inUsd: 0.02,
    outUsd: 0,
  },
  {
    id: 'anthropic/claude-sonnet-4.6',
    provider: 'anthropic',
    name: 'Claude Sonnet 4.6',
    context: 200000,
    caps: { tools: true, json_schema: true, vision: true },
    inUsd: 3,
    outUsd: 15,
  },
];

function modelRow(m) {
  return {
    id: m.id,
    object: 'model',
    name: m.name,
    provider: m.provider,
    context_length: m.context,
    capabilities: m.caps,
    pricing: {
      input_micro_usd_per_1m: Math.round(m.inUsd * 1e6),
      output_micro_usd_per_1m: Math.round(m.outUsd * 1e6),
      cached_input_micro_usd_per_1m: null,
      input_usd_per_1m: m.inUsd,
      output_usd_per_1m: m.outUsd,
    },
    active: true,
    origin_jurisdiction: 'US',
    weights: 'closed',
    hosting_jurisdiction: 'US',
    hosting_region: null,
  };
}

function callType(slug, config = null) {
  return {
    object: 'call_type',
    id: `ct_${sha(slug).slice(0, 10)}`,
    slug,
    display_name: slug,
    source: 'declared',
    current_config_version: config === null ? null : 1,
    config:
      config === null
        ? null
        : {
            version: 1,
            model_pin: config.model_pin ?? null,
            router_mode: config.router_mode ?? null,
            compression_mode: config.compression_mode ?? null,
            fallbacks: config.fallbacks ?? null,
            provider_prefs: config.provider_prefs ?? null,
            learned_context_delivery:
              config.learned_context_delivery ?? 'gateway_inject_after_stable_prefix',
            case_precedents_enabled: config.case_precedents_enabled ?? false,
            created_at: NOW,
          },
    lifecycle_state: 'observing',
    lifecycle_reason: null,
    lifecycle_transitioned_at: null,
    created_at: NOW,
    updated_at: NOW,
  };
}

function artifact(key, extra = {}) {
  return {
    object: 'artifact',
    id: `art_${sha(key).slice(0, 12)}`,
    key,
    archetype: extra.archetype ?? 'answer',
    artifact_type_version_id: null,
    call_type_id: null,
    situation_key: null,
    occurred_at: NOW,
    exposure_arm: null,
    exposure_epoch: null,
    grant_id: extra.grant_id ?? null,
    grant_attestation: extra.attestation ?? null,
    lifecycle: 'open',
    current_version: 1,
    request_ids: [],
    claims: [],
    superseded_claims: [],
    created_at: NOW,
    updated_at: NOW,
  };
}

function outcomeResult(event, targetKind, targetId) {
  return {
    status: 'accepted',
    id: `out_${sha(JSON.stringify(event)).slice(0, 12)}`,
    source_event_id: event.source_event_id ?? 'evt_mock',
    canonical_target_id: targetId,
    target_kind: targetKind,
    artifact_version: 1,
    latency_class: 'instant',
    source: 'declared',
    learning_use: ['rank'],
    reason: null,
  };
}

function verifySignature(secret, timestamp, rawBody, signature) {
  if (typeof timestamp !== 'string' || typeof signature !== 'string') return false;
  const expected = `sha256=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ─────────────────────────────── the server ───────────────────────────────

/**
 * Start the mock gateway on 127.0.0.1.
 * @param {{ port?: number }} [options]
 * @returns {Promise<{ url: string, port: number, requests: object[], close: () => Promise<void> }>}
 */
export async function startMockGateway(options = {}) {
  const requests = [];
  const attempts = new Map(); // idempotency key → attempts (for example/flaky)
  const callTypes = new Map();
  const imports = new Map();
  const PREFLIGHT_ETAG = '"cfg-mock-1"';

  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body;
      try {
        body = raw === '' ? undefined : JSON.parse(raw);
      } catch {
        body = undefined;
      }
      const url = new URL(req.url ?? '/', 'http://mock');
      const record = {
        method: req.method ?? 'GET',
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        headers: req.headers,
        body,
        raw,
      };
      requests.push(record);
      try {
        handle(req, res, record, url);
      } catch (err) {
        send(
          res,
          500,
          errorBody(
            'internal',
            `mock gateway error: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      }
    });
  });

  function send(res, status, payload, headers = {}) {
    res.writeHead(status, {
      'content-type': 'application/json',
      'x-ur-request-id': 'req_mock',
      ...headers,
    });
    res.end(payload === undefined ? '' : JSON.stringify(payload));
  }

  function handle(req, res, r, url) {
    const method = r.method;
    const path = r.path;

    if (method === 'GET' && (path === '/healthz' || path === '/readyz')) {
      return send(
        res,
        200,
        sampleFromSchema(
          matchOperation('get', path)?.op.responses['200'].content['application/json'].schema,
        ),
      );
    }

    const auth = req.headers.authorization ?? '';
    if (!auth.startsWith('Bearer ') || auth.length <= 'Bearer '.length) {
      return send(res, 401, errorBody('authentication', 'missing API key'));
    }
    const apiKey = auth.slice('Bearer '.length);
    if (apiKey === 'ur_sk_test_invalid')
      return send(res, 401, errorBody('authentication', 'invalid API key'));

    // ── chat ──
    if (method === 'POST' && path === '/v1/chat/completions') return chat(res, r);

    // ── embeddings ──
    if (method === 'POST' && path === '/v1/embeddings') {
      const inputs = Array.isArray(r.body?.input) ? r.body.input : [r.body?.input ?? ''];
      const model = r.body?.model ?? 'openai/text-embedding-3-small';
      if (model === 'example/unpriced-model')
        return send(res, 403, errorBody('model_unpriced', `model '${model}' has no price`));
      const dims = r.body?.dimensions ?? 8;
      const data = inputs.map((text, index) => {
        const h = createHash('sha256').update(String(text)).digest();
        const vec = Array.from({ length: dims }, (_v, i) =>
          Number(((h[i % h.length] ?? 0) / 255 - 0.5).toFixed(6)),
        );
        const embedding =
          r.body?.encoding_format === 'base64'
            ? Buffer.from(new Float32Array(vec).buffer).toString('base64')
            : vec;
        return { object: 'embedding', index, embedding };
      });
      const tokens = inputs.reduce((n, t) => n + Math.max(1, Math.ceil(String(t).length / 4)), 0);
      return send(res, 200, {
        object: 'list',
        data,
        model,
        usage: { prompt_tokens: tokens, total_tokens: tokens },
        ur: ur(model),
      });
    }

    // ── models ──
    if (method === 'GET' && path === '/v1/models') {
      const provider = url.searchParams.get('provider');
      const capability = url.searchParams.get('capability');
      const data = MODELS.filter(
        (m) =>
          (provider === null || m.provider === provider) &&
          (capability === null || m.caps[capability] === true),
      ).map(modelRow);
      return send(res, 200, { object: 'list', data });
    }
    if (method === 'GET' && path.startsWith('/v1/models/')) {
      const id = decodeURIComponent(path.slice('/v1/models/'.length));
      const m = MODELS.find((x) => x.id === id);
      if (m === undefined) return send(res, 404, errorBody('not_found', `model '${id}' not found`));
      const row = modelRow(m);
      return send(res, 200, {
        id: row.id,
        object: 'model',
        name: row.name,
        context_length: row.context_length,
        capabilities: row.capabilities,
        origin_jurisdiction: 'US',
        weights: 'closed',
        offers: [
          {
            ...sampleFromSchema(
              spec().components.schemas.ModelDetailResponse.properties.offers.items,
            ),
            provider: m.provider,
            hosting_jurisdiction: 'US',
            hosting_region: null,
          },
        ],
      });
    }

    // ── key ──
    if (method === 'GET' && path === '/v1/key') {
      return send(res, 200, {
        ...sampleFromSchema(spec().components.schemas.KeyIntrospection),
        name: 'mock key',
        prefix: apiKey.slice(0, 12),
        mode: apiKey.startsWith('ur_sk_live_') ? 'live' : 'test',
        scopes: ['gateway:invoke', 'config:read', 'config:write', 'outcomes:write', 'bench:run'],
        workspace_id: 'ws_mock',
        expires_at: null,
        created_at: NOW,
      });
    }

    // ── call types ──
    if (path === '/v1/call-types' && method === 'GET')
      return send(res, 200, { object: 'list', data: [...callTypes.values()] });
    if (path === '/v1/call-types' && method === 'POST') {
      const ct = callType(r.body?.slug ?? 'unnamed', r.body?.config ?? {});
      callTypes.set(ct.slug, ct);
      return send(res, 201, ct);
    }
    const ctMatch = /^\/v1\/call-types\/([^/]+)$/.exec(path);
    if (ctMatch !== null && (method === 'GET' || method === 'PATCH')) {
      const id = decodeURIComponent(ctMatch[1] ?? '');
      const existing =
        [...callTypes.values()].find((c) => c.id === id || c.slug === id) ?? callType(id, {});
      if (method === 'PATCH') {
        const updated = callType(existing.slug, { ...(existing.config ?? {}), ...(r.body ?? {}) });
        updated.current_config_version = (existing.current_config_version ?? 0) + 1;
        if (updated.config !== null) updated.config.version = updated.current_config_version;
        callTypes.set(updated.slug, updated);
        return send(res, 200, updated);
      }
      return send(res, 200, existing);
    }

    // ── feedback + generation ──
    const fb = /^\/v1\/requests\/([^/]+)\/feedback$/.exec(path);
    if (fb !== null && method === 'POST') {
      return send(res, 201, {
        feedback: {
          object: 'request_feedback',
          id: `fb_${sha(raw(r)).slice(0, 10)}`,
          request_id: decodeURIComponent(fb[1] ?? ''),
          rating: r.body?.rating ?? 1,
          tags: r.body?.tags ?? [],
          comment: r.body?.comment ?? null,
          created_at: NOW,
        },
      });
    }
    if (method === 'GET' && path === '/v1/generation') {
      const id = url.searchParams.get('id') ?? 'req_unknown';
      return send(res, 200, {
        id,
        call_type: null,
        model_requested: 'openai/gpt-5.2-mini',
        model_served: 'openai/gpt-5.2-mini',
        provider: 'openai',
        status: 'ok',
        error_class: null,
        contract_digest: null,
        tokens: { input: 12, output: 8, cached: 0, total: 20 },
        cost: { total_micro_usd: 42, total_usd: 0.000042 },
        timing: { ttfb_ms: 120, latency_ms: 340 },
        routing_decision: { mode: 'off' },
        compression: { applied: 'off' },
        outcomes: [],
        exposure: { arm: null, epoch: null },
        lever: {
          lever_id: null,
          module_version: null,
          epoch: null,
          pack_hash: null,
          injection: null,
        },
        byok: false,
        created_at: NOW,
      });
    }

    // ── preflight ──
    if (method === 'POST' && path === '/v1/preflight') return preflight(req, res, r);

    // ── artifacts + outcomes ──
    if (method === 'POST' && path === '/v1/artifacts') {
      return send(res, 201, {
        artifact: artifact(r.body?.key ?? 'unnamed', {
          archetype: r.body?.archetype,
          grant_id: r.body?.grant_id,
          attestation: r.body?.attestation,
        }),
      });
    }
    const artGet = /^\/v1\/artifacts\/([^/]+)$/.exec(path);
    if (artGet !== null && method === 'GET')
      return send(res, 200, {
        artifact: {
          ...artifact(decodeURIComponent(artGet[1] ?? '')),
          id: decodeURIComponent(artGet[1] ?? ''),
        },
      });
    const artOut = /^\/v1\/artifacts\/([^/]+)\/outcomes$/.exec(path);
    if (artOut !== null && method === 'POST') {
      const id = decodeURIComponent(artOut[1] ?? '');
      return send(res, 202, {
        object: 'list',
        data: (r.body?.outcomes ?? []).map((e) => outcomeResult(e, 'artifact', id)),
      });
    }
    const reqOut = /^\/v1\/requests\/([^/]+)\/outcomes$/.exec(path);
    if (reqOut !== null && method === 'POST')
      return send(
        res,
        202,
        outcomeResult(r.body ?? {}, 'artifact', `art_for_${decodeURIComponent(reqOut[1] ?? '')}`),
      );

    // ── imports ──
    if (method === 'POST' && path === '/v1/imports') {
      const base = sampleFromSchema(spec().components.schemas.ImportSummary);
      const records = Array.isArray(r.body?.records) ? r.body.records.length : 0;
      const imp = {
        ...base,
        id: `imp_${sha(raw(r)).slice(0, 10)}`,
        format: r.body?.format ?? 'usage_summary',
        status: r.body?.mode === 'preview' ? 'preview' : 'completed',
        record_count: records,
        accepted_count: records,
        created_at: NOW,
        updated_at: NOW,
      };
      if (!spec().components.schemas.ImportSummary.properties.status.enum?.includes(imp.status))
        imp.status = base.status;
      imports.set(imp.id, imp);
      return send(res, 200, { import: imp });
    }

    // ── reviewer adapter (signature verified with the API key) ──
    if (method === 'POST' && path === '/v1/flywheel/reviewer/events') {
      const ok = verifySignature(
        apiKey,
        req.headers['x-ur-reviewer-timestamp'],
        r.raw,
        req.headers['x-ur-reviewer-signature'],
      );
      if (!ok) return send(res, 403, errorBody('permission', 'invalid reviewer signature'));
      const events = r.body?.events ?? [];
      const base = sampleFromSchema(spec().components.schemas.ReviewerEventsResponse);
      const item = spec().components.schemas.ReviewerEventsResponse.properties.data.items;
      return send(res, 200, {
        ...base,
        accepted: events.length,
        data: events.map((e) => ({
          ...sampleFromSchema(item),
          event_id: e.event_id ?? 'evt',
          status: 'accepted',
        })),
      });
    }

    // ── oracle registration: a push / pull oracle is issued the mock signing secret (returned once) ──
    if (method === 'POST' && path === '/v1/flywheel/oracles') {
      const schema =
        spec().paths['/v1/flywheel/oracles'].post.responses['201'].content['application/json']
          .schema;
      const kind = r.body?.kind ?? 'label_set';
      const transported =
        kind === 'customer_ci' || kind === 'test_endpoint' || kind === 'reconciliation';
      return send(res, 201, {
        ...sampleFromSchema(schema),
        oracle_id: r.body?.oracle_id ?? 'orc_mock_1',
        inserted: true,
        ...(schema.properties.kind?.enum?.includes(kind) ? { kind } : {}),
        secret: transported ? MOCK_ORACLE_SECRET : null,
        secret_last4: transported ? MOCK_ORACLE_SECRET.slice(-4) : null,
      });
    }

    // ── oracle pull transport (signature verified with the mock oracle secret) ──
    if (
      method === 'POST' &&
      /^\/v1\/flywheel\/oracles\/[^/]+\/(jobs\/claim|verdicts)$/.test(path)
    ) {
      const ok = verifySignature(
        MOCK_ORACLE_SECRET,
        req.headers['x-ur-oracle-timestamp'],
        r.raw,
        req.headers['x-ur-oracle-signature'],
      );
      if (!ok) return send(res, 403, errorBody('permission', 'invalid oracle signature'));
    }

    // ── Bench: a coherent run lifecycle ──
    const benchRuns = /^\/v1\/bench\/suites\/([^/]+)\/runs$/.exec(path);
    if (benchRuns !== null && method === 'POST') {
      const base = sampleFromSchema(spec().components.schemas.BenchRunTriggerResponse);
      return send(res, 200, {
        ...base,
        bench_run_id: r.body?.dry_run === true ? null : 'br_mock_1',
        suite: decodeURIComponent(benchRuns[1] ?? ''),
        dry_run: r.body?.dry_run === true,
      });
    }
    const benchGet = /^\/v1\/bench\/runs\/([^/]+)$/.exec(path);
    if (benchGet !== null && method === 'GET') {
      const base = sampleFromSchema(spec().components.schemas.BenchRunResponse);
      return send(res, 200, {
        ...base,
        id: decodeURIComponent(benchGet[1] ?? ''),
        status: 'complete',
      });
    }
    const benchReport = /^\/v1\/bench\/runs\/([^/]+)\/report$/.exec(path);
    if (benchReport !== null && method === 'GET' && url.searchParams.get('format') === 'md') {
      res.writeHead(200, { 'content-type': 'text/markdown' });
      return res.end(
        `# Bench report ${decodeURIComponent(benchReport[1] ?? '')}\n\nMock report.\n`,
      );
    }

    // ── everything else: a schema-generated sample for the matching operation ──
    const match = matchOperation(method, path);
    if (match === null) return send(res, 404, errorBody('not_found', `no route ${method} ${path}`));
    const status = successStatus(match.op);
    const schema = match.op.responses?.[String(status)]?.content?.['application/json']?.schema;
    if (schema === undefined) return send(res, status, {});
    return send(res, status, sampleFromSchema(schema));
  }

  function raw(r) {
    return r.raw ?? '';
  }

  function chat(res, r) {
    const body = r.body ?? {};
    const model = body.model ?? 'openai/gpt-5.2-mini';
    if (model === 'example/unpriced-model') {
      return send(
        res,
        403,
        errorBody('model_unpriced', `model '${model}' has no price; use a priced model`),
      );
    }
    if (model === 'example/rate-limited') {
      return send(res, 429, errorBody('rate_limited', 'rate limit exceeded', true), {
        'retry-after': '0',
      });
    }
    if (model === 'example/flaky') {
      const key = String(r.headers['idempotency-key'] ?? r.raw);
      const n = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, n);
      if (n === 1)
        return send(
          res,
          502,
          errorBody('provider_unavailable', 'upstream provider unavailable', true),
        );
    }
    if (model === 'example/no-tools' && Array.isArray(body.tools) && body.tools.length > 0) {
      return send(
        res,
        400,
        errorBody('capability_unsupported', `model '${model}' does not support tools`),
      );
    }
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return send(res, 400, errorBody('invalid_request', '`messages` must be a non-empty array'));
    }

    const question = lastUserText(body.messages);
    let content = `Mock reply to: ${question.slice(0, 80)}`;
    let toolCalls;
    let finish = 'stop';
    const wantsTools =
      Array.isArray(body.tools) && body.tools.length > 0 && body.tool_choice !== 'none';
    const answeredTool = body.messages.some((m) => m?.role === 'tool');
    if (wantsTools && !answeredTool) {
      const tool = body.tools[0];
      const fn = tool?.function ?? {};
      toolCalls = [
        {
          id: 'call_mock_1',
          type: 'function',
          function: {
            name: fn.name ?? 'tool',
            arguments: JSON.stringify(sampleJson(fn.parameters ?? { type: 'object' })),
          },
        },
      ];
      content = null;
      finish = 'tool_calls';
    } else if (body.response_format?.type === 'json_schema') {
      content = JSON.stringify(
        sampleJson(body.response_format.json_schema?.schema ?? { type: 'object' }),
      );
    } else if (body.response_format?.type === 'json_object') {
      content = JSON.stringify({ result: 'ok' });
    }
    const promptTokens = Math.max(1, Math.ceil(JSON.stringify(body.messages).length / 4));
    const completionTokens = content === null ? 12 : Math.max(1, Math.ceil(content.length / 4));
    const usage = {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    };
    const urBlock = ur(model, {
      call_type: body.call_type ?? null,
      routing: { mode: body.router ?? 'off', fallback_used: false },
      ...(body.ur?.artifact !== undefined
        ? { artifact_id: `art_${sha(body.ur.artifact).slice(0, 12)}` }
        : {}),
    });
    const id = `chatcmpl_mock_${sha(r.raw).slice(0, 10)}`;

    if (body.stream === true) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const frame = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
      const base = { id, object: 'chat.completion.chunk', created: NOW_S, model };
      res.write(': heartbeat\n\n');
      if (toolCalls !== undefined) {
        frame({
          ...base,
          choices: [
            {
              index: 0,
              delta: {
                role: 'assistant',
                tool_calls: toolCalls.map((t, index) => ({ index, ...t })),
              },
              finish_reason: null,
            },
          ],
        });
      } else {
        const text = content ?? '';
        const parts = [
          text.slice(0, Math.ceil(text.length / 3)),
          text.slice(Math.ceil(text.length / 3), Math.ceil((2 * text.length) / 3)),
          text.slice(Math.ceil((2 * text.length) / 3)),
        ];
        parts.forEach((part, i) =>
          frame({
            ...base,
            choices: [
              {
                index: 0,
                delta: i === 0 ? { role: 'assistant', content: part } : { content: part },
                finish_reason: null,
              },
            ],
          }),
        );
      }
      frame({
        ...base,
        choices: [{ index: 0, delta: {}, finish_reason: finish }],
        usage,
        ur: urBlock,
      });
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    return send(res, 200, {
      id,
      object: 'chat.completion',
      created: NOW_S,
      model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content,
            ...(toolCalls !== undefined ? { tool_calls: toolCalls } : {}),
          },
          finish_reason: finish,
        },
      ],
      usage,
      ur: urBlock,
    });
  }

  function preflight(req, res, r) {
    const body = r.body ?? {};
    const callTypeSlug = body.call_type ?? 'default';
    const clusterKey = body.artifact_key ?? body.trace_id;
    const grant =
      clusterKey === undefined
        ? null
        : {
            grant_id: `grant_${sha(String(clusterKey)).slice(0, 32)}`,
            arm: 'treated',
            lever_id: null,
            epoch: 1,
            valid_until_epoch_close: NOW,
            request_id: 'req_mock_preflight',
          };
    const headers = {
      etag: PREFLIGHT_ETAG,
      'cache-control': 'private, max-age=5',
      'x-ur-live-max-age': '30',
      ...(grant !== null ? { 'x-ur-grant': JSON.stringify(grant) } : {}),
    };
    if (req.headers['if-none-match'] === PREFLIGHT_ETAG && body.messages === undefined) {
      res.writeHead(304, headers);
      return res.end();
    }
    const caseModule = callTypeSlug === 'invoice-triage';
    const messages = Array.isArray(body.messages) ? body.messages : undefined;
    const moduleContent = caseModule
      ? messages === undefined
        ? null
        : `Verified cases similar to: ${lastUserText(messages).slice(0, 60)}`
      : 'Learned context: answer in the customer’s language and cite the order id.';
    const knowledge =
      moduleContent === null
        ? null
        : {
            module: {
              id: `lcm_${sha(callTypeSlug).slice(0, 10)}`,
              version: 'lcm1_mock',
              kind: 'learned_pack',
              slot: 'learned',
              state: 'pinned',
              content_hash: sha(moduleContent),
              tokens: Math.ceil(moduleContent.length / 4),
              content: moduleContent,
              lineage: {
                pack_hash: 'lcp1_mock',
                epoch: 1,
                item_ids: ['fact_mock_1'],
                ranker_version: 'lcr1_mock',
                k: 3,
                key_spec: 'sit1',
                source_snapshot: NOW,
              },
            },
            placement: 'after_stable_prefix',
            delivery: 'gateway_inject_after_stable_prefix',
          };
    const schema = spec().components.schemas.PreflightResponse;
    const stateEnum = spec().components.schemas.PreflightKnowledgeModule.properties.state.enum;
    if (
      knowledge !== null &&
      Array.isArray(stateEnum) &&
      !stateEnum.includes(knowledge.module.state)
    )
      knowledge.module.state = stateEnum[0];
    const kindEnum = spec().components.schemas.PreflightKnowledgeModule.properties.kind.enum;
    if (knowledge !== null && Array.isArray(kindEnum) && !kindEnum.includes(knowledge.module.kind))
      knowledge.module.kind = kindEnum[0];
    const response = {
      ...sampleFromSchema(schema),
      object: 'preflight',
      config_version: 1,
      routing: {
        mode: 'off',
        model: {
          ...sampleFromSchema(spec().components.schemas.PreflightModel),
          id: 'openai/gpt-5.2-mini',
        },
        fallbacks: [
          {
            ...sampleFromSchema(spec().components.schemas.PreflightFallback),
            id: 'openai/gpt-5.2',
          },
        ],
        why: null,
        max_age_s: 30,
      },
      prompt: null,
      knowledge,
      knowledge_reason: knowledge === null ? 'case_query_missing' : null,
      grant,
      grant_reason: grant === null ? 'no_cluster_key' : null,
      provisional: true,
    };
    const reasonEnum = schema.properties.knowledge_reason;
    void reasonEnum;
    return send(res, 200, response, headers);
  }

  await new Promise((resolveListen) =>
    server.listen(options.port ?? 0, '127.0.0.1', resolveListen),
  );
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    url: `http://127.0.0.1:${String(port)}`,
    port,
    requests,
    close: () =>
      new Promise((resolveClose) => {
        server.closeAllConnections?.();
        server.close(() => resolveClose());
      }),
  };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const portFlag = process.argv.indexOf('--port');
  const port = portFlag === -1 ? 8787 : Number(process.argv[portFlag + 1]);
  const gw = await startMockGateway({ port });
  process.stdout.write(`mock gateway listening on ${gw.url}\n`);
}
