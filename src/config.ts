/**
 * Construction defaults and their per-call precedence. Every default (`defaultModel`, and
 * `defaults.{router, compression, callType, provider, maxCostUsd}`) can be overridden per call: a
 * per-call value always wins, and an omitted per-call value falls back to the default. Pure and
 * unit-tested.
 */

import type {
  AutopilotMode,
  BenchInitTag,
  BenchTag,
  ChatCompletionCreateParams,
  EmbeddingCreateParams,
  RouterMode,
  UltraRouterDefaults,
  UrRequestOptions,
} from './types.js';

/**
 * The one-line Autopilot intent. It is the ONLY intent-level
 * option — the primary quickstart stays a base-URL/key swap. It maps onto the
 * autonomy states through the existing config `router` layer (never a new
 * header protocol):
 *
 * `'audit'` → `router: 'off'` — passive observation only (the default posture).
 * `'recommend'` → `router: 'candidates'` — rank the approved candidate list; you choose.
 * `'auto'` → `router: 'auto'` — earned full autonomy.
 *
 * The ordering matches the gateway's autonomy rank, so a per-request
 * `router` can only DOWNGRADE from the client's declared intent (an upgrade is
 * clamped). `'auto'` is intent only: it never bypasses the gateway's own checks, and the
 * gateway holds traffic until the evidence qualifies.
 */
export const AUTOPILOT_ROUTER: Readonly<Record<AutopilotMode, RouterMode>> = {
  audit: 'off',
  recommend: 'candidates',
  auto: 'auto',
};

/** Autonomy rank per router mode (mirrors the gateway table). */
const AUTONOMY_RANK: Readonly<Record<RouterMode, number>> = {
  off: 0,
  candidates: 1,
  auto: 2,
};

/**
 * Downgrade-only: a per-request `router` may only LOWER autonomy below the
 * client's Autopilot level. A strictly higher request router is clamped DOWN to the
 * ceiling (never an upgrade, never a bypass); an equal-or-lower one passes through.
 */
export function clampRouterDowngrade(requested: RouterMode, ceiling: RouterMode): RouterMode {
  return AUTONOMY_RANK[requested] > AUTONOMY_RANK[ceiling] ? ceiling : requested;
}

/** The resolved config the SDK applies (baseURL/apiKey live on the client). */
export interface ResolvedInit {
  defaultModel?: string | undefined;
  defaults: UltraRouterDefaults;
  /**
   * The client Autopilot router ceiling derived from `autopilot`. When set it
   * is the request-layer router default AND the downgrade-only ceiling for a per-request
   * `router`. Undefined when `autopilot` was not configured (legacy `defaults.router`).
   */
  autopilotRouter?: RouterMode | undefined;
}

/** Merge the init `ur` defaults (only `maxCostUsd` today) under the per-call `ur`. */
function mergeUr(
  callUr: UrRequestOptions | undefined,
  maxCostUsd: number | undefined,
): UrRequestOptions | undefined {
  if (maxCostUsd === undefined) return callUr;
  // A per-call ur.max_cost_usd wins over the init default.
  const merged: UrRequestOptions = { max_cost_usd: maxCostUsd, ...callUr };
  return merged;
}

/**
 * Fold a per-call top-level `bench` tag into the body `ur.bench` extension
 * and strip the top-level field from the wire body. The gateway reads `ur.bench`
 * (which WINS over the `X-UR-Bench-*` init headers body-wins parity); the
 * top-level `bench` is SDK ergonomics only. An explicit top-level `bench` wins over
 * an `ur.bench` already present on the call. Mutates + returns `body`.
 */
function foldBenchIntoUr<T extends { bench?: BenchTag; ur?: UrRequestOptions }>(body: T): T {
  if (body.bench === undefined) return body;
  const bench = body.bench;
  delete body.bench;
  body.ur = { ...(body.ur ?? {}), bench };
  return body;
}

/** The `X-UR-Bench-*` header composition + an optional per-request trace factory. */
export interface ResolvedBenchInit {
  /** The static bench headers stamped on every request (suite + run + string trace). */
  headers: Record<string, string>;
  /** A per-request `X-UR-Bench-Trace` factory (evaluated on each SDK request). */
  traceFactory?: (() => string) | undefined;
  /** The resolved suite slug (for the live-key warning + introspection). */
  suite: string;
}

/** The env vars the init Bench tag falls back to when `bench` is not passed. */
export interface BenchEnv {
  UR_BENCH?: string | undefined;
  UR_BENCH_RUN?: string | undefined;
  UR_BENCH_TRACE?: string | undefined;
}

/**
 * Resolve the init-level Bench tag: the explicit `bench` option WINS; otherwise
 * `UR_BENCH` (optional `UR_BENCH_RUN` / `UR_BENCH_TRACE`) is the env fallback. Returns
 * the static `X-UR-Bench-*` headers (so `asOpenAI()` carries them) plus a per-request
 * trace factory when `trace` is a function. Returns `undefined` when no bench tag is
 * configured. Pure — the env is injected so tests never touch `process.env`.
 */
export function resolveBenchInit(
  bench: BenchInitTag | undefined,
  env: BenchEnv,
): ResolvedBenchInit | undefined {
  let tag: BenchInitTag | undefined = bench;
  if (tag === undefined) {
    const envSuite = env.UR_BENCH?.trim();
    if (envSuite === undefined || envSuite === '') return undefined;
    tag = {
      suite: envSuite,
      ...(env.UR_BENCH_RUN !== undefined && env.UR_BENCH_RUN !== ''
        ? { run: env.UR_BENCH_RUN }
        : {}),
      ...(env.UR_BENCH_TRACE !== undefined && env.UR_BENCH_TRACE !== ''
        ? { trace: env.UR_BENCH_TRACE }
        : {}),
    };
  }
  const norm = typeof tag === 'string' ? { suite: tag } : tag;
  const suite = norm.suite.trim();
  if (suite === '') return undefined;
  const headers: Record<string, string> = { 'x-ur-bench-suite': suite };
  if (norm.run !== undefined && norm.run !== '') headers['x-ur-bench-run'] = norm.run;
  const trace = norm.trace;
  if (typeof trace === 'function') {
    return { headers, suite, traceFactory: trace };
  }
  if (typeof trace === 'string' && trace !== '') headers['x-ur-bench-trace'] = trace;
  return { headers, suite };
}

/**
 * Resolve a chat request body: per-call params override init defaults, field by
 * field. The returned object is the wire body sent to `POST /v1/chat/completions`.
 */
export function applyChatDefaults(
  params: ChatCompletionCreateParams,
  init: ResolvedInit,
): ChatCompletionCreateParams {
  const { defaults } = init;
  const model = params.model ?? init.defaultModel;
  const body: ChatCompletionCreateParams = { ...params };
  if (model !== undefined) body.model = model;
  else delete body.model;
  // Router precedence + Autopilot. When `autopilot` set a ceiling, it is both the
  // request-layer default AND the downgrade-only ceiling: a per-request `router`
  // can only lower autonomy, never raise it. Without an Autopilot ceiling the legacy
  // `defaults.router` default applies and a per-call `router` wins unchanged.
  const ceiling = init.autopilotRouter;
  if (params.router !== undefined) {
    body.router =
      ceiling !== undefined ? clampRouterDowngrade(params.router, ceiling) : params.router;
  } else if (ceiling !== undefined) {
    body.router = ceiling;
  } else if (defaults.router !== undefined) {
    body.router = defaults.router;
  }
  if (params.compression === undefined && defaults.compression !== undefined)
    body.compression = defaults.compression;
  if (params.call_type === undefined && defaults.callType !== undefined)
    body.call_type = defaults.callType;
  if (params.provider === undefined && defaults.provider !== undefined)
    body.provider = defaults.provider;
  const ur = mergeUr(params.ur, defaults.maxCostUsd);
  if (ur !== undefined) body.ur = ur;
  // A per-call `bench` folds into `ur.bench` (body wins over the init headers).
  return foldBenchIntoUr(body);
}

/** Resolve an embeddings request body (model + call_type + ur.maxCostUsd defaults). */
export function applyEmbeddingDefaults(
  params: EmbeddingCreateParams,
  init: ResolvedInit,
): EmbeddingCreateParams {
  const { defaults } = init;
  const model = params.model ?? init.defaultModel;
  const body: EmbeddingCreateParams = { ...params };
  if (model !== undefined) body.model = model;
  else delete body.model;
  if (params.call_type === undefined && defaults.callType !== undefined)
    body.call_type = defaults.callType;
  const ur = mergeUr(params.ur, defaults.maxCostUsd);
  if (ur !== undefined) body.ur = ur;
  // A per-call `bench` folds into `ur.bench` (body wins over the init headers).
  return foldBenchIntoUr(body);
}
