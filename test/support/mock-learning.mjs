/**
 * The plug-and-play learning part of the local mock gateway: request correlation, durable outcome
 * receipts, learning controls, and a scripted (non-model) tool-calling policy for the order-desk
 * demonstration tools. Used by `test/support/mock-gateway.mjs`; never calls a model provider.
 *
 * Behaviour the examples and tests rely on:
 * - Every chat / embeddings call has a request id: the client's `x-ur-request-id` when it sent a
 *   valid one, else a minted `req_mock_<n>`. The mock remembers it as served, with its episode key
 *   (`x-ur-artifact` or body `ur.artifact`).
 * - The request "row" of a served request lands lazily: an outcome reported on it before anything
 *   has read its receipts is `pending` (with a durable receipt); the first read of a receipt (by id
 *   or by request) applies every pending receipt of that request. That makes the immediate-outcome
 *   path deterministic without sleeping.
 * - Outcome reports are idempotent on (request, kind, source_event_id): the same payload returns
 *   `duplicate` and the same receipt; a different payload under the same key is `409 conflict`.
 * - An outcome on a request id the mock never served keeps the published behaviour (`accepted`).
 * - Learning controls keep per-call-type state. Enabling seeds a three-version history (as if
 *   learning had already run) so pause / rollback / promote have something to act on. Call type
 *   `ct_needs_consent` refuses enable with `consent_required` (403), `ct_no_provider` with
 *   `learning_provider_unavailable` (409), `ct_missing` is `not_found` (404).
 */
import { createHash } from 'node:crypto';

const NOW = '2026-01-01T00:00:00.000Z';
const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;

function sha(text) {
  return createHash('sha256').update(text).digest('hex');
}

/** Canonical JSON (sorted keys) for payload comparison. */
function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
    .join(',')}}`;
}

function errorBody(code, message, retryable = false) {
  return { error: { code, message, request_id: 'req_mock_error', retryable } };
}

const TEACHING_CHANNELS = new Set(['computable', 'resolution', 'correction', 'mechanical']);

/** The order-desk tool names the scripted policy recognises. */
const ORDER_DESK_TOOLS = ['lookup_order', 'check_stock', 'reserve_stock', 'set_order_status'];

function firstUserText(messages) {
  for (const m of messages ?? []) {
    if (m?.role !== 'user') continue;
    if (typeof m.content === 'string') return m.content;
    if (Array.isArray(m.content)) return m.content.map((p) => p?.text ?? '').join(' ');
  }
  return '';
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * The scripted order-desk policy: for each order the task names (in order) look it up, check its
 * stock, then reserve it and mark it `reserved`, or mark it `backordered` when the stock does not
 * cover it. One tool call per turn; the k-th tool result answers the k-th scripted step. Returns
 * `{ toolCall }` for the next step or `{ content }` when every order is handled.
 */
export function orderDeskStep(messages) {
  const orders = firstUserText(messages).match(/\b[A-Z]-\d{3}\b/g) ?? [];
  const results = (messages ?? [])
    .filter((m) => m?.role === 'tool')
    .map((m) => parseJson(typeof m.content === 'string' ? m.content : ''));
  let k = 0;
  const done = [];
  const next = (name, args) => ({
    toolCall: { name, arguments: JSON.stringify(args), id: `call_mock_${String(k + 1)}` },
  });
  for (const id of orders) {
    if (k >= results.length) return next('lookup_order', { order_id: id });
    const order = results[k++];
    if (order?.ok !== true) {
      done.push(`${id} not found`);
      continue;
    }
    if (k >= results.length) return next('check_stock', { sku: order.sku });
    const stock = results[k++];
    if ((stock?.in_stock ?? 0) >= order.quantity) {
      if (k >= results.length)
        return next('reserve_stock', { order_id: id, sku: order.sku, quantity: order.quantity });
      k += 1;
      if (k >= results.length)
        return next('set_order_status', { order_id: id, status: 'reserved' });
      k += 1;
      done.push(`${id} reserved`);
    } else {
      if (k >= results.length)
        return next('set_order_status', { order_id: id, status: 'backordered' });
      k += 1;
      done.push(`${id} backordered`);
    }
  }
  return { content: `Done: ${done.join(', ') || 'no orders named'}.` };
}

/** Whether a chat request offers the order-desk tools. */
export function isOrderDeskRequest(body) {
  const names = new Set((body?.tools ?? []).map((t) => t?.function?.name));
  return ORDER_DESK_TOOLS.every((n) => names.has(n));
}

export function createLearningMock() {
  let requestCounter = 0;
  let receiptCounter = 0;
  /** requestId → { episodeKey, landed } */
  const served = new Map();
  /** receiptId → receipt */
  const receipts = new Map();
  /** `${request}\n${kind}\n${source_event_id}` → { receiptId, payload } */
  const keys = new Map();
  /** callTypeId → learning state */
  const learning = new Map();

  /** Resolve the request id for an inference call, or an error answer for a malformed one. */
  function requestIdFor(headers) {
    const sent = headers['x-ur-request-id'];
    if (sent === undefined) {
      requestCounter += 1;
      return { id: `req_mock_${String(requestCounter).padStart(6, '0')}` };
    }
    if (typeof sent !== 'string' || !REQUEST_ID.test(sent)) {
      return {
        error: errorBody(
          'invalid_request',
          'x-ur-request-id must be 1-64 characters of A-Z, a-z, 0-9, "_" or "-"',
        ),
      };
    }
    return { id: sent };
  }

  function onServed(requestId, episodeKey) {
    served.set(requestId, { episodeKey: episodeKey ?? null, landed: false });
  }

  /** Land a served request: apply each of its pending receipts. */
  function land(requestId) {
    const row = served.get(requestId);
    if (row === undefined) return;
    row.landed = true;
    for (const receipt of receipts.values()) {
      if (receipt.request_id === requestId && receipt.status === 'pending') apply(receipt, row);
    }
  }

  function apply(receipt, row) {
    const teaches = TEACHING_CHANNELS.has(receipt.channel);
    receipt.status = 'applied';
    receipt.outcome_event_id = `oev_mock_${receipt.id.slice('rcpt_'.length)}`;
    receipt.episode = teaches && row.episodeKey !== null ? 'associated' : 'not_applicable';
    receipt.applied_at = NOW;
    receipt.updated_at = NOW;
  }

  function resultFor(receipt, status) {
    const teaches = TEACHING_CHANNELS.has(receipt.channel);
    return {
      status,
      id: receipt.outcome_event_id,
      source_event_id: receipt.source_event_id,
      canonical_target_id: null,
      target_kind: 'artifact',
      artifact_version: null,
      latency_class: 'instant',
      source: 'declared',
      learning_use: teaches ? ['train', 'calibrate', 'rank'] : ['rank'],
      reason: null,
      receipt: { ...receipt },
    };
  }

  /** `POST /v1/requests/{id}/outcomes` for a served request; `null` when the mock never served it. */
  function reportOutcome(requestId, body) {
    const row = served.get(requestId);
    if (row === undefined) return null;
    const event = body ?? {};
    const key = `${requestId}\n${event.kind}\n${event.source_event_id ?? ''}`;
    const payload = canonical(event);
    const prior = keys.get(key);
    if (prior !== undefined) {
      if (prior.payload !== payload) {
        return {
          status: 409,
          body: errorBody('conflict', 'a different outcome was already reported under this key'),
        };
      }
      return { status: 202, body: resultFor(receipts.get(prior.receiptId), 'duplicate') };
    }
    receiptCounter += 1;
    const receipt = {
      object: 'outcome_receipt',
      id: `rcpt_${String(receiptCounter).padStart(6, '0')}`,
      request_id: requestId,
      status: 'pending',
      reason: null,
      episode: 'pending',
      channel: event.channel,
      kind: event.kind,
      source_event_id: event.source_event_id ?? null,
      outcome_event_id: null,
      created_at: NOW,
      updated_at: NOW,
      applied_at: null,
      expires_at: NOW,
    };
    receipts.set(receipt.id, receipt);
    keys.set(key, { receiptId: receipt.id, payload });
    if (row.landed) apply(receipt, row);
    return {
      status: 202,
      body: resultFor(receipt, receipt.status === 'pending' ? 'pending' : 'accepted'),
    };
  }

  // ── learning controls ──

  function version(id, state, extra = {}) {
    return {
      id,
      state,
      state_reason: null,
      parent_version_id: null,
      lesson_count: 2,
      evaluation_id: null,
      created_at: NOW,
      ...extra,
    };
  }

  function seeded(callTypeId, params) {
    return {
      call_type_id: callTypeId,
      state: 'active',
      reason: null,
      provider: { model: params.reflection_model, state: 'ready' },
      promotion:
        typeof params.promotion === 'string'
          ? { mode: params.promotion, objective: 'success' }
          : (params.promotion ?? { mode: 'evaluate', objective: 'success' }),
      versions: [
        version('lv_mock_3', 'evaluating', {
          parent_version_id: 'lv_mock_2',
          evaluation_id: 'lev_mock_1',
        }),
        version('lv_mock_2', 'active', { parent_version_id: 'lv_mock_1' }),
        version('lv_mock_1', 'retired'),
      ],
      evaluations: [
        {
          id: 'lev_mock_1',
          decision: 'running',
          reason: null,
          objective: 'success',
          rule: {
            min_verified_per_arm: 30,
            max_verified_per_arm: 200,
            alpha: 0.05,
            min_effect_pp: 0,
          },
          candidate: { version_id: 'lv_mock_3', verified: 12, passed: 9, unknown: 1 },
          incumbent: { version_id: 'lv_mock_2', verified: 11, passed: 7, unknown: 2 },
          interval: { lower: null, upper: null },
          started_at: NOW,
          decided_at: null,
        },
      ],
    };
  }

  function statusOf(callTypeId) {
    const s = learning.get(callTypeId);
    if (s === undefined) {
      return {
        object: 'learning_status',
        call_type_id: callTypeId,
        state: 'not_enabled',
        reason: null,
        provider: null,
        promotion: null,
        active: null,
        candidate: null,
        evaluation: null,
        evidence: { arrived: 0, verified: 0, incorporated: 0, pending: 0 },
        backlog: 0,
        budget: { state: 'ok', remaining_usd: null },
      };
    }
    const ref = (v) =>
      v === undefined ? null : { id: v.id, state: v.state, created_at: v.created_at };
    const active = s.versions.find((v) => v.state === 'active');
    const candidate = s.versions.find((v) => v.state === 'candidate' || v.state === 'evaluating');
    return {
      object: 'learning_status',
      call_type_id: callTypeId,
      state: s.state,
      reason: s.reason,
      provider: s.provider,
      promotion: s.promotion,
      active: ref(active),
      candidate: ref(candidate),
      evaluation: s.evaluations[0] ?? null,
      evidence: { arrived: 40, verified: 31, incorporated: 23, pending: 2 },
      backlog: 2,
      budget: { state: 'ok', remaining_usd: 4.5 },
    };
  }

  /** Answer a learning route, or `null` when the path is not one. */
  function learningRoute(method, path, body) {
    const m = /^\/v1\/call-types\/([^/]+)\/learning(?:\/(.*))?$/.exec(path);
    if (m === null) return null;
    const id = decodeURIComponent(m[1] ?? '');
    const rest = m[2] ?? '';
    if (id === 'ct_missing')
      return { status: 404, body: errorBody('not_found', 'call type not found') };
    const s = learning.get(id);
    const ok = (payload) => ({ status: 200, body: payload });
    const needsEnabled = () =>
      s === undefined
        ? { status: 409, body: errorBody('conflict', 'learning is not enabled') }
        : null;

    if (method === 'GET' && rest === '') return ok(statusOf(id));
    if (method === 'POST' && rest === 'enable') {
      if (id === 'ct_needs_consent')
        return {
          status: 403,
          body: errorBody('consent_required', "the workspace's corrections consent is off"),
        };
      if (id === 'ct_no_provider')
        return {
          status: 409,
          body: errorBody(
            'learning_provider_unavailable',
            'no provider key for the reflection model',
          ),
        };
      if (typeof body?.reflection_model !== 'string' || body.reflection_model === '')
        return { status: 400, body: errorBody('invalid_request', 'reflection_model is required') };
      if (s === undefined) learning.set(id, seeded(id, body));
      else {
        s.state = 'active';
        s.reason = null;
      }
      return ok(statusOf(id));
    }
    if (method === 'POST' && (rest === 'pause' || rest === 'resume' || rest === 'disable')) {
      const refused = needsEnabled();
      if (refused !== null) return refused;
      s.state = rest === 'pause' ? 'paused' : rest === 'resume' ? 'active' : 'disabled';
      return ok(statusOf(id));
    }
    if (method === 'GET' && rest === 'versions') {
      return ok({ object: 'list', data: s === undefined ? [] : s.versions.map((v) => ({ ...v })) });
    }
    if (method === 'GET' && rest === 'evaluations') {
      return ok({
        object: 'list',
        data: s === undefined ? [] : s.evaluations.map((e) => ({ ...e })),
      });
    }
    const vm = /^versions\/([^/]+)(?:\/(promote|reject))?$/.exec(rest);
    if (vm !== null) {
      const v = s?.versions.find((x) => x.id === decodeURIComponent(vm[1] ?? ''));
      if (v === undefined)
        return { status: 404, body: errorBody('not_found', 'version not found') };
      if (method === 'GET' && vm[2] === undefined) {
        return ok({
          ...v,
          lessons: [
            {
              id: `les_${v.id}_1`,
              text: 'Check the current stock before reserving; never assume a fixed quantity.',
              tool: 'check_stock',
              evidence_count: 4,
            },
            {
              id: `les_${v.id}_2`,
              text: 'Mark an order backordered when the stock left does not cover it.',
              tool: null,
              evidence_count: 3,
            },
          ],
          provenance: { episodes: 18, outcomes: 18 },
        });
      }
      if (method === 'POST' && vm[2] !== undefined) {
        if (v.state !== 'candidate' && v.state !== 'evaluating')
          return {
            status: 409,
            body: errorBody('conflict', `version is ${v.state}, not a candidate`),
          };
        if (vm[2] === 'promote') {
          for (const other of s.versions) if (other.state === 'active') other.state = 'retired';
          v.state = 'active';
        } else v.state = 'rejected';
        v.state_reason = `manual_${vm[2]}`;
        const ev = s.evaluations.find(
          (e) => e.candidate?.version_id === v.id && e.decision === 'running',
        );
        if (ev !== undefined) {
          ev.decision = 'stopped_manual';
          ev.decided_at = NOW;
        }
        return ok({ ...v });
      }
    }
    if (method === 'POST' && rest === 'rollback') {
      const refused = needsEnabled();
      if (refused !== null) return refused;
      const target = s.versions.find((x) => x.id === body?.version_id);
      if (target === undefined)
        return { status: 404, body: errorBody('not_found', 'version not found') };
      if (target.state === 'rejected')
        return { status: 409, body: errorBody('conflict', 'a rejected version cannot serve') };
      for (const other of s.versions) if (other.state === 'active') other.state = 'retired';
      target.state = 'active';
      target.state_reason = 'rollback';
      return ok(statusOf(id));
    }
    return { status: 404, body: errorBody('not_found', `no learning route ${method} ${path}`) };
  }

  /**
   * Answer the receipt and learning routes. Returns `{ status, body }`, or `null` when the request
   * is not one of them (or is an outcome on a request the mock never served).
   */
  function route(method, path, body) {
    const learn = learningRoute(method, path, body);
    if (learn !== null) return learn;
    const one = /^\/v1\/outcome-receipts\/([^/]+)$/.exec(path);
    if (one !== null && method === 'GET') {
      const receipt = receipts.get(decodeURIComponent(one[1] ?? ''));
      if (receipt === undefined)
        return { status: 404, body: errorBody('not_found', 'receipt not found') };
      land(receipt.request_id);
      return { status: 200, body: { ...receipt } };
    }
    const list = /^\/v1\/requests\/([^/]+)\/outcome-receipts$/.exec(path);
    if (list !== null && method === 'GET') {
      const requestId = decodeURIComponent(list[1] ?? '');
      land(requestId);
      const data = [...receipts.values()]
        .filter((r) => r.request_id === requestId)
        .map((r) => ({ ...r }));
      return { status: 200, body: { object: 'list', data } };
    }
    const out = /^\/v1\/requests\/([^/]+)\/outcomes$/.exec(path);
    if (out !== null && method === 'POST')
      return reportOutcome(decodeURIComponent(out[1] ?? ''), body);
    return null;
  }

  return {
    requestIdFor,
    onServed,
    route,
    /** Every receipt, for test assertions. */
    receipts: () => [...receipts.values()].map((r) => ({ ...r })),
    /** Served request ids, for test assertions. */
    served: () => [...served.keys()],
  };
}
