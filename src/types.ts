/**
 * The public request and response types of `@ultrarouter/sdk`. They mirror the OpenAI surface plus
 * the ultrarouter `ur` extensions, and are checked against the generated OpenAPI types by
 * `test/type-conformance.ts` (every generated field must exist here, and every value the SDK sends
 * or returns must be a valid instance of the published schema). Large, immutable response shapes
 * (Bench, the outcome ledger) are aliased straight from the generated schema instead of re-typed.
 */

import type { components } from './generated/types.js';
import type { OutcomeStore } from './flywheel-queue.js';
import type { PreflightCacheOptions } from './preflight.js';
import type { QueuedReviewerEvent } from './reviewer.js';

type Schemas = components['schemas'];

// ---------------------------------------------------------------------------
// The ultrarouter extension vocabulary
// ---------------------------------------------------------------------------

/** Routing mode. `off` serves the requested model; `auto` / `candidates` engage the router. */
export type RouterMode = 'off' | 'auto' | 'candidates';

/**
 * The one-line Autopilot intent (see {@link UltraRouterOptions.autopilot}): `audit` (observe only),
 * `recommend` (rank approved candidates) or `auto` (let the router act once evidence qualifies).
 */
export type AutopilotMode = 'audit' | 'recommend' | 'auto';

/**
 * Compression mode: `off` (the default — no model-visible rewrite), `semantic_safe` (deterministic,
 * evidence-qualified rewrites) or `adaptive` (guarded pruning). `lossless` and `auto` are deprecated
 * legacy aliases that still parse and map to the conservative policy; `lossless` is not a guarantee
 * that the model sees identical text.
 */
export type CompressionMode = 'off' | 'semantic_safe' | 'adaptive' | 'lossless' | 'auto';

/** Structured compression control. */
export interface CompressionOptions {
  /** The compression mode. */
  mode?: CompressionMode;
  /** Message paths that must never be rewritten, e.g. `messages.1.content` or `messages.2`. */
  no_compress_fields?: string[];
  /** How much quality risk lossy pruning may take (maps to a prune-ratio cap). */
  max_quality_risk?: 'low' | 'medium' | 'high';
}

/** The `compression` field: a bare mode or the structured object. */
export type CompressionOption = CompressionMode | CompressionOptions;

/** OpenRouter-compatible provider preferences. */
export interface ProviderPreferences {
  /** Provider slugs to try in this order. */
  order?: string[];
  /** Whether the gateway may fall back to providers outside `order`. */
  allow_fallbacks?: boolean;
  /** Provider slugs to never use. */
  ignore?: string[];
  /** Only use providers that support every request parameter. */
  require_parameters?: boolean;
  /** Whether providers that retain prompts may be used. */
  data_collection?: 'allow' | 'deny';
  /** Allowed quantization levels. */
  quantizations?: string[];
  /** Sort offers by price, throughput or latency. */
  sort?: 'price' | 'throughput' | 'latency';
}

/**
 * The message-origin segment kinds you may label via `ur.segments`. Only `reference_context` and
 * `history` are eligible for lossy compression; the other labels protect a message.
 */
export type SegmentHintKind =
  | 'system_instructions'
  | 'user_question'
  | 'reference_context'
  | 'few_shot_examples'
  | 'tool_results'
  | 'history';

/** A segment label for one message, refining how compression segments the request. */
export interface SegmentHint {
  /** Index into the `messages` array. */
  index: number;
  /** The segment kind of that message. */
  kind: SegmentHintKind;
}

/**
 * A Bench capture tag. A bare string is the suite slug; the object form adds the capture-window
 * `run` label and the multi-call task-grouping `trace`.
 */
export type BenchTag =
  | string
  | {
      suite: string;
      run?: string;
      trace?: string;
    };

/** The construction-time Bench tag: like {@link BenchTag}, but `trace` may be a per-request factory. */
export type BenchInitTag =
  | string
  | {
      suite: string;
      run?: string;
      trace?: string | (() => string);
    };

/**
 * A declared context manifest on the wire: the value of `ur.manifest`, exactly the
 * `toWire(manifest)` shape `@ultrarouter/sdk/context` produces. It carries hashes, ranges and labels
 * only (never bodies); the gateway verifies every entry hash against the bytes it receives before
 * any transform.
 */
export type UrManifest = NonNullable<
  NonNullable<Schemas['ChatCompletionsRequest']['ur']>['manifest']
>;

/**
 * A deeply read-only view of a type. `ur.manifest` accepts it, so the read-only value `toWire()`
 * returns can be passed as-is.
 */
export type DeepReadonly<T> = T extends (infer E)[]
  ? readonly DeepReadonly<E>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

/** One declared context-manifest entry: a labelled, hashed slice of the request. */
export type UrManifestEntry = UrManifest['entries'][number];

/** A declared range in the `ur.segments` coordinate system (UTF-16 code units). */
export type UrManifestRange = NonNullable<UrManifestEntry['range']>;

/** A pinned learned-context module reference for `ur.context_modules`. */
export type UrContextModule = NonNullable<
  NonNullable<Schemas['ChatCompletionsRequest']['ur']>['context_modules']
>[number];

/** Per-request ultrarouter controls (the `ur` request extension). */
export interface UrRequestOptions {
  /** Your trace id; groups related requests. */
  trace_id?: string;
  /** Free-form string tags recorded with the request. */
  tags?: Record<string, string>;
  /** Refuse the call before dispatch when its estimated cost exceeds this many USD. */
  max_cost_usd?: number;
  /** A per-request upstream timeout (ms). */
  timeout_ms?: number;
  /** Segment labels that refine compression segmentation. */
  segments?: SegmentHint[];
  /** Bench capture activation. Wins over the `X-UR-Bench-*` headers set at construction. */
  bench?: BenchTag;
  /**
   * The artifact key this request contributes to (equivalent to the `X-UR-Artifact` header; the body
   * wins on conflict). The response `ur.artifact_id` echoes the bound artifact. `withArtifact` sets it
   * on every bound call.
   */
  artifact?: string;
  /** Declared situation facets (labels and values only), hashed into the artifact's situation key. */
  situation?: Record<string, unknown>;
  /** A declared context manifest: pass `toWire(manifest)` from `@ultrarouter/sdk/context`. See {@link UrManifest}. */
  manifest?: UrManifest | DeepReadonly<UrManifest>;
  /**
   * Learned-context modules this call opts into, each pinned to an exact version (at most 8). The
   * gateway refuses on any mismatch instead of serving a different version.
   */
  context_modules?: UrContextModule[];
  /**
   * Values for the active hosted prompt's `{{name}}` variables when the gateway applies a hosted
   * prompt for this call type. A missing required variable is a `prompt_variables_missing` error.
   */
  prompt_vars?: Record<string, string | number | boolean>;
}

// ---------------------------------------------------------------------------
// Chat completions
// ---------------------------------------------------------------------------

/** A chat message role. */
export type ChatRole = 'system' | 'developer' | 'user' | 'assistant' | 'tool';

/**
 * One content part of a multi-part message. `cache_control` marks a prompt-cache breakpoint (honoured
 * by providers that support explicit cache breakpoints; ignored elsewhere).
 */
export interface ChatContentPart {
  /** The part type, e.g. `text` or `image_url`. */
  type?: string;
  /** The text of a `text` part. */
  text?: string;
  /** A prompt-cache breakpoint. */
  cache_control?: { type: 'ephemeral'; ttl?: string };
  /** Other provider-specific part fields (for example `image_url`). */
  [key: string]: unknown;
}

/** An OpenAI-shaped chat message. `content` may be a string, a multi-part array, or `null`. */
export interface ChatMessage {
  /** The author role. */
  role: ChatRole;
  /** The message content. */
  content?: string | ChatContentPart[] | null;
  /** An optional participant name. */
  name?: string;
  /** Tool calls requested by an assistant message. */
  tool_calls?: unknown[];
  /** For a `tool` message: the id of the tool call it answers. */
  tool_call_id?: string;
}

/** The `response_format` request field. */
export type ResponseFormat =
  | { type: 'text' }
  | { type: 'json_object' }
  | { type: 'json_schema'; json_schema: Record<string, unknown> };

/** A reasoning effort level. */
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high';

/** OpenRouter-compatible structured reasoning control. Takes precedence over `reasoning_effort`. */
export interface ReasoningOptions {
  /** The reasoning effort. */
  effort?: ReasoningEffort;
  /** A direct thinking-token budget (budget-based providers; minimum 1024). */
  max_tokens?: number;
  /** Drop reasoning tokens from the response. Not supported: `true` is refused with a named error. */
  exclude?: boolean;
}

/** `POST /v1/chat/completions` request body: the OpenAI fields plus the ultrarouter extensions. */
export interface ChatCompletionCreateParams {
  /** Provider-prefixed model id, e.g. `openai/gpt-5.2-mini`. Optional when the client has a `defaultModel`. */
  model?: string;
  /** The conversation. */
  messages: ChatMessage[];
  /** Tool (function) definitions, OpenAI-shaped. */
  tools?: unknown[];
  /** `none`, `auto`, `required`, or a specific tool. */
  tool_choice?: string | Record<string, unknown>;
  /** Structured output control (`json_object` / `json_schema`). */
  response_format?: ResponseFormat;
  /** Sampling temperature. */
  temperature?: number;
  /** Nucleus sampling. */
  top_p?: number;
  /** Maximum tokens to generate (legacy name). */
  max_tokens?: number;
  /** Maximum tokens to generate. */
  max_completion_tokens?: number;
  /** Stop sequences. */
  stop?: string | string[];
  /** Stream the response as server-sent events. */
  stream?: boolean;
  /** Stream options, e.g. `{ include_usage: true }`. */
  stream_options?: Record<string, unknown>;
  /** Sampling seed. */
  seed?: number;
  /** Return log probabilities. */
  logprobs?: boolean;
  /** Number of top log probabilities per token. */
  top_logprobs?: number;
  /** Number of choices. */
  n?: number;
  /** Frequency penalty. */
  frequency_penalty?: number;
  /** Presence penalty. */
  presence_penalty?: number;
  /** An end-user identifier. */
  user?: string;
  /**
   * The OpenAI reasoning-effort control. Forwarded to providers that support it, mapped to a thinking
   * budget for budget-based providers, and refused with `capability_unsupported` where a provider has
   * no reasoning control.
   */
  reasoning_effort?: ReasoningEffort;
  /** OpenRouter-compatible structured reasoning control. */
  reasoning?: ReasoningOptions;
  // --- ultrarouter extensions --------------------------------------------
  /** Ordered fallback model ids (OpenRouter-compatible). */
  models?: string[];
  /** Routing mode for this call. */
  router?: RouterMode;
  /** A stable call-type slug that groups requests of the same kind. */
  call_type?: string;
  /** Compression control. */
  compression?: CompressionOption;
  /** Provider preferences. */
  provider?: ProviderPreferences;
  /** Per-request ultrarouter controls. */
  ur?: UrRequestOptions;
  /**
   * A per-call Bench capture tag. Folded into the body `ur.bench`, which wins over the client's
   * construction-time `bench` headers.
   */
  bench?: BenchTag;
  /** Free-form metadata. */
  metadata?: Record<string, unknown>;
}

/** Token usage of a completion. */
export interface Usage {
  /** Input tokens. */
  prompt_tokens: number;
  /** Output tokens. */
  completion_tokens: number;
  /** Input plus output tokens. */
  total_tokens: number;
  /** Input token details (`cached_tokens` = tokens served from the provider prompt cache). */
  prompt_tokens_details?: { cached_tokens?: number };
}

/** One completion choice. */
export interface ChatChoice {
  /** The choice index. */
  index: number;
  /** The generated message. */
  message: {
    role: string;
    content?: string | null;
    tool_calls?: unknown[];
  };
  /** Why generation stopped (`stop`, `length`, `tool_calls`, …). */
  finish_reason: string | null;
  /** Log probabilities, when requested. */
  logprobs?: unknown;
}

/** The compression summary in the `ur` response block. */
export interface UrCompressionBlock {
  /** The compression tier actually applied. */
  applied: 'off' | 'semantic_safe' | 'adaptive';
  /** Set when the request used a deprecated legacy alias. */
  deprecated_alias?: 'lossless' | 'auto';
  /** Whether a figure is provider-reported or only an estimated diagnostic. */
  savings_basis?: 'provider_reported' | 'estimated_diagnostic';
  /** Where the applied tier came from (`unqualified-legacy` = no qualifying evidence yet). */
  source?: 'off' | 'qualified' | 'unqualified-legacy';
  /** Tokens removed by compression, when any. */
  tokens_saved?: number;
  /** Estimated USD difference attributed to compression (an estimate; see `savings_basis`). */
  est_saved_usd?: number;
  /** USD difference attributed to provider prompt caching, when reported. */
  cache_saved_usd?: number;
  /** The verification outcome of a lossy rewrite, when one ran. */
  verify?: string;
}

/** The routing summary in the `ur` response block. */
export interface UrRoutingBlock {
  /** The routing mode that applied. */
  mode: RouterMode;
  /** Whether a fallback model served the request. */
  fallback_used: boolean;
  /** The engine that decided (for example `verified_memory` for an answer from verified memory). */
  engine?: string;
}

/** The Bench capture echo on a bench-tagged response. */
export type UrBenchEcho = NonNullable<Schemas['UrResponseBlock']['bench']>;

/** Present only when the request was answered from the workspace's verified memory (no provider call). */
export type UrVerifiedMemoryBlock = NonNullable<Schemas['UrResponseBlock']['verified_memory']>;

/** The ultrarouter `ur` block attached to every chat and embeddings response. */
export interface UrResponseBlock {
  /** The gateway request id (`req_…`). Use it with `ur.generation.get` and `ur.requests.feedback`. */
  request_id: string;
  /** The call type the request was attributed to, or `null`. */
  call_type: string | null;
  /** The model that actually served the request. */
  model_served: string;
  /** The provider that served the request. */
  provider: string;
  /** How the request was routed. */
  routing: UrRoutingBlock;
  /** What compression did. */
  compression: UrCompressionBlock;
  /** The request cost in USD. */
  cost_usd: number;
  /** Whether your own provider key (BYOK) served the request. */
  byok: boolean;
  /** The Bench capture echo, present only on a bench-tagged call. */
  bench?: UrBenchEcho;
  /** The artifact the request was bound to, present only when the request declared one. */
  artifact_id?: string;
  /** Present only when the answer came from verified memory. */
  verified_memory?: UrVerifiedMemoryBlock;
}

/** `POST /v1/chat/completions` (non-streaming) response. */
export interface ChatCompletion {
  /** The completion id. */
  id: string;
  /** Always `chat.completion`. */
  object: 'chat.completion';
  /** Unix seconds. */
  created: number;
  /** The model that produced the completion. */
  model: string;
  /** The generated choices. */
  choices: ChatChoice[];
  /** Token usage. */
  usage: Usage;
  /** The provider system fingerprint, when reported. */
  system_fingerprint?: string;
  /** The ultrarouter response block. */
  ur: UrResponseBlock;
}

/** One streamed chunk (`chat.completion.chunk`). The final chunk carries `usage` and `ur`. */
export interface ChatCompletionChunk {
  /** The completion id. */
  id: string;
  /** Always `chat.completion.chunk`. */
  object: 'chat.completion.chunk';
  /** Unix seconds. */
  created: number;
  /** The model producing the stream. */
  model: string;
  /** The incremental deltas. */
  choices: {
    index: number;
    delta: { role?: string; content?: string | null; tool_calls?: unknown[] };
    finish_reason?: string | null;
  }[];
  /** Token usage, on the final chunk. */
  usage?: Usage | null;
  /** The ultrarouter response block, on the final chunk. */
  ur?: UrResponseBlock;
}

/** An async iterable of chunks; the last chunk carries `usage` and `ur`. */
export type ChatCompletionStream = AsyncIterable<ChatCompletionChunk>;

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

/** `POST /v1/embeddings` request body. */
export interface EmbeddingCreateParams {
  /** Provider-prefixed embedding model id. Optional when the client has a `defaultModel`. */
  model?: string;
  /** One input string or a batch. */
  input: string | string[];
  /** Output dimensions (models that support it). */
  dimensions?: number;
  /** `float` (default) or `base64`. */
  encoding_format?: 'float' | 'base64';
  /** An end-user identifier. */
  user?: string;
  /** A stable call-type slug. */
  call_type?: string;
  /** Per-request ultrarouter controls. */
  ur?: UrRequestOptions;
  /** A per-call Bench capture tag (folded into `ur.bench`). */
  bench?: BenchTag;
  /** Free-form metadata. */
  metadata?: Record<string, unknown>;
}

/** One embedding vector. */
export interface Embedding {
  /** Always `embedding`. */
  object: 'embedding';
  /** The input index this vector belongs to. */
  index: number;
  /** The vector (`number[]`), or a base64 string with `encoding_format: 'base64'`. */
  embedding: number[] | string;
}

/** `POST /v1/embeddings` response. */
export interface CreateEmbeddingResponse {
  /** Always `list`. */
  object: 'list';
  /** One vector per input. */
  data: Embedding[];
  /** The model that produced the vectors. */
  model: string;
  /** Token usage. */
  usage: { prompt_tokens: number; total_tokens: number };
  /** The ultrarouter response block (without compression, which never applies to embeddings). */
  ur: EmbeddingUrBlock;
}

/**
 * The `ur` block on an embeddings response: the chat block without `compression` (embeddings are
 * never compressed), with an OPEN routing mode — the embeddings contract types it as a string.
 */
export interface EmbeddingUrBlock extends Omit<UrResponseBlock, 'compression' | 'routing'> {
  /** How the request was routed; `mode` is a {@link RouterMode} value in practice, typed open. */
  routing: Omit<UrRoutingBlock, 'mode'> & { mode: RouterMode | (string & {}) };
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

/** Model pricing, in integer micro-USD and in USD, per one million tokens. */
export interface ModelPricing {
  /** Input price per 1M tokens (micro-USD). */
  input_micro_usd_per_1m: number;
  /** Output price per 1M tokens (micro-USD). */
  output_micro_usd_per_1m: number;
  /** Cached-input price per 1M tokens (micro-USD), when the provider discounts cached input. */
  cached_input_micro_usd_per_1m: number | null;
  /** Input price per 1M tokens (USD). */
  input_usd_per_1m: number;
  /** Output price per 1M tokens (USD). */
  output_usd_per_1m: number;
}

/** One model in the catalog. */
export interface Model {
  /** Provider-prefixed model id. */
  id: string;
  /** Always `model`. */
  object: 'model';
  /** Display name. */
  name: string;
  /** The provider slug. */
  provider: string;
  /** Context window in tokens, when known. */
  context_length: number | null;
  /** Capability flags (tools, json_schema, vision, …). */
  capabilities: Record<string, unknown>;
  /** Pricing. */
  pricing: ModelPricing;
  /** Whether the model is currently served. */
  active: boolean;
  /** The developing lab's jurisdiction (ISO 3166-1 alpha-2), or `unknown`. */
  origin_jurisdiction: string;
  /** Where this offer runs (ISO 3166-1 alpha-2), or `unknown`. */
  hosting_jurisdiction: string;
  /** The provider-published serving region (for example `us-east-1`), or `null`. */
  hosting_region: string | null;
  /** Whether the model weights are downloadable. */
  weights: 'open' | 'closed' | 'unknown';
  /** `true` on a model served by one of your workspace's custom providers. */
  workspace_custom?: boolean;
}

/** `GET /v1/models` response. */
export interface ModelsListResponse {
  /** Always `list`. */
  object: 'list';
  /** The models visible to your key. */
  data: Model[];
}

// ---------------------------------------------------------------------------
// Call types
// ---------------------------------------------------------------------------

/** How learned context is delivered on a call type. */
export type LearnedContextDelivery = 'gateway_inject_after_stable_prefix' | 'off';

/** The self-improvement guardrails of a call type. */
export type SelfImproveGuardrails = NonNullable<
  Schemas['CallTypeConfigBody']['self_improve_guardrails']
>;

/** One immutable config version of a call type. */
export interface CallTypeConfigVersion {
  /** The config version number. */
  version: number;
  /** The pinned model, or `null`. */
  model_pin: string | null;
  /** The routing mode, or `null` for the default. */
  router_mode: string | null;
  /** The compression mode, or `null` for the default. */
  compression_mode: string | null;
  /** Ordered fallback models, or `null`. */
  fallbacks: string[] | null;
  /** Provider preferences, or `null`. */
  provider_prefs: Record<string, unknown> | null;
  /** How learned context is delivered on this version. */
  learned_context_delivery?: LearnedContextDelivery;
  /** Whether per-request case precedents are served into the learned slot on this version. */
  case_precedents_enabled?: boolean;
  /** When this version was created (ISO 8601). */
  created_at: string;
}

/** A call type: a stable name for one kind of request, with its config history and lifecycle. */
export interface CallType {
  /** Always `call_type`. */
  object: 'call_type';
  /** The `ct_*` id. */
  id: string;
  /** The stable slug. */
  slug: string;
  /** Display name. */
  display_name: string;
  /** How the call type was created (declared or inferred). */
  source: string;
  /** The active config version number, or `null`. */
  current_config_version: number | null;
  /** The active config version, or `null`. */
  config: CallTypeConfigVersion | null;
  /** The Autopilot lifecycle state (`observing` … `verified` / `held`). Informational only. */
  lifecycle_state: string;
  /** The evidence reason for the last lifecycle transition, or `null`. */
  lifecycle_reason: string | null;
  /** When the last lifecycle transition happened (ISO 8601), or `null`. */
  lifecycle_transitioned_at: string | null;
  /** Creation time (ISO 8601). */
  created_at: string;
  /** Last update time (ISO 8601). */
  updated_at: string;
}

/** `GET /v1/call-types` response. */
export interface CallTypeListResponse {
  /** Always `list`. */
  object: 'list';
  /** The call types. */
  data: CallType[];
}

/** `POST /v1/call-types` request body. */
export interface CreateCallTypeParams {
  /** The stable slug. */
  slug: string;
  /** The initial config. */
  config?: CallTypeConfigBody;
}

/** A call-type config body. On update, an omitted field keeps its current value. */
export interface CallTypeConfigBody {
  /** Pin a model, or `null` to clear the pin. */
  model_pin?: string | null;
  /** Routing mode, or `null` for the default. */
  router_mode?: 'pinned' | 'auto' | 'candidates' | 'off' | null;
  /** Compression mode, or `null` for the default. */
  compression_mode?: 'off' | 'semantic_safe' | 'adaptive' | 'lossless' | 'auto' | null;
  /** Ordered fallback models, or `null`. */
  fallbacks?: string[] | null;
  /** Provider preferences, or `null`. */
  provider_prefs?: Record<string, unknown> | null;
  /**
   * How learned context is delivered: `gateway_inject_after_stable_prefix` (the gateway injects it on
   * proxied requests) or `off` (a caller that calls its model directly injects it with `useLearned`).
   */
  learned_context_delivery?: LearnedContextDelivery;
  /** Serve per-request case precedents into the learned slot (default `false`). */
  case_precedents_enabled?: boolean;
  /** Self-improvement mode: `off`, `assist` (propose to your inbox) or `autopilot` (adopt within guardrails). */
  self_improve_mode?: 'off' | 'assist' | 'autopilot';
  /** Self-improvement guardrails (a cost budget and the enabled surfaces). */
  self_improve_guardrails?: SelfImproveGuardrails;
}

/** `ur.callTypes.enqueueEval` request body. */
export type EnqueueEvalParams = Schemas['EnqueueEvalRequest'];

/**
 * `ur.callTypes.enqueueEval` response: the enqueued run (`run_id`, `candidate_count`) or a documented
 * no-op (`enqueued: false` with a `reason`; a deduplicated trigger names `prior_run_id`).
 */
export type EnqueueEvalResponse = Schemas['EnqueueEvalResponse'];

// ---------------------------------------------------------------------------
// Feedback + generation
// ---------------------------------------------------------------------------

/** `POST /v1/requests/{id}/feedback` request body. */
export interface FeedbackParams {
  /** `1` (good) or `-1` (bad). */
  rating: 1 | -1;
  /** Optional tags. */
  tags?: string[];
  /** An optional comment. */
  comment?: string;
}

/** A stored feedback row. */
export interface Feedback {
  /** Always `request_feedback`. */
  object: 'request_feedback';
  /** The feedback id. */
  id: string;
  /** The rated request. */
  request_id: string;
  /** The rating. */
  rating: 1 | -1;
  /** Tags. */
  tags: string[];
  /** Comment, or `null`. */
  comment: string | null;
  /** Creation time (ISO 8601). */
  created_at: string;
}

/**
 * The raw wire shape of the feedback route: the row wrapped in `{ feedback }`.
 * `ur.requests.feedback` unwraps it; this type is for raw-REST callers.
 */
export interface FeedbackEnvelope {
  /** The stored feedback row. */
  feedback: Feedback;
}

/** One outcome event bound to a request, as rendered by `GET /v1/generation`. */
export interface GenerationOutcome {
  /** The artifact the outcome landed on. */
  artifact_id: string;
  /** The outcome channel (for example `mechanical`). */
  channel: string;
  /** The outcome kind (for example `schema_valid`, `tool_error`). */
  kind: string;
  /** `instant` or `delayed` (assigned by the gateway). */
  latency_class: string;
  /** How the outcome may be used (assigned by the gateway). */
  learning_use: string[];
  /** When the outcome took effect (ISO 8601). */
  observed_at: string;
  /** Who recorded it (assigned by the gateway; `gateway` for native events). */
  source: string;
  /** The typed value: reasons, indices or counts only (never a body). */
  value: Record<string, unknown>;
}

/** `GET /v1/generation?id=…`: the stats of one served request. */
export interface GenerationStats {
  /** The request id. */
  id: string;
  /** The call type, or `null`. */
  call_type: string | null;
  /** The model the caller asked for. */
  model_requested: string;
  /** The model that served, or `null` when nothing was served. */
  model_served: string | null;
  /** The provider that served, or `null`. */
  provider: string | null;
  /** The request status. */
  status: 'ok' | 'error' | 'cancelled';
  /** The error class of a failed request, or `null`. */
  error_class: string | null;
  /** A digest of the declared contract (schema, tools, tool choice, response format), or `null`. */
  contract_digest: string | null;
  /** Token counts. */
  tokens: { input: number; output: number; cached: number; total: number };
  /**
   * Cost in integer micro-USD and USD, with the basis the gateway priced it on: `priced` (the
   * model's catalog price), `derived` (a dated snapshot priced from its curated base),
   * `unpriced` (no catalog price — metered at 0 and only ever served when the gateway is
   * explicitly configured to allow unpriced models), `verified_memory` (served from a verified
   * memory, no provider call), or `null` when nothing was served.
   */
  cost: {
    total_micro_usd: number;
    total_usd: number;
    cost_basis: 'priced' | 'derived' | 'unpriced' | 'verified_memory' | null;
  };
  /** Time to first byte and total latency (ms). */
  timing: { ttfb_ms: number | null; latency_ms: number | null };
  /** The routing decision trail. */
  routing_decision: Record<string, unknown>;
  /** The compression record. */
  compression: Record<string, unknown>;
  /** Outcome events bound to this request. */
  outcomes: GenerationOutcome[];
  /** The experiment arm and epoch stamped before dispatch (evidence only). */
  exposure: { arm: string | null; epoch: number | null };
  /** The learned-context stamp: what was served (ids and numbers only) or why nothing was. */
  lever: {
    lever_id: string | null;
    module_version: string | null;
    epoch: number | null;
    pack_hash: string | null;
    injection: Record<string, unknown> | null;
  };
  /** Whether your own provider key served the request. */
  byok: boolean;
  /** Creation time (ISO 8601). */
  created_at: string;
}

// ---------------------------------------------------------------------------
// Autopilot status (`ur.autopilot.status()`, GET /v1/audit/readiness)
// ---------------------------------------------------------------------------

/** How much of the observed cost is replayable (provider-reported) versus estimate-only. */
export interface AutopilotCostProvenance {
  /** Requests with replayable, provider-reported cost. */
  measured_replayable: number;
  /** Requests with estimate-only cost. */
  estimate_only: number;
}

/** One observed call type in the readiness rollup. */
export interface AutopilotCallType {
  /** The `ct_*` id. */
  call_type_id: string;
  /** The slug. */
  slug: string;
  /** Display name. */
  display_name: string;
  /** How the call type was created. */
  source: string;
  /** Lifecycle state: `observing`, `evaluator_building`, `benchmarkable`, `recommendable`, `canary`, `verified` or `held`. */
  lifecycle_state: string;
  /** Inference confidence. */
  confidence: 'high' | 'medium' | 'low';
  /** Observed requests. */
  requests: number;
  /** Observed spend (micro-USD). */
  spend_micro_usd: number;
  /** Models seen. */
  models_seen: string[];
  /** Providers seen. */
  providers_seen: string[];
  /** Cost provenance mix. */
  cost_provenance: AutopilotCostProvenance;
  /** What evidence is missing, and why. */
  evidence_gaps: string[];
}

/** What evidence the rollup could and could not use. */
export interface AutopilotCoverage {
  /** The workspace retention mode. */
  retention_mode: string;
  /** Whether payload storage is consented. */
  payload_consented: boolean;
  /** Confirmed captured envelopes. */
  confirmed_envelopes: number;
  /** Envelopes that cannot be replayed. */
  non_replayable_envelopes: number;
  /** Envelopes still queued. */
  queued_envelopes: number;
  /** Human-readable notes. */
  notes: string[];
}

/**
 * `ur.autopilot.status()` (`GET /v1/audit/readiness`): the read-only readiness and lifecycle rollup.
 * Extra wire fields are preserved via the index signature.
 */
export interface AutopilotStatus {
  /** Always `audit_readiness`. */
  object: 'audit_readiness';
  /** The workspace audit state (`observing` while passively observing). */
  state: string;
  /** `false` until the first rollup has been computed. */
  generated: boolean;
  /** Observed requests. */
  total_requests: number;
  /** Observed spend (micro-USD). */
  total_spend_micro_usd: number;
  /** Call types still observing. */
  observing_call_types: number;
  /** Per-call-type readiness. */
  call_types: AutopilotCallType[];
  /** Providers, models and key modes seen. */
  inventory: { providers: string[]; models: string[]; key_modes: string[] };
  /** Evidence coverage. */
  coverage: AutopilotCoverage;
  /** Any further fields the gateway returns. */
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Client construction
// ---------------------------------------------------------------------------

/** Construction-time defaults; each one is overridable per call. */
export interface UltraRouterDefaults {
  /** Default routing mode. */
  router?: RouterMode | undefined;
  /** Default compression control. */
  compression?: CompressionOption | undefined;
  /** Default call-type slug. */
  callType?: string | undefined;
  /** Default provider preferences. */
  provider?: ProviderPreferences | undefined;
  /** Default per-call cost cap (USD), sent as `ur.max_cost_usd`. */
  maxCostUsd?: number | undefined;
}

/** The `fetch` signature the SDK depends on. Inject your own for tests, proxies or instrumentation. */
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

/** Options for `new UltraRouter(options)`. Every field is optional. */
export interface UltraRouterOptions {
  /** The API key (`ur_sk_live_…` / `ur_sk_test_…`). Falls back to `ULTRAROUTER_API_KEY`, then `UR_API_KEY`. */
  apiKey?: string | undefined;
  /**
   * The gateway base URL, without `/v1`. Falls back to `ULTRAROUTER_BASE_URL`, then `UR_BASE_URL`.
   * There is no hosted default, so one of these is required (for example `http://localhost:8080`
   * for a local gateway); construction throws `configuration` when none is set. Point it at your own
   * deployment to self-host.
   */
  baseURL?: string | undefined;
  /** The model used when a call omits `model`. */
  defaultModel?: string | undefined;
  /**
   * The one-line Autopilot intent: `audit` sends `router: 'off'`, `recommend` sends
   * `router: 'candidates'`, `auto` sends `router: 'auto'`. A per-call `router` may only lower autonomy
   * below this ceiling (a higher value is clamped). Omit it for a plain pass-through client.
   */
  autopilot?: AutopilotMode | undefined;
  /**
   * A Bench capture tag stamped as `X-UR-Bench-*` headers on every request (and carried by
   * `asOpenAI()`). A per-call `bench` overrides it. Falls back to `UR_BENCH` (with optional
   * `UR_BENCH_RUN` / `UR_BENCH_TRACE`). Bench capture needs a test key (`ur_sk_test_…`).
   */
  bench?: BenchInitTag | undefined;
  /** Construction-time defaults, each overridable per call. */
  defaults?: UltraRouterDefaults | undefined;
  /** Total request timeout in ms (default 600000), including retries. */
  timeout?: number | undefined;
  /** Maximum retries for a retryable failure (default 2). */
  maxRetries?: number | undefined;
  /** A custom `fetch` (default `globalThis.fetch`). */
  fetch?: FetchLike | undefined;
  /** Extra headers sent on every request. */
  defaultHeaders?: Record<string, string> | undefined;
  /**
   * Who chooses request ids: `gateway` (default; the gateway mints one and echoes it) or `client`
   * (the SDK mints one with `mintRequestId()` for every chat completion and embeddings call that does
   * not pass `requestId`, so the id is known even when the response is lost).
   */
  requestIds?: 'gateway' | 'client' | undefined;
  /**
   * Where outcome events are persisted before they are sent. Defaults to an in-process
   * `MemoryOutcomeStore`; pass a `FileOutcomeStore(path)` to survive restarts, or your own
   * {@link OutcomeStore}.
   */
  outcomeStore?: OutcomeStore | undefined;
  /** Where reviewer events are persisted before they are sent (same options as `outcomeStore`). */
  reviewerStore?: OutcomeStore<QueuedReviewerEvent> | undefined;
  /**
   * The bound on the client-side `preflight()` cache: `{ maxEntries }` request identities (default
   * 1000), least recently used evicted first; `{ maxEntries: 0 }` disables it.
   */
  preflightCache?: PreflightCacheOptions | undefined;
}

/** Per-call request options, accepted as the last argument of every method. */
export interface RequestOptions {
  /** Abort the request (and any pending retry). */
  signal?: AbortSignal | undefined;
  /** Total timeout for this call in ms, including retries. */
  timeout?: number | undefined;
  /** Maximum retries for this call. */
  maxRetries?: number | undefined;
  /** Extra headers for this call (they win over the client defaults). */
  headers?: Record<string, string> | undefined;
  /** An explicit idempotency key (otherwise one is generated for each non-streaming POST). */
  idempotencyKey?: string | undefined;
  /**
   * Your own request id for this call (`[A-Za-z0-9_-]{1,64}`), sent as `x-ur-request-id` so you know
   * the id before the call returns. Mint one with `mintRequestId()`. Meaningful on chat completions
   * and embeddings; the gateway echoes it on the response.
   */
  requestId?: string | undefined;
  /**
   * The episode handle, sent as `x-ur-artifact` (the same key as `ur.artifact`): every step of one
   * multi-step task carries the same key, and concurrent tasks carry different keys even when they
   * open with identical text. Printable ASCII, at most 256 characters.
   */
  episodeKey?: string | undefined;
}

// ---------------------------------------------------------------------------
// Bench (`ur.bench.*`)
// ---------------------------------------------------------------------------

/** `ur.bench.status(suite)`: suite readiness. */
export type BenchSuiteStatus = Schemas['BenchSuiteStatusResponse'];

/** `ur.bench.freeze(suite)`: the immutable dataset cards. */
export type BenchDatasetFreeze = Schemas['BenchDatasetFreezeResponse'];

/** `ur.bench.run(params)`: the trigger receipt (estimate, allowance and per-call-type dispositions). */
export type BenchRunTrigger = Schemas['BenchRunTriggerResponse'];

/** `ur.bench.get(runId)`: a run and its per-arm evidence. */
export type BenchRun = Schemas['BenchRunResponse'];

/** `ur.bench.report(runId)`: the immutable evidence report. */
export type BenchReport = Schemas['BenchReportResponse'];

/** `ur.bench.baseline(runId)`: the pinned suite baseline. */
export type BenchBaseline = Schemas['BenchBaselineResponse'];

/** `ur.bench.gate(runId)`: the baseline-compare gate (`pass` / `fail` / `inconclusive`). */
export type BenchCompareGate = Schemas['BenchCompareGateResponse'];

/** `ur.bench.freeze(suite, params)` body: the optional per-call-type `max_items` cap (1–5000, default 500). */
export type BenchFreezeParams = Schemas['BenchFreezeRequest'];

/** `ur.bench.expect(suite, …)` result. */
export type BenchExpectations = Schemas['BenchExpectationsResponse'];

/** `ur.bench.record(…)` result. */
export type BenchOutcomes = Schemas['BenchOutcomesResponse'];

/** One assertion to attach with `ur.bench.expect`. */
export type BenchExpectationInput = Schemas['BenchExpectationsRequest']['expectations'][number];

/** One per-trace outcome to record with `ur.bench.record`. */
export type BenchOutcomeInput = Schemas['BenchOutcomesRequest']['outcomes'][number];

/** The paired-run mode: `request` (per request) or `task` (whole trace). */
export type BenchRunMode = 'request' | 'task';

/** The selection mode: `selection` ranks evidence (never a recommendation); `noninferiority` can support a migration. */
export type BenchSelectionMode = 'selection' | 'noninferiority';

/** The report export format. `json` is typed; `md` and `bundle` are returned as text. */
export type BenchReportFormat = 'json' | 'md' | 'bundle';

/**
 * `ur.bench.run(params)` parameters. The wire fields match the trigger request; `suite` names the
 * suite and the `wait` / poll fields are client-side only.
 */
export interface BenchRunParams {
  /** The suite slug. */
  suite: string;
  /** Required per-run cost cap (USD). */
  max_cost_usd: number;
  /** `request` (default) or `task`. */
  mode?: BenchRunMode;
  /** `selection` (default) or `noninferiority`. */
  selection_mode?: BenchSelectionMode;
  /** Exclude underpowered call types before any budget is reserved (default `false`). */
  require_power?: boolean;
  /** Return the estimate, dispositions and allowance without reserving or dispatching anything. */
  dry_run?: boolean;
  /** Skip the recent-run deduplication and always run fresh. */
  force?: boolean;
  /** Restrict the run to these frozen call-type ids. */
  call_types?: string[];
  /** Explicit challenger model ids (default: selected from the catalog). */
  candidates?: string[];
  /** Compare mode: run the current config as the single arm and gate it against a baseline. */
  compare?: boolean;
  /** The baseline run (`br_*`) to compare against (default: the suite's pinned baseline). */
  baseline_run_id?: string;
  /** An absolute per-unit cost ceiling (USD); a breach fails the gate. */
  cost_ceiling_usd?: number;
  /** The per-attempt output-token ceiling (default 256), pinned into the run; changing it starts a new measurement epoch. */
  max_output_tokens?: number;
  /** Poll until the run is `complete` or `failed`, then resolve the run. */
  wait?: boolean;
  /** Poll interval with `wait: true` (ms, default 1000). */
  pollIntervalMs?: number;
  /** Maximum wait with `wait: true` (ms, default 120000) before a `timeout` error. */
  waitTimeoutMs?: number;
}

/** `ur.bench.record` target: a suite slug or a run id. */
export type BenchOutcomeTarget = { suite: string } | { run: string };
