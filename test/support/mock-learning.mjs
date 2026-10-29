/**
 * The plug-and-play learning part of the local mock gateway: request correlation, durable outcome
 * receipts, learning controls, and a scripted (non-model) tool-calling policy for the order-desk
 * demonstration tools. Used by `test/support/mock-gateway.mjs`; never calls a model provider.
 *
 * Behaviour the examples and tests rely on (shapes as the published API description defines them):
 * - Every chat / embeddings call has a request id: the client's `x-ur-request-id` when it sent a
 *   valid one, else a minted `req_mock_<n>`. The mock remembers it as served, with its episode key
 *   (`x-ur-artifact` or body `ur.artifact`).
 * - The request "row" of a served request lands lazily: an outcome reported on it before anything
 *   has read its receipts is `pending` (with a durable `ocr_…` receipt); the first read of a receipt
 *   (by id or by request) applies every pending receipt of that request. That makes the
 *   immediate-outcome path deterministic without sleeping. A receipt on a request the mock never
 *   served expires on its first read (`request_not_found`); an unknown gateway-format id
 *   (`req_<ULID>`) is refused at once (404 `request_not_found: …`).
 * - Outcome reports are idempotent on (request, kind, source_event_id): the same payload returns
 *   `duplicate` and the same receipt; a different payload under the same key is `409 conflict`.
 * - An applied teaching outcome (computable, resolution, correction) on a request with an episode
 *   key is `associated` (the first verdict of an episode is `recorded`, later ones `kept_earlier`);
 *   without a key it is `not_recorded`; any other channel is `not_applicable`.
 * - Learning controls keep per-call-type state and answer `learning` / `learning_control` objects.
 *   Enabling seeds a three-version history (as if learning had already run: `epb_mock_1` retired,
 *   `epb_mock_2` active, `epb_mock_3` evaluating in `lev_mock_1`) so pause / rollback / promote have
 *   something to act on. Refusals carry the gateway's named refusal as the message's first token:
 *   `ct_needs_consent` → 409 `corrections_consent_required: …`, `ct_no_provider` → 400
 *   `reflection_model_not_workspace_owned (no_workspace_key): …`, a control before enable → 409
 *   `learning_not_enabled: …`, `ct_missing` → 404.
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

/** The channels whose outcomes teach (a proxy, behavioral or mechanical signal never does). */
const TEACHING_CHANNELS = new Set(['computable', 'resolution', 'correction']);

/** A gateway-minted request id (`req_<ULID>`): unknown ones are refused at once, not held. */
const GATEWAY_MINTED = /^req_[0-9A-HJKMNP-TV-Z]{26}$/;

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
  /** episodeKey → whether a teaching verdict is already recorded on it */
  const episodes = new Map();
  /** callTypeId → learning state */
  const learning = new Map();
  const toolDocumentation = new Map();

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

  /** Land a request: apply its pending receipts (or expire them when it was never served). */
  function land(requestId) {
    const row = served.get(requestId);
    if (row !== undefined) row.landed = true;
    for (const receipt of receipts.values()) {
      if (receipt.request_id !== requestId || receipt.status !== 'pending') continue;
      if (row === undefined) expire(receipt);
      else apply(receipt, row);
    }
  }

  function expire(receipt) {
    receipt.status = 'expired';
    receipt.reason = 'request_not_found';
    receipt.episode = { status: 'not_applicable', trace_id: null, verdict: null };
    receipt.updated_at = NOW;
  }

  function apply(receipt, row) {
    const n = receipt.id.slice('ocr_mock_'.length);
    receipt.status = 'applied';
    receipt.outcome_event_id = `oev_mock_${n}`;
    receipt.outcome_status = 'accepted';
    receipt.artifact_id = `art_${sha(row.episodeKey ?? receipt.request_id).slice(0, 12)}`;
    receipt.applied_at = NOW;
    receipt.updated_at = NOW;
    if (!TEACHING_CHANNELS.has(receipt.channel)) {
      receipt.episode = { status: 'not_applicable', trace_id: null, verdict: null };
    } else if (row.episodeKey === null) {
      receipt.episode = { status: 'not_recorded', trace_id: null, verdict: null };
    } else {
      const first = episodes.get(row.episodeKey) !== true;
      episodes.set(row.episodeKey, true);
      receipt.episode = {
        status: 'associated',
        trace_id: `ept_${sha(row.episodeKey).slice(0, 12)}`,
        verdict: first ? 'recorded' : 'kept_earlier',
      };
    }
  }

  function resultFor(receipt, status) {
    const teaches = TEACHING_CHANNELS.has(receipt.channel);
    const applied = receipt.status === 'applied';
    return {
      object: 'outcome',
      status,
      id: receipt.outcome_event_id,
      source_event_id: receipt.source_event_id,
      canonical_target_id: receipt.artifact_id,
      target_kind: applied ? 'artifact' : null,
      artifact_version: applied ? 1 : null,
      latency_class: 'instant',
      source: 'declared',
      learning_use: teaches ? ['train', 'calibrate', 'rank'] : ['rank'],
      reason: null,
      artifact_id: receipt.artifact_id,
      receipt: { ...receipt, episode: { ...receipt.episode } },
    };
  }

  /** `POST /v1/requests/{id}/outcomes`. */
  function reportOutcome(requestId, body) {
    const event = body ?? {};
    if (typeof event.channel !== 'string' || typeof event.kind !== 'string') {
      return {
        status: 400,
        body: errorBody('invalid_request', '`channel` and `kind` are required'),
      };
    }
    const row = served.get(requestId);
    if (row === undefined && GATEWAY_MINTED.test(requestId)) {
      return {
        status: 404,
        body: errorBody(
          'not_found',
          'request_not_found: no request with this id was recorded in your workspace',
        ),
      };
    }
    const key = `${requestId}\n${event.kind}\n${event.source_event_id ?? ''}`;
    const payload = canonical(event);
    const prior = event.source_event_id === undefined ? undefined : keys.get(key);
    if (prior !== undefined) {
      if (prior.payload !== payload) {
        return {
          status: 409,
          body: errorBody(
            'conflict',
            'idempotency_conflict: a different outcome was already reported under this key',
          ),
        };
      }
      return { status: 202, body: resultFor(receipts.get(prior.receiptId), 'duplicate') };
    }
    receiptCounter += 1;
    const n = String(receiptCounter).padStart(6, '0');
    const teaches = TEACHING_CHANNELS.has(event.channel);
    const receipt = {
      object: 'outcome_receipt',
      id: `ocr_mock_${n}`,
      request_id: requestId,
      status: 'pending',
      reason: null,
      channel: event.channel,
      kind: event.kind,
      source_event_id: event.source_event_id ?? `oev_srv_${n}`,
      outcome_event_id: null,
      outcome_status: null,
      artifact_id: null,
      episode: { status: teaches ? 'pending' : 'not_applicable', trace_id: null, verdict: null },
      attempts: 0,
      created_at: NOW,
      updated_at: NOW,
      applied_at: null,
      expires_at: NOW,
    };
    receipts.set(receipt.id, receipt);
    keys.set(key, { receiptId: receipt.id, payload });
    if (row !== undefined && row.landed) apply(receipt, row);
    return {
      status: 202,
      body: resultFor(receipt, receipt.status === 'pending' ? 'pending' : 'accepted'),
    };
  }

  // ── learning controls ──

  const DEFAULT_POLICY = {
    mode: 'evaluate',
    objective: 'success',
    min_verified_per_arm: 30,
    max_verified_per_arm: 200,
    alpha: 0.05,
    min_effect_pp: 0,
    noninferiority_margin_pp: 5,
    candidate_share: 0.5,
    max_duration_hours: 720,
  };

  function version(id, n, state, extra = {}) {
    return {
      object: 'learning_version',
      id,
      version: n,
      parent_id: n > 1 ? `epb_mock_${String(n - 1)}` : null,
      state,
      state_reason: null,
      state_since: NOW,
      evaluation_id: null,
      digest: `epb1_${sha(id).slice(0, 24)}`,
      recipe: 'elv2+atomic+elo2',
      created_at: NOW,
      active_lessons: 2,
      cohort: { size: 12, pass: 8, fail: 4 },
      reflection_model: null,
      ...extra,
    };
  }

  function arm(verified, pass, unknown) {
    return {
      verified,
      pass,
      unknown,
      success_rate: verified === 0 ? null : pass / verified,
      cost_micro_usd: null,
      mean_cost_micro_usd: null,
    };
  }

  function seeded(callTypeId, params) {
    const model = params.reflection_model;
    return {
      paused: false,
      disabled: false,
      reflectionModel: model,
      policy: { ...DEFAULT_POLICY, ...(params.promotion ?? {}) },
      activeHistory: ['epb_mock_1', 'epb_mock_2'],
      versions: [
        version('epb_mock_3', 3, 'evaluating', {
          evaluation_id: 'lev_mock_1',
          reflection_model: model,
        }),
        version('epb_mock_2', 2, 'active', { reflection_model: model }),
        version('epb_mock_1', 1, 'retired', { reflection_model: model }),
      ],
      evaluations: [
        {
          object: 'learning_evaluation',
          id: 'lev_mock_1',
          call_type_id: callTypeId,
          candidate_version_id: 'epb_mock_3',
          incumbent_version_id: 'epb_mock_2',
          decision: 'running',
          decision_reason: 'window_open',
          rule: {
            rule_version: 'lrv1',
            objective: 'success',
            min_verified_per_arm: 30,
            max_verified_per_arm: 200,
            alpha_one_sided: 0.05,
            min_effect_pp: 0,
            noninferiority_margin_pp: 5,
            candidate_share: 0.5,
            max_duration_hours: 720,
            interval: 'newcombe_hybrid_score',
            outcome_source: 'verified_teaching_episode',
          },
          rule_hash: `lrh1_${sha('lev_mock_1').slice(0, 24)}`,
          arms: { candidate: arm(12, 9, 1), incumbent: arm(11, 7, 2) },
          difference: { point: 0.11, lower: -0.19, upper: 0.41 },
          started_at: NOW,
          decided_at: null,
          decided_by: null,
        },
      ],
    };
  }

  const ref = (v) =>
    v === undefined
      ? null
      : {
          id: v.id,
          version: v.version,
          state: v.state,
          active_lessons: v.active_lessons,
          digest: v.digest,
          created_at: v.created_at,
        };

  function statusOf(callTypeId) {
    const s = learning.get(callTypeId);
    const on = s !== undefined;
    const active = on ? s.versions.find((v) => v.state === 'active') : undefined;
    const candidate = on
      ? s.versions.find((v) => v.state === 'candidate' || v.state === 'evaluating')
      : undefined;
    const running = on ? s.evaluations.find((e) => e.decision === 'running') : undefined;
    const state = !on
      ? 'off'
      : s.disabled
        ? 'disabled'
        : s.paused
          ? 'paused'
          : running !== undefined
            ? 'learning'
            : 'collecting';
    const reasons = {
      off: 'not_enabled',
      disabled: 'disabled_by_owner',
      paused: 'paused_by_owner',
      learning: 'evaluation_running',
      collecting: 'waiting_for_evidence',
    };
    return {
      object: 'learning',
      call_type_id: callTypeId,
      config_version: on ? 2 : null,
      state,
      reason: reasons[state],
      enabled: on && !s.disabled,
      self_serve: on,
      governed: on,
      paused: on && s.paused,
      recipe: on
        ? { validator: 'elv2', generation: 'atomic', observations: 'elo2', legacy: false }
        : null,
      reflection: {
        model: on ? s.reflectionModel : null,
        provider: {
          available: on,
          reason: on ? null : 'no_reflection_model',
          ownership: on ? 'byok' : null,
          provider_slug: on ? 'openai' : null,
        },
        last_attempt_at: on ? NOW : null,
        last_attempt_status: on ? 'published' : null,
        last_attempt_reason: null,
        last_published_at: on ? NOW : null,
        next: {
          will_run: false,
          reason: on ? 'evaluation_running' : 'not_enabled',
          retry_at: null,
          min_episodes: 8,
          idle_minutes: 10,
        },
      },
      promotion: on ? { ...s.policy } : null,
      active_version: ref(active),
      latest_candidate: ref(candidate),
      evaluation: running === undefined ? null : { ...running },
      last_evaluation: on && s.evaluations[0] !== undefined ? { ...s.evaluations[0] } : null,
      evidence: on
        ? {
            recorded: 40,
            verified: 31,
            verified_pass: 22,
            verified_fail: 9,
            unknown: 9,
            consumed: 27,
            incorporated_active: 23,
            backlog: 4,
            pending_reflection: 4,
            latest_verified_at: NOW,
          }
        : {
            recorded: 0,
            verified: 0,
            verified_pass: 0,
            verified_fail: 0,
            unknown: 0,
            consumed: 0,
            incorporated_active: 0,
            backlog: 0,
            pending_reflection: 0,
            latest_verified_at: null,
          },
      budget: {
        state: 'ok',
        consecutive_refusals: 0,
        last_refusal_at: null,
        failures_since_reset: 0,
        failure_ceiling: 5,
      },
      usage: on
        ? {
            reflections: 3,
            failed_calls: 0,
            input_tokens: 18000,
            output_tokens: 2400,
            cash_micro_usd: 0,
          }
        : { reflections: 0, failed_calls: 0, input_tokens: 0, output_tokens: 0, cash_micro_usd: 0 },
      outcome_receipts: on
        ? { pending: 1, applied: 30, rejected: 0, failed: 0, expired: 1, episode_pending: 0 }
        : { pending: 0, applied: 0, rejected: 0, failed: 0, expired: 0, episode_pending: 0 },
    };
  }

  function control(callTypeId, action, changed, extra = {}) {
    return {
      status: 200,
      body: {
        object: 'learning_control',
        action,
        call_type_id: callTypeId,
        changed,
        version_id: null,
        stopped_evaluation_id: null,
        ...extra,
        learning: statusOf(callTypeId),
      },
    };
  }

  const refuse = (status, code, message) => ({ status, body: errorBody(code, message) });

  /** Stop a running evaluation of `versionId` by hand; returns its id or null. */
  function stopEvaluation(s, versionId) {
    const ev = s.evaluations.find(
      (e) => e.candidate_version_id === versionId && e.decision === 'running',
    );
    if (ev === undefined) return null;
    ev.decision = 'stopped_manual';
    ev.decision_reason = 'stopped_manual';
    ev.decided_at = NOW;
    ev.decided_by = { type: 'api_key', id: 'key_mock' };
    return ev.id;
  }

  /** Make `target` the active version (the previous one retires). */
  function activate(s, target, reason) {
    for (const v of s.versions) {
      if (v.state === 'active') {
        v.state = 'retired';
        v.state_reason = reason;
      }
    }
    target.state = 'active';
    target.state_reason = reason;
    s.activeHistory.push(target.id);
  }

  /** Answer a learning route, or `null` when the path is not one. */
  function learningRoute(method, path, body) {
    const m = /^\/v1\/call-types\/([^/]+)\/learning(?:\/(.*))?$/.exec(path);
    if (m === null) return null;
    const id = decodeURIComponent(m[1] ?? '');
    const rest = m[2] ?? '';
    if (id === 'ct_missing') return refuse(404, 'not_found', `call type '${id}' not found`);
    const s = learning.get(id);
    const ok = (payload) => ({ status: 200, body: payload });
    const notEnabled = () =>
      refuse(
        409,
        'conflict',
        'learning_not_enabled: learning is not enabled for this call type through the learning API — POST …/learning/enable first',
      );

    if (method === 'GET' && rest === '') return ok(statusOf(id));
    if (rest === 'tool-documentation' && (method === 'GET' || method === 'PUT')) {
      if (method === 'PUT')
        toolDocumentation.set(id, {
          object: 'learning_tool_documentation',
          call_type_id: id,
          tool_count: body.tools.length,
          digest: body.tools.length ? 'etd1_mock' : null,
          updated_at: null,
          tools: [],
          changed: true,
        });
      return ok(
        toolDocumentation.get(id) ?? {
          object: 'learning_tool_documentation',
          call_type_id: id,
          tool_count: 0,
          digest: null,
          updated_at: null,
          tools: [],
        },
      );
    }
    if (method === 'POST' && rest === 'enable') {
      if (typeof body?.reflection_model !== 'string' || body.reflection_model.trim() === '')
        return refuse(400, 'invalid_request', 'reflection_model: Required');
      if (id === 'ct_needs_consent')
        return refuse(
          409,
          'conflict',
          'corrections_consent_required: learning stores episode content, so the workspace corrections consent must be on (PUT /v1/workspaces/{id}/self-learning)',
        );
      if (id === 'ct_no_provider')
        return refuse(
          400,
          'invalid_request',
          `reflection_model_not_workspace_owned (no_workspace_key): '${body.reflection_model}' must resolve to one of this workspace's custom providers or a provider it stored its own key for — there is no platform fallback`,
        );
      const promotion = body.promotion;
      if (promotion !== undefined && (typeof promotion !== 'object' || promotion === null))
        return refuse(400, 'invalid_request', 'promotion: Expected object');
      const policy = { ...(s?.policy ?? DEFAULT_POLICY), ...(promotion ?? {}) };
      if (policy.min_verified_per_arm > policy.max_verified_per_arm)
        return refuse(400, 'invalid_request', 'promotion_invalid (min_exceeds_max)');
      if (s === undefined) {
        learning.set(id, seeded(id, body));
        return control(id, 'enable', true);
      }
      const changed = s.disabled || s.paused;
      s.disabled = false;
      s.paused = false;
      s.policy = policy;
      return control(id, 'enable', changed);
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
    if (method === 'POST' && rest === 'disable') {
      if (s === undefined) return control(id, 'disable', false);
      const changed = !s.disabled;
      s.disabled = true;
      return control(id, 'disable', changed);
    }
    if (method === 'POST' && (rest === 'pause' || rest === 'resume')) {
      if (s === undefined) return notEnabled();
      const want = rest === 'pause';
      const changed = s.paused !== want;
      s.paused = want;
      return control(id, rest, changed);
    }
    if (method === 'POST' && rest === 'rollback') {
      if (s === undefined) return notEnabled();
      const active = s.versions.find((v) => v.state === 'active');
      let target;
      if (typeof body?.version_id === 'string') {
        target = s.versions.find((v) => v.id === body.version_id);
        if (target === undefined)
          return refuse(404, 'not_found', `version '${body.version_id}' not found`);
        if (target.state === 'active')
          return refuse(409, 'conflict', 'version_already_active: the version is already active');
        if (active !== undefined && target.version > active.version)
          return refuse(
            409,
            'conflict',
            'rollback_target_not_earlier: a rollback moves the active pointer to an EARLIER version',
          );
      } else {
        const previous = s.activeHistory.at(-2);
        target = s.versions.find((v) => v.id === previous);
        if (target === undefined)
          return refuse(
            409,
            'conflict',
            'no_rollback_target: no version was active before this one',
          );
      }
      activate(s, target, 'rollback');
      return control(id, 'rollback', true, { version_id: target.id });
    }
    const vm = /^versions\/([^/]+)(?:\/(promote|reject))?$/.exec(rest);
    if (vm !== null) {
      const versionId = decodeURIComponent(vm[1] ?? '');
      const v = s?.versions.find((x) => x.id === versionId);
      if (method === 'GET' && vm[2] === undefined) {
        if (v === undefined) return refuse(404, 'not_found', `version '${versionId}' not found`);
        return ok({
          ...v,
          lessons: [
            {
              id: `les_${v.id}_1`,
              text: 'Check the current stock before reserving; never assume a fixed quantity.',
              evidence_cases: 4,
            },
            {
              id: `les_${v.id}_2`,
              text: 'Mark an order backordered when the stock left does not cover it.',
              evidence_cases: 3,
            },
          ],
          retired_lessons: 0,
          known_functions: 4,
          distiller: {
            provider: 'openai',
            model: v.reflection_model,
            request_hash: `sha256:${sha(`${v.id}:req`)}`,
            response_hash: `sha256:${sha(`${v.id}:res`)}`,
            input_tokens: 6000,
            output_tokens: 800,
          },
          transitions: [
            {
              state: 'candidate',
              reason: 'published',
              evaluation_id: null,
              actor_type: 'system',
              actor_id: null,
              at: NOW,
            },
            {
              state: v.state,
              reason: v.state_reason ?? 'derived',
              evaluation_id: v.evaluation_id,
              actor_type: 'system',
              actor_id: null,
              at: NOW,
            },
          ],
        });
      }
      if (method === 'POST' && vm[2] !== undefined) {
        if (s === undefined) return notEnabled();
        if (v === undefined) return refuse(404, 'not_found', `version '${versionId}' not found`);
        if (vm[2] === 'promote') {
          if (v.state === 'active')
            return refuse(409, 'conflict', 'version_already_active: the version is already active');
          const stopped = stopEvaluation(s, v.id);
          activate(s, v, 'manual_promote');
          return control(id, 'promote', true, { version_id: v.id, stopped_evaluation_id: stopped });
        }
        if (v.state === 'active')
          return refuse(
            409,
            'conflict',
            'version_active: the active version cannot be rejected; roll back first',
          );
        const stopped = stopEvaluation(s, v.id);
        const changed = v.state !== 'rejected';
        v.state = 'rejected';
        v.state_reason = 'manual_reject';
        return control(id, 'reject', changed, { version_id: v.id, stopped_evaluation_id: stopped });
      }
    }
    return refuse(404, 'not_found', `no learning route ${method} ${path}`);
  }

  /**
   * Answer the receipt and learning routes. Returns `{ status, body }`, or `null` when the request
   * is not one of them.
   */
  function route(method, path, body) {
    const learn = learningRoute(method, path, body);
    if (learn !== null) return learn;
    const one = /^\/v1\/outcome-receipts\/([^/]+)$/.exec(path);
    if (one !== null && method === 'GET') {
      const receipt = receipts.get(decodeURIComponent(one[1] ?? ''));
      if (receipt === undefined) return refuse(404, 'not_found', 'receipt not found');
      land(receipt.request_id);
      return { status: 200, body: { ...receipt, episode: { ...receipt.episode } } };
    }
    const list = /^\/v1\/requests\/([^/]+)\/outcome-receipts$/.exec(path);
    if (list !== null && method === 'GET') {
      const requestId = decodeURIComponent(list[1] ?? '');
      land(requestId);
      const data = [...receipts.values()]
        .filter((r) => r.request_id === requestId)
        .map((r) => ({ ...r, episode: { ...r.episode } }));
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
    receipts: () => [...receipts.values()].map((r) => ({ ...r, episode: { ...r.episode } })),
    /** Served request ids, for test assertions. */
    served: () => [...served.keys()],
  };
}
