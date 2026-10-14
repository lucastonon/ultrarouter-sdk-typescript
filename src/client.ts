/**
 * `UltraRouter`: the client. It mirrors the `openai` surface (`chat.completions.create`,
 * `embeddings.create`, `models.list`) and adds the ultrarouter resources under `ur.*`. Construction
 * defaults (model, router, compression, call type, provider preferences, cost cap) apply to every
 * call and can be overridden per call. Retries, timeouts, abort signals and idempotency keys live
 * in the fetch transport (`http.ts`).
 */

import {
  artifactListQueryString,
  bindArtifactKey,
  type Artifact,
  type ArtifactArchetype,
  type ArtifactEnvelope,
  type ArtifactListQuery,
  type ArtifactListResponse,
  type ArtifactType,
  type ArtifactTypeEnvelope,
  type ArtifactTypeUpsertParams,
  type CreateArtifactParams,
  type FinalParams,
  type FinalResponse,
} from './artifacts.js';
import {
  applyChatDefaults,
  applyEmbeddingDefaults,
  AUTOPILOT_ROUTER,
  resolveBenchInit,
  type ResolvedBenchInit,
  type ResolvedInit,
} from './config.js';
import { UltraRouterError } from './errors.js';
import type { FlywheelCalibration, FlywheelStatus } from './flywheel-status.js';
import {
  MemoryOutcomeStore,
  OutcomeQueue,
  outcomeIdempotencyKey,
  type OutcomeFlushReport,
  type OutcomeReceipt,
  type QueuedOutcome,
} from './flywheel-queue.js';
import { executeRequest, readText, type HttpRequest, type OpenResponse } from './http.js';
import {
  importListQueryString,
  type Import,
  type ImportEnvelope,
  type ImportListQuery,
  type ImportListResponse,
  type ImportParams,
} from './imports.js';
import { applyLearnedContext, type LearnedMessage } from './learned-placement.js';
import {
  buildOpenAIAdapter,
  type OpenAICompatConfig,
  type OpenAIConstructor,
} from './openai-adapter.js';
import {
  normalizeOutcomeTarget,
  pendingQueryString,
  type BatchOutcomeInput,
  type BatchOutcomesResponse,
  type OutcomeInput,
  type OutcomeResult,
  type OutcomeTarget,
  type PendingClaimsResponse,
  type PendingOutcomesQuery,
  type RecordOutcomesResponse,
} from './outcomes.js';
import {
  decidePreflightCache,
  parseGrantHeader,
  parseMaxAgeSeconds,
  preflightCacheKey,
  preflightHasClusterKey,
  PreflightCache,
  PREFLIGHT_DEFAULT_CONFIG_MAX_AGE_S,
  PREFLIGHT_DEFAULT_LIVE_MAX_AGE_S,
  PREFLIGHT_GRANT_HEADER,
  PREFLIGHT_LIVE_MAX_AGE_HEADER,
  withHeaderGrant,
  type PreflightGrant,
  type PreflightKnowledge,
  type PreflightParams,
  type PreflightPrompt,
  type PreflightRequestOptions,
  type PreflightResponse,
} from './preflight.js';
import {
  ORACLE_SIGNATURE_HEADER,
  ORACLE_TIMESTAMP_HEADER,
  type ActivateHostedPromptParams,
  type AnswerSourceCheckParams,
  type ApiPath,
  type ApiRequestInit,
  type ApiResponse,
  type CallTypeRecommendations,
  type ClaimOracleJobsParams,
  type CreateHostedPromptParams,
  type EnableVerifiedMemoryParams,
  type EvalRunList,
  type HostedPromptList,
  type HostedPromptPointer,
  type HostedPromptProposal,
  type HostedPromptVersion,
  type HttpMethod,
  type ImprovementReads,
  type IssueSourceCheckParams,
  type KeyInfo,
  type ModelDetail,
  type Oracle,
  type OracleJobClaim,
  type OracleQualification,
  type OracleRegistration,
  type OracleRevocation,
  type OracleSigningOptions,
  type OracleTestResult,
  type OracleVerdictsResult,
  type QualifyOracleParams,
  type RegisterOracleParams,
  type SourceCheck,
  type SourceCheckGrade,
  type SubmitOracleVerdictsParams,
  type TestOracleParams,
  type VerdictSources,
  type VerifiedMemoryDisableResult,
  type VerifiedMemoryEnableResult,
  type VerifiedMemoryStatus,
} from './resources.js';
import {
  ReviewerQueue,
  reviewerSignatureHeaders,
  signReviewerPayload,
  type QueuedReviewerEvent,
  type ReviewerBackfill,
  type ReviewerEvent,
  type ReviewerEventsResponse,
  type ReviewerFlushReport,
  type ReviewerHealth,
  type ReviewerRepairResult,
  type ReviewerSetup,
  type ReviewerTestResult,
  type ReviewerTestScenario,
} from './reviewer.js';
import { iterateChatStream } from './streaming.js';
import type {
  AutopilotMode,
  AutopilotStatus,
  BenchBaseline,
  BenchCompareGate,
  BenchDatasetFreeze,
  BenchExpectationInput,
  BenchExpectations,
  BenchFreezeParams,
  BenchOutcomeInput,
  BenchOutcomes,
  BenchOutcomeTarget,
  BenchReport,
  BenchReportFormat,
  BenchRun,
  BenchRunParams,
  BenchRunTrigger,
  BenchSuiteStatus,
  CallType,
  CallTypeConfigBody,
  CallTypeListResponse,
  ChatCompletion,
  ChatCompletionCreateParams,
  ChatCompletionStream,
  CreateCallTypeParams,
  CreateEmbeddingResponse,
  EmbeddingCreateParams,
  EnqueueEvalParams,
  EnqueueEvalResponse,
  Feedback,
  FeedbackParams,
  FetchLike,
  GenerationStats,
  ModelsListResponse,
  RequestOptions,
  UltraRouterOptions,
} from './types.js';

/** The hosted gateway base URL used when neither `baseURL` nor an env var is set. */
export const DEFAULT_BASE_URL = 'https://api.ultrarouter.dev';
/** The default total request timeout (ms). */
export const DEFAULT_TIMEOUT_MS = 600_000;
/** The default number of retries for a retryable failure. */
export const DEFAULT_MAX_RETRIES = 2;

/** Bench `wait` long-poll defaults. A run is terminal at `complete` or `failed`. */
const DEFAULT_BENCH_POLL_INTERVAL_MS = 1_000;
const DEFAULT_BENCH_WAIT_TIMEOUT_MS = 120_000;
const BENCH_TERMINAL_STATUSES = new Set(['complete', 'failed']);

/** Read an env var on Node, Bun and Deno (with env access) without a Node-only import. */
function readEnv(name: string): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  const value = proc?.env?.[name];
  return value === undefined || value === '' ? undefined : value;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Percent-encode one path segment (ids, slugs, run ids). */
const seg = (value: string): string => encodeURIComponent(value);

/**
 * Encode a provider-prefixed model id (`openai/gpt-5.2-mini`) for the `/v1/models/{id}` route: each
 * `/`-separated part is percent-encoded and the separators are kept, so the id never relies on a
 * proxy forwarding an encoded slash. `.`/`..`/empty parts are refused (they would re-target the
 * request after URL normalization).
 */
function encodeModelId(id: string): string {
  const parts = id.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..')) {
    throw new UltraRouterError({
      code: 'invalid_request',
      message: `invalid model id '${id}'`,
      status: 0,
      retryable: false,
    });
  }
  return parts.map(encodeURIComponent).join('/');
}

/** Build a `?a=1&b=2` query string; `undefined`/`null` values are skipped, arrays repeat the key. */
function queryString(query: Readonly<Record<string, unknown>> | undefined): string {
  if (query === undefined) return '';
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const v of value) qs.append(key, String(v));
    } else {
      qs.set(key, String(value));
    }
  }
  const s = qs.toString();
  return s === '' ? '' : `?${s}`;
}

// ─────────────────────────────── resource interfaces ───────────────────────────────

/**
 * `chat.completions.create`: resolves a {@link ChatCompletion}, or a {@link ChatCompletionStream} when
 * `stream: true`.
 */
export interface ChatCompletionsCreate {
  /** A non-streaming completion. */
  (
    params: ChatCompletionCreateParams & { stream?: false | undefined },
    options?: RequestOptions,
  ): Promise<ChatCompletion>;
  /** A streaming completion: an async iterable of chunks; the final chunk carries `usage` and `ur`. */
  (
    params: ChatCompletionCreateParams & { stream: true },
    options?: RequestOptions,
  ): Promise<ChatCompletionStream>;
  /** Either, when `stream` is a `boolean` known only at runtime. */
  (
    params: ChatCompletionCreateParams,
    options?: RequestOptions,
  ): Promise<ChatCompletion | ChatCompletionStream>;
}

/** `ur.chat`: OpenAI-compatible chat completions. */
export interface ChatResource {
  /** `POST /v1/chat/completions`. */
  completions: {
    /**
     * Create a chat completion. Pass `stream: true` to receive an async iterable of chunks; the final
     * chunk carries `usage` and the `ur` block. Every construction default applies unless overridden.
     */
    create: ChatCompletionsCreate;
  };
}

/** `ur.embeddings`: OpenAI-compatible embeddings. */
export interface EmbeddingsResource {
  /** Create embeddings (`POST /v1/embeddings`). */
  create: (
    params: EmbeddingCreateParams,
    options?: RequestOptions,
  ) => Promise<CreateEmbeddingResponse>;
}

/** `ur.models`: the model catalog visible to your key. */
export interface ModelsResource {
  /** List models (`GET /v1/models`), optionally filtered by provider or capability. */
  list: (query?: ModelListQuery, options?: RequestOptions) => Promise<ModelsListResponse>;
  /**
   * Retrieve one model with every provider offer that serves it (`GET /v1/models/{id}`). The id is
   * provider-prefixed, e.g. `openai/gpt-5.2-mini`.
   */
  retrieve: (id: string, options?: RequestOptions) => Promise<ModelDetail>;
}

/** `ur.ur.callTypes.prompts`: hosted prompt versions of a call type. */
export interface HostedPromptsResource {
  /** List every hosted prompt version of a call type and the active pointer. */
  list: (callTypeId: string, options?: RequestOptions) => Promise<HostedPromptList>;
  /** Create a new immutable hosted prompt version. */
  create: (
    callTypeId: string,
    params: CreateHostedPromptParams,
    options?: RequestOptions,
  ) => Promise<HostedPromptVersion>;
  /** Read one hosted prompt version. */
  get: (
    callTypeId: string,
    version: number | string,
    options?: RequestOptions,
  ) => Promise<HostedPromptVersion>;
  /** Make a version the active prompt for the call type. */
  activate: (
    callTypeId: string,
    version: number | string,
    params?: ActivateHostedPromptParams,
    options?: RequestOptions,
  ) => Promise<HostedPromptPointer>;
  /** Clear the active pointer (the call type returns to its code-owned prompt). */
  deactivate: (callTypeId: string, options?: RequestOptions) => Promise<HostedPromptPointer>;
  /** Read the host-your-prompt onboarding proposal for a call type. */
  proposal: (callTypeId: string, options?: RequestOptions) => Promise<HostedPromptProposal>;
}

/** `ur.ur.callTypes.verifiedMemory`: answer-from-verified-memory controls for a call type. */
export interface VerifiedMemoryResource {
  /** Read the verified-memory setting of the active config version and whether it can serve. */
  get: (callTypeId: string, options?: RequestOptions) => Promise<VerifiedMemoryStatus>;
  /**
   * Enable verified memory. The gateway calibrates against the declared `target_precision` and only
   * enables it when an operating point clears it. Requires workspace authorisation.
   */
  enable: (
    callTypeId: string,
    params?: EnableVerifiedMemoryParams,
    options?: RequestOptions,
  ) => Promise<VerifiedMemoryEnableResult>;
  /** Disable verified memory (the kill switch). Idempotent. */
  disable: (callTypeId: string, options?: RequestOptions) => Promise<VerifiedMemoryDisableResult>;
}

/** `ur.ur.callTypes`: call-type configuration, evals and hosted prompts. */
export interface CallTypesResource {
  /** List call types (`GET /v1/call-types`). */
  list: (options?: RequestOptions) => Promise<CallTypeListResponse>;
  /** Create a call type (`POST /v1/call-types`). Needs a key with `config:write`. */
  create: (params: CreateCallTypeParams, options?: RequestOptions) => Promise<CallType>;
  /** Get one call type by slug or `ct_*` id. */
  get: (id: string, options?: RequestOptions) => Promise<CallType>;
  /** Append a config version (`PATCH /v1/call-types/{id}`). Omitted fields keep their value. */
  update: (id: string, params: CallTypeConfigBody, options?: RequestOptions) => Promise<CallType>;
  /**
   * Trigger an eval run for the call type. Resolves to the enqueued run, or to a documented no-op
   * (`enqueued: false` with a `reason`); a deduplicated trigger names the run it joined
   * (`prior_run_id`).
   */
  enqueueEval: (
    id: string,
    params?: EnqueueEvalParams,
    options?: RequestOptions,
  ) => Promise<EnqueueEvalResponse>;
  /** List the call type's eval runs and their candidates (`GET /v1/call-types/{id}/evals`). */
  listEvals: (id: string, options?: RequestOptions) => Promise<EvalRunList>;
  /** Read the eval-backed model recommendations for the call type. */
  recommendations: (id: string, options?: RequestOptions) => Promise<CallTypeRecommendations>;
  /** Hosted prompt versions. */
  prompts: HostedPromptsResource;
  /** Verified-memory controls. */
  verifiedMemory: VerifiedMemoryResource;
}

/** `ur.ur.bench`: suites, paired runs, reports and the baseline-compare gate. */
export interface BenchResource {
  /** Read a suite's readiness (`GET /v1/bench/suites/{slug}/status`). */
  status: (suite: string, options?: RequestOptions) => Promise<BenchSuiteStatus>;
  /** Freeze a suite into immutable dataset cards. `max_items` caps items per call type. */
  freeze: (
    suite: string,
    params?: BenchFreezeParams,
    options?: RequestOptions,
  ) => Promise<BenchDatasetFreeze>;
  /**
   * Trigger a paired run. With `wait: true` the client polls until the run is `complete` or
   * `failed` and resolves the run instead of the trigger receipt.
   */
  run: (params: BenchRunParams, options?: RequestOptions) => Promise<BenchRunTrigger | BenchRun>;
  /** Read a run and its per-arm evidence. */
  get: (runId: string, options?: RequestOptions) => Promise<BenchRun>;
  /**
   * Read a run's evidence report. `format: 'json'` (default) resolves the typed report; `'md'`
   * and `'bundle'` resolve the exported text.
   */
  report: {
    (runId: string, params?: { format?: 'json' }, options?: RequestOptions): Promise<BenchReport>;
    (runId: string, params: { format: 'md' | 'bundle' }, options?: RequestOptions): Promise<string>;
  };
  /** Attach assertions (expectations) to a suite. */
  expect: (
    suite: string,
    expectations: BenchExpectationInput[],
    options?: RequestOptions,
  ) => Promise<BenchExpectations>;
  /** Record per-trace outcomes for a suite (`{ suite }`) or a run (`{ run }`). */
  record: (
    target: BenchOutcomeTarget,
    outcomes: BenchOutcomeInput[],
    options?: RequestOptions,
  ) => Promise<BenchOutcomes>;
  /** Pin a completed run as the suite baseline. */
  baseline: (runId: string, options?: RequestOptions) => Promise<BenchBaseline>;
  /** Read a compare run's gate verdict (`pass`, `fail` or `inconclusive`). */
  gate: (runId: string, options?: RequestOptions) => Promise<BenchCompareGate>;
}

/** `ur.ur.artifacts`: the units of value your application produces. */
export interface ArtifactsResource {
  /** Create or upsert an artifact by `key`. */
  create: (params: CreateArtifactParams, options?: RequestOptions) => Promise<Artifact>;
  /** Get one artifact with its claims. */
  get: (id: string, options?: RequestOptions) => Promise<Artifact>;
  /** List artifacts (keyset pagination: pass `next_cursor` back as `cursor`). */
  list: (query?: ArtifactListQuery, options?: RequestOptions) => Promise<ArtifactListResponse>;
  /**
   * Record the human-approved final output. With corrections consent send `{ final, draft? }`;
   * without it send `{ diff_stats, final_hash }` from {@link diffStats} so no text leaves the process.
   */
  final: (id: string, params: FinalParams, options?: RequestOptions) => Promise<FinalResponse>;
}

/** `ur.ur.outcomes`: outcome events, delivered through a durable local queue. */
export interface OutcomesResource {
  /**
   * Durably record one outcome on an artifact (a bare string is an artifact id) or a request. The
   * event is persisted before the first send and replayed verbatim (same identity, same
   * Idempotency-Key) on every retry. A delivery failure never throws: only a definitive refusal of
   * the event drops it (`rejected`); a timeout, cancellation, connection failure, 408/429/5xx or
   * 401/403 leaves it queued for {@link OutcomesResource.flush}. Only an `OutcomeStoreError` (a store
   * that cannot persist) is thrown.
   */
  record: (
    target: string | OutcomeTarget,
    outcome: OutcomeInput,
    options?: RequestOptions,
  ) => Promise<OutcomeReceipt>;
  /** Record up to 1,000 outcomes keyed by request, artifact id or artifact key in one call. */
  batch: (
    outcomes: BatchOutcomeInput[],
    options?: RequestOptions,
  ) => Promise<BatchOutcomesResponse>;
  /** List claims still awaiting resolution (keyset pagination). */
  pending: (
    query?: PendingOutcomesQuery,
    options?: RequestOptions,
  ) => Promise<PendingClaimsResponse>;
  /** Drain the durable queue. Call it before your process exits. */
  flush: (options?: RequestOptions) => Promise<OutcomeFlushReport>;
}

/** Options for a reviewer delivery: a declared backfill and/or the reviewer system name. */
export interface ReviewerDeliveryOptions {
  /** Declare the batch as a backfill of historical decisions. */
  backfill?: ReviewerBackfill;
  /** A label for the reviewer system the decisions come from. */
  reviewerSystem?: string;
}

/** `ur.ur.reviewer`: the signed adapter for human approve / reject / edit decisions. */
export interface ReviewerResource {
  /** Read the mapping preview and the signature recipe. */
  setup: (options?: RequestOptions) => Promise<ReviewerSetup>;
  /** Run a guided test scenario end to end (`happy`, `replay` or `version_mismatch`). */
  test: (scenario?: ReviewerTestScenario, options?: RequestOptions) => Promise<ReviewerTestResult>;
  /** Durably queue one decision; nothing is sent until {@link ReviewerResource.flush}. Resolves the queue entry id. */
  record: (event: ReviewerEvent, opts?: ReviewerDeliveryOptions) => Promise<string>;
  /** Send a signed batch immediately (bypasses the local queue). */
  send: (
    events: ReviewerEvent[],
    opts?: ReviewerDeliveryOptions,
    options?: RequestOptions,
  ) => Promise<ReviewerEventsResponse>;
  /** Drain the local reviewer queue. */
  flush: (options?: RequestOptions) => Promise<ReviewerFlushReport>;
  /** Events the gateway refused with a repairable reason, still held locally. */
  deadLetters: () => Promise<QueuedReviewerEvent[]>;
  /** Re-drive one dead-lettered event. */
  repair: (
    entry: QueuedReviewerEvent,
    opts?: { repinToCurrentVersion?: boolean },
    options?: RequestOptions,
  ) => Promise<ReviewerRepairResult>;
  /** Read the integration health states and the next repair action. */
  health: (options?: RequestOptions) => Promise<ReviewerHealth>;
}

/** `ur.ur.flywheel.sourceChecks`: planted-failure checks for a verdict source. */
export interface SourceChecksResource {
  /** Issue a planted-failure check to the calling verdict source. Its probes are returned once. */
  issue: (params: IssueSourceCheckParams, options?: RequestOptions) => Promise<SourceCheck>;
  /** Answer a check: exactly one verdict per probe. It is graded once. */
  answer: (
    checkId: string,
    params: AnswerSourceCheckParams,
    options?: RequestOptions,
  ) => Promise<SourceCheckGrade>;
}

/** `ur.ur.flywheel`: learning status and verdict-source health. */
export interface FlywheelResource {
  /** Read usage, integration health and the learning block (`GET /v1/flywheel/status`). */
  status: (options?: RequestOptions) => Promise<FlywheelStatus>;
  /** The `learning` block of {@link FlywheelResource.status}: calibration availability as the gateway declares it. */
  calibration: (options?: RequestOptions) => Promise<FlywheelCalibration>;
  /** List the workspace's verdict sources and whether each one counts toward readiness. */
  sources: (options?: RequestOptions) => Promise<VerdictSources>;
  /** Planted-failure checks for verdict sources. */
  sourceChecks: SourceChecksResource;
}

/** `ur.ur.imports`: history imports. */
export interface ImportsResource {
  /** Create (or resume) an import. `mode: 'preview'` returns the capability report and stores nothing. */
  create: (params: ImportParams, options?: RequestOptions) => Promise<Import>;
  /** Get one import with its capability report. */
  get: (id: string, options?: RequestOptions) => Promise<Import>;
  /** List imports (keyset pagination). */
  list: (query?: ImportListQuery, options?: RequestOptions) => Promise<ImportListResponse>;
  /** Cancel a non-terminal import. */
  cancel: (id: string, options?: RequestOptions) => Promise<Import>;
}

/** `ur.ur.oracles`: checks that can tell a right answer from a wrong one. */
export interface OraclesResource {
  /** Register a check, or append a new version of an existing one (`oracle_id`). */
  register: (params: RegisterOracleParams, options?: RequestOptions) => Promise<OracleRegistration>;
  /** Read an oracle, its versions, the role its current version earned and its transport state. */
  get: (oracleId: string, options?: RequestOptions) => Promise<Oracle>;
  /** Qualify the current version against planted failures built from your known-good examples. */
  qualify: (
    oracleId: string,
    params: QualifyOracleParams,
    options?: RequestOptions,
  ) => Promise<OracleQualification>;
  /** Send a test probe end to end. Nothing is graded. */
  test: (
    oracleId: string,
    params?: TestOracleParams,
    options?: RequestOptions,
  ) => Promise<OracleTestResult>;
  /** Revoke an oracle (terminal). */
  revoke: (oracleId: string, options?: RequestOptions) => Promise<OracleRevocation>;
  /**
   * Pull transport: lease due jobs. The request is signed with the oracle secret
   * (`sha256=` HMAC of `"<timestamp>.<raw body>"`). Each job payload is returned exactly once.
   */
  claimJobs: (
    oracleId: string,
    params: ClaimOracleJobsParams,
    signing: OracleSigningOptions,
    options?: RequestOptions,
  ) => Promise<OracleJobClaim>;
  /** Pull transport: post signed verdicts for claimed jobs (idempotent per job). */
  submitVerdicts: (
    oracleId: string,
    params: SubmitOracleVerdictsParams,
    signing: OracleSigningOptions,
    options?: RequestOptions,
  ) => Promise<OracleVerdictsResult>;
}

/** The `ur` namespace: every ultrarouter resource beyond the OpenAI-compatible surface. */
export interface UrNamespace {
  /** Call-type configuration, evals, recommendations, hosted prompts and verified memory. */
  callTypes: CallTypesResource;
  /** Per-request feedback. */
  requests: {
    /** Rate a served request (`rating: 1 | -1`) with optional tags and a comment. */
    feedback: (
      requestId: string,
      params: FeedbackParams,
      options?: RequestOptions,
    ) => Promise<Feedback>;
  };
  /** Per-request generation stats. */
  generation: {
    /** Read a request's tokens, cost, timing, routing decision and bound outcomes. */
    get: (requestId: string, options?: RequestOptions) => Promise<GenerationStats>;
  };
  /** The API key the client was constructed with. */
  key: {
    /** Introspect the presented API key: scopes, caps and usage this period (`GET /v1/key`). */
    get: (options?: RequestOptions) => Promise<KeyInfo>;
  };
  /** The one-line Autopilot intent and the read-only readiness rollup. */
  autopilot: {
    /** The `autopilot` option the client was constructed with, or `undefined`. */
    readonly mode: AutopilotMode | undefined;
    /** Read the readiness and lifecycle rollup (`GET /v1/audit/readiness`). Read-only. */
    status: (options?: RequestOptions) => Promise<AutopilotStatus>;
  };
  /** Bench suites, runs, reports and the compare gate. */
  bench: BenchResource;
  /** Artifact types: the objective that defines success for a kind of artifact. */
  artifactTypes: {
    /** Register an artifact type or append a new objective version. An unchanged upsert is a no-op. */
    upsert: (params: ArtifactTypeUpsertParams, options?: RequestOptions) => Promise<ArtifactType>;
  };
  /** Artifacts: the units of value your application produces. */
  artifacts: ArtifactsResource;
  /** Outcome events with a durable local queue. */
  outcomes: OutcomesResource;
  /** The signed reviewer-decision adapter. */
  reviewer: ReviewerResource;
  /** Learning status and verdict-source health. */
  flywheel: FlywheelResource;
  /** History imports. */
  imports: ImportsResource;
  /** Improvement reads: a cost read and a quality read for every call type. */
  improvementReads: {
    /** List both reads for every call type (`GET /v1/improvement-reads`). */
    list: (options?: RequestOptions) => Promise<ImprovementReads>;
  };
  /** Oracles: registered checks and their pull transport. */
  oracles: OraclesResource;
  /** Alias of {@link UltraRouter.asOpenAI}. */
  asOpenAI: AsOpenAI;
}

/** The {@link UltraRouter.asOpenAI} signature: a configuration, or a client built with the given constructor. */
export interface AsOpenAI {
  /** The OpenAI-client-compatible configuration (`baseURL` with `/v1`, `apiKey`, `defaultHeaders?`). */
  (): OpenAICompatConfig;
  /** A ready client built with the given constructor (for example the `OpenAI` class). */
  <T>(ctor: OpenAIConstructor<T>): T;
}

// ─────────────────────────────── the client ───────────────────────────────

/**
 * The ultrarouter client.
 *
 * @example
 * ```ts
 * import UltraRouter from "@ultrarouter/sdk";
 *
 * // Reads ULTRAROUTER_API_KEY (or UR_API_KEY) and ULTRAROUTER_BASE_URL (or UR_BASE_URL).
 * const ur = new UltraRouter({ defaultModel: "openai/gpt-5.2-mini" });
 * const res = await ur.chat.completions.create({
 *   messages: [{ role: "user", content: "Say hello in one word." }],
 * });
 * console.log(res.choices[0]?.message.content, res.ur.cost_usd);
 * ```
 */
export class UltraRouter {
  /** The resolved gateway base URL (no trailing slash, no `/v1`). */
  readonly baseURL: string;
  private readonly apiKey: string;
  private readonly init: ResolvedInit;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly defaultHeaders: Record<string, string>;
  /** The per-request Bench trace factory, when the init `bench.trace` is a function. */
  private readonly benchTraceFactory: (() => string) | undefined;
  /** The durable queue behind `ur.outcomes.record` and `withArtifact`. */
  private readonly outcomeQueue: OutcomeQueue;
  /** The durable queue behind `ur.reviewer.*`. */
  private readonly reviewerQueue: ReviewerQueue;
  /** The bounded, two-lifetime preflight cache (the grant is never cached). */
  private readonly preflightCache: PreflightCache;

  /** OpenAI-compatible chat completions (`chat.completions.create`). */
  readonly chat: ChatResource;
  /** OpenAI-compatible embeddings (`embeddings.create`). */
  readonly embeddings: EmbeddingsResource;
  /** The model catalog (`models.list`, `models.retrieve`). */
  readonly models: ModelsResource;
  /** The configured Autopilot intent, or `undefined` for a plain pass-through client. */
  readonly autopilotMode: AutopilotMode | undefined;
  /** The ultrarouter resources. */
  readonly ur: UrNamespace;

  /** Alias of `ur.outcomes.record`: durably record one outcome on an artifact or a request. */
  readonly recordOutcome: OutcomesResource['record'];

  /**
   * Create a client. Every option is optional: the API key falls back to `ULTRAROUTER_API_KEY`
   * then `UR_API_KEY`, and the base URL to `ULTRAROUTER_BASE_URL`, then `UR_BASE_URL`, then
   * `https://api.ultrarouter.dev`.
   *
   * @throws {UltraRouterError} `authentication` when no API key is configured.
   */
  constructor(options: UltraRouterOptions = {}) {
    const apiKey = options.apiKey ?? readEnv('ULTRAROUTER_API_KEY') ?? readEnv('UR_API_KEY');
    if (apiKey === undefined || apiKey === '') {
      throw new UltraRouterError({
        code: 'authentication',
        message: 'missing API key: pass `apiKey` or set ULTRAROUTER_API_KEY / UR_API_KEY',
        status: 0,
        retryable: false,
      });
    }
    this.apiKey = apiKey;
    this.baseURL = (
      options.baseURL ??
      readEnv('ULTRAROUTER_BASE_URL') ??
      readEnv('UR_BASE_URL') ??
      DEFAULT_BASE_URL
    ).replace(/\/+$/, '');
    // The Autopilot intent maps onto the config `router` layer. It is the request-layer ceiling:
    // a per-request `router` can only lower autonomy below it.
    this.autopilotMode = options.autopilot;
    const autopilotRouter =
      options.autopilot !== undefined ? AUTOPILOT_ROUTER[options.autopilot] : undefined;
    this.init = {
      ...(options.defaultModel !== undefined ? { defaultModel: options.defaultModel } : {}),
      ...(autopilotRouter !== undefined ? { autopilotRouter } : {}),
      defaults: options.defaults ?? {},
    };
    this.fetchImpl = options.fetch ?? (globalThis.fetch.bind(globalThis) as FetchLike);
    try {
      this.preflightCache = new PreflightCache(options.preflightCache);
    } catch (err) {
      throw new UltraRouterError({
        code: 'invalid_request',
        message: err instanceof Error ? err.message : String(err),
        status: 0,
        retryable: false,
      });
    }
    this.timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    // The init Bench tag (explicit option, else UR_BENCH env). Its static X-UR-Bench-* headers
    // fold into defaultHeaders so they ride every request and `asOpenAI()`; a trace factory is
    // applied per request. A live key plus a bench tag warns once here.
    const benchInit: ResolvedBenchInit | undefined = resolveBenchInit(options.bench, {
      UR_BENCH: readEnv('UR_BENCH'),
      UR_BENCH_RUN: readEnv('UR_BENCH_RUN'),
      UR_BENCH_TRACE: readEnv('UR_BENCH_TRACE'),
    });
    this.benchTraceFactory = benchInit?.traceFactory;
    this.defaultHeaders = {
      ...(options.defaultHeaders ?? {}),
      ...(benchInit?.headers ?? {}),
    };
    if (benchInit !== undefined && apiKey.startsWith('ur_sk_live_')) {
      warnLiveBenchKey(benchInit.suite);
    }

    // The durable outcome queue: each event is persisted before its first send and replayed
    // verbatim, so a retry is only ever a duplicate on the server, never a conflict.
    this.outcomeQueue = new OutcomeQueue({
      store: options.outcomeStore ?? new MemoryOutcomeStore(),
      send: this.sendOutcome.bind(this),
    });

    // The durable reviewer queue: same durability port, plus dead letters for repairable refusals.
    this.reviewerQueue = new ReviewerQueue({
      store: options.reviewerStore ?? new MemoryOutcomeStore<QueuedReviewerEvent>(),
      send: this.sendReviewerBatch.bind(this),
    });

    this.chat = { completions: { create: this.createChatCompletion.bind(this) } };
    this.embeddings = { create: this.createEmbedding.bind(this) };
    this.models = {
      list: this.listModels.bind(this),
      retrieve: async (id, o = {}) =>
        this.json<ModelDetail>('GET', `/v1/models/${encodeModelId(id)}`, { options: o }),
    };
    this.recordOutcome = this.recordOutcomeEvent.bind(this);
    this.ur = {
      callTypes: {
        list: this.listCallTypes.bind(this),
        create: this.createCallType.bind(this),
        get: this.getCallType.bind(this),
        update: this.updateCallType.bind(this),
        enqueueEval: this.enqueueEval.bind(this),
        listEvals: (id, o = {}) =>
          this.json<EvalRunList>('GET', `/v1/call-types/${seg(id)}/evals`, { options: o }),
        recommendations: (id, o = {}) =>
          this.json<CallTypeRecommendations>('GET', `/v1/call-types/${seg(id)}/recommendations`, {
            options: o,
          }),
        prompts: {
          list: (id, o = {}) =>
            this.json<HostedPromptList>('GET', `/v1/call-types/${seg(id)}/prompts`, { options: o }),
          create: (id, params, o = {}) =>
            this.json<HostedPromptVersion>('POST', `/v1/call-types/${seg(id)}/prompts`, {
              body: params,
              options: o,
            }),
          get: (id, version, o = {}) =>
            this.json<HostedPromptVersion>(
              'GET',
              `/v1/call-types/${seg(id)}/prompts/${seg(String(version))}`,
              { options: o },
            ),
          activate: (id, version, params = {}, o = {}) =>
            this.json<HostedPromptPointer>(
              'POST',
              `/v1/call-types/${seg(id)}/prompts/${seg(String(version))}/activate`,
              { body: params, options: o },
            ),
          deactivate: (id, o = {}) =>
            this.json<HostedPromptPointer>('POST', `/v1/call-types/${seg(id)}/prompts/deactivate`, {
              options: o,
            }),
          proposal: (id, o = {}) =>
            this.json<HostedPromptProposal>('GET', `/v1/call-types/${seg(id)}/prompts/proposal`, {
              options: o,
            }),
        },
        verifiedMemory: {
          get: (id, o = {}) =>
            this.json<VerifiedMemoryStatus>('GET', `/v1/call-types/${seg(id)}/verified-memory`, {
              options: o,
            }),
          enable: (id, params = {}, o = {}) =>
            this.json<VerifiedMemoryEnableResult>(
              'POST',
              `/v1/call-types/${seg(id)}/verified-memory/enable`,
              { body: params, options: o },
            ),
          disable: (id, o = {}) =>
            this.json<VerifiedMemoryDisableResult>(
              'POST',
              `/v1/call-types/${seg(id)}/verified-memory/disable`,
              { options: o },
            ),
        },
      },
      requests: { feedback: this.submitFeedback.bind(this) },
      generation: { get: this.getGeneration.bind(this) },
      key: { get: (o = {}) => this.json<KeyInfo>('GET', '/v1/key', { options: o }) },
      autopilot: {
        mode: this.autopilotMode,
        status: this.autopilotStatus.bind(this),
      },
      bench: {
        status: this.benchStatus.bind(this),
        freeze: this.benchFreeze.bind(this),
        run: this.benchRun.bind(this),
        get: this.benchGet.bind(this),
        report: this.benchReport.bind(this),
        expect: this.benchExpect.bind(this),
        record: this.benchRecord.bind(this),
        baseline: this.benchBaseline.bind(this),
        gate: this.benchGate.bind(this),
      },
      artifactTypes: { upsert: this.upsertArtifactType.bind(this) },
      artifacts: {
        create: this.createArtifact.bind(this),
        get: this.getArtifact.bind(this),
        list: this.listArtifacts.bind(this),
        final: this.recordArtifactFinal.bind(this),
      },
      outcomes: {
        record: this.recordOutcomeEvent.bind(this),
        batch: this.batchOutcomes.bind(this),
        pending: this.pendingOutcomes.bind(this),
        flush: this.flushOutcomes.bind(this),
      },
      reviewer: {
        setup: this.reviewerSetup.bind(this),
        test: this.reviewerTest.bind(this),
        record: this.reviewerRecord.bind(this),
        send: this.reviewerSend.bind(this),
        flush: this.reviewerFlush.bind(this),
        deadLetters: this.reviewerDeadLetters.bind(this),
        repair: this.reviewerRepair.bind(this),
        health: this.reviewerHealth.bind(this),
      },
      flywheel: {
        status: this.flywheelStatus.bind(this),
        calibration: this.flywheelCalibration.bind(this),
        sources: (o = {}) =>
          this.json<VerdictSources>('GET', '/v1/flywheel/sources', { options: o }),
        sourceChecks: {
          issue: (params, o = {}) =>
            this.json<SourceCheck>('POST', '/v1/flywheel/source-checks', {
              body: params,
              options: o,
            }),
          answer: (id, params, o = {}) =>
            this.json<SourceCheckGrade>('POST', `/v1/flywheel/source-checks/${seg(id)}/verdicts`, {
              body: params,
              options: o,
            }),
        },
      },
      imports: {
        create: this.createImport.bind(this),
        get: this.getImport.bind(this),
        list: this.listImports.bind(this),
        cancel: this.cancelImport.bind(this),
      },
      improvementReads: {
        list: (o = {}) =>
          this.json<ImprovementReads>('GET', '/v1/improvement-reads', { options: o }),
      },
      oracles: {
        register: (params, o = {}) =>
          this.json<OracleRegistration>('POST', '/v1/flywheel/oracles', {
            body: params,
            options: o,
          }),
        get: (id, o = {}) =>
          this.json<Oracle>('GET', `/v1/flywheel/oracles/${seg(id)}`, { options: o }),
        qualify: (id, params, o = {}) =>
          this.json<OracleQualification>('POST', `/v1/flywheel/oracles/${seg(id)}/qualify`, {
            body: params,
            options: o,
          }),
        test: (id, params = {}, o = {}) =>
          this.json<OracleTestResult>('POST', `/v1/flywheel/oracles/${seg(id)}/test`, {
            body: params,
            options: o,
          }),
        revoke: (id, o = {}) =>
          this.json<OracleRevocation>('POST', `/v1/flywheel/oracles/${seg(id)}/revoke`, {
            body: {},
            options: o,
          }),
        claimJobs: (id, params, signing, o = {}) =>
          this.signedOracleJson<OracleJobClaim>(
            `/v1/flywheel/oracles/${seg(id)}/jobs/claim`,
            params,
            signing,
            o,
          ),
        submitVerdicts: (id, params, signing, o = {}) =>
          this.signedOracleJson<OracleVerdictsResult>(
            `/v1/flywheel/oracles/${seg(id)}/verdicts`,
            params,
            signing,
            o,
          ),
      },
      asOpenAI: this.asOpenAI.bind(this),
    };
  }

  // ─────────────────────────────── typed escape hatch ───────────────────────────────

  /**
   * Call any operation in the published OpenAPI document with full typing, including the ones that
   * have no dedicated method. Path placeholders are filled from `init.path` (percent-encoded), the
   * query from `init.query`, the JSON body from `init.body`; the result is the typed success body.
   * Retries, timeouts and idempotency follow the same rules as every other method.
   *
   * @example
   * ```ts
   * import UltraRouter from "@ultrarouter/sdk";
   *
   * const ur = new UltraRouter();
   * const plans = await ur.request("get", "/v1/flywheel/plans");
   * const model = await ur.request("get", "/v1/models/{id}", { path: { id: "openai/gpt-5.2-mini" } });
   * console.log(Object.keys(plans), model.id);
   * ```
   */
  async request<M extends HttpMethod, P extends ApiPath<M>>(
    method: M,
    path: P,
    init: ApiRequestInit<M, P> & RequestOptions = {},
  ): Promise<ApiResponse<M, P>> {
    const { path: pathParams, query, body, ...options } = init;
    const params = (pathParams ?? {}) as Record<string, string | number>;
    const filled = String(path).replace(/\{([^}]+)\}/g, (_m, name: string) => {
      const value = params[name];
      if (value === undefined) {
        throw new UltraRouterError({
          code: 'invalid_request',
          message: `missing path parameter '${name}' for ${String(path)}`,
          status: 0,
          retryable: false,
        });
      }
      return encodeURIComponent(String(value));
    });
    const suffix = queryString(query as Readonly<Record<string, unknown>> | undefined);
    const open = await this.send(method.toUpperCase(), `${filled}${suffix}`, {
      ...(body !== undefined ? { body } : {}),
      stream: false,
      options,
    });
    const text = await readText(open);
    if (text === '') return {} as ApiResponse<M, P>;
    try {
      return JSON.parse(text) as ApiResponse<M, P>;
    } catch {
      return text as ApiResponse<M, P>;
    }
  }

  // ─────────────────────────────── Autopilot ───────────────────────────────

  /** Read the readiness and lifecycle rollup (`GET /v1/audit/readiness`). */
  private autopilotStatus(options: RequestOptions = {}): Promise<AutopilotStatus> {
    return this.json<AutopilotStatus>('GET', '/v1/audit/readiness', { options });
  }

  // ─────────────────────────────── Bench ───────────────────────────────

  /** `GET /v1/bench/suites/{slug}/status` (scope `config:read`). */
  private benchStatus(suite: string, options: RequestOptions = {}): Promise<BenchSuiteStatus> {
    return this.json<BenchSuiteStatus>('GET', `/v1/bench/suites/${seg(suite)}/status`, { options });
  }

  /** `POST /v1/bench/suites/{slug}/freeze` (scope `config:write`). */
  private benchFreeze(
    suite: string,
    params: BenchFreezeParams = {},
    options: RequestOptions = {},
  ): Promise<BenchDatasetFreeze> {
    return this.json<BenchDatasetFreeze>('POST', `/v1/bench/suites/${seg(suite)}/freeze`, {
      ...(Object.keys(params).length > 0 ? { body: params } : {}),
      options,
    });
  }

  /**
   * `POST /v1/bench/suites/{slug}/runs` (scope `bench:run`). With `wait: true` and a real
   * reservation (a `bench_run_id`), polls the run until it is terminal and resolves the run.
   */
  private async benchRun(
    params: BenchRunParams,
    options: RequestOptions = {},
  ): Promise<BenchRunTrigger | BenchRun> {
    const body: Record<string, unknown> = { max_cost_usd: params.max_cost_usd };
    if (params.mode !== undefined) body.mode = params.mode;
    if (params.selection_mode !== undefined) body.selection_mode = params.selection_mode;
    if (params.require_power !== undefined) body.require_power = params.require_power;
    if (params.dry_run !== undefined) body.dry_run = params.dry_run;
    if (params.force !== undefined) body.force = params.force;
    if (params.call_types !== undefined) body.call_types = params.call_types;
    if (params.candidates !== undefined) body.candidates = params.candidates;
    if (params.compare !== undefined) body.compare = params.compare;
    if (params.baseline_run_id !== undefined) body.baseline_run_id = params.baseline_run_id;
    if (params.cost_ceiling_usd !== undefined) body.cost_ceiling_usd = params.cost_ceiling_usd;
    if (params.max_output_tokens !== undefined) body.max_output_tokens = params.max_output_tokens;
    const trigger = await this.json<BenchRunTrigger>(
      'POST',
      `/v1/bench/suites/${seg(params.suite)}/runs`,
      { body, options },
    );
    if (params.wait !== true || trigger.bench_run_id === null) return trigger;
    return this.waitForBenchRun(
      trigger.bench_run_id,
      params.pollIntervalMs ?? DEFAULT_BENCH_POLL_INTERVAL_MS,
      params.waitTimeoutMs ?? DEFAULT_BENCH_WAIT_TIMEOUT_MS,
      options,
    );
  }

  /** `GET /v1/bench/runs/{id}`. */
  private benchGet(runId: string, options: RequestOptions = {}): Promise<BenchRun> {
    return this.json<BenchRun>('GET', `/v1/bench/runs/${seg(runId)}`, { options });
  }

  /** Poll a bench run until its status is terminal, then resolve it. */
  private async waitForBenchRun(
    runId: string,
    pollIntervalMs: number,
    waitTimeoutMs: number,
    options: RequestOptions,
  ): Promise<BenchRun> {
    const deadline = Date.now() + waitTimeoutMs;
    for (;;) {
      const run = await this.benchGet(runId, options);
      if (BENCH_TERMINAL_STATUSES.has(run.status)) return run;
      if (Date.now() + pollIntervalMs > deadline) {
        throw new UltraRouterError({
          code: 'timeout',
          message: `bench run ${runId} did not reach a terminal status within ${String(waitTimeoutMs)}ms (last status '${run.status}')`,
          status: 0,
          retryable: false,
        });
      }
      await sleep(pollIntervalMs);
    }
  }

  private benchReport(
    runId: string,
    params?: { format?: 'json' },
    options?: RequestOptions,
  ): Promise<BenchReport>;
  private benchReport(
    runId: string,
    params: { format: 'md' | 'bundle' },
    options?: RequestOptions,
  ): Promise<string>;
  /** `GET /v1/bench/runs/{id}/report?format=…` (scope `bench:run`). */
  private async benchReport(
    runId: string,
    params: { format?: BenchReportFormat } = {},
    options: RequestOptions = {},
  ): Promise<BenchReport | string> {
    const format = params.format ?? 'json';
    const path = `/v1/bench/runs/${seg(runId)}/report?format=${format}`;
    if (format === 'json') return this.json<BenchReport>('GET', path, { options });
    return this.text('GET', path, { options });
  }

  /** `POST /v1/bench/runs/{id}/baseline`. */
  private benchBaseline(runId: string, options: RequestOptions = {}): Promise<BenchBaseline> {
    return this.json<BenchBaseline>('POST', `/v1/bench/runs/${seg(runId)}/baseline`, { options });
  }

  /** `GET /v1/bench/runs/{id}/gate`. */
  private benchGate(runId: string, options: RequestOptions = {}): Promise<BenchCompareGate> {
    return this.json<BenchCompareGate>('GET', `/v1/bench/runs/${seg(runId)}/gate`, { options });
  }

  /** `POST /v1/bench/suites/{slug}/expectations`. */
  private benchExpect(
    suite: string,
    expectations: BenchExpectationInput[],
    options: RequestOptions = {},
  ): Promise<BenchExpectations> {
    return this.json<BenchExpectations>('POST', `/v1/bench/suites/${seg(suite)}/expectations`, {
      body: { expectations },
      options,
    });
  }

  /** `POST /v1/bench/suites/{slug}/outcomes` or `POST /v1/bench/runs/{id}/outcomes`. */
  private benchRecord(
    target: BenchOutcomeTarget,
    outcomes: BenchOutcomeInput[],
    options: RequestOptions = {},
  ): Promise<BenchOutcomes> {
    const path =
      'run' in target
        ? `/v1/bench/runs/${seg(target.run)}/outcomes`
        : `/v1/bench/suites/${seg(target.suite)}/outcomes`;
    return this.json<BenchOutcomes>('POST', path, { body: { outcomes }, options });
  }

  // ─────────────────────────────── chat ───────────────────────────────

  private createChatCompletion(
    params: ChatCompletionCreateParams & { stream?: false | undefined },
    options?: RequestOptions,
  ): Promise<ChatCompletion>;
  private createChatCompletion(
    params: ChatCompletionCreateParams & { stream: true },
    options?: RequestOptions,
  ): Promise<ChatCompletionStream>;
  private createChatCompletion(
    params: ChatCompletionCreateParams,
    options?: RequestOptions,
  ): Promise<ChatCompletion | ChatCompletionStream>;
  private async createChatCompletion(
    params: ChatCompletionCreateParams,
    options: RequestOptions = {},
  ): Promise<ChatCompletion | ChatCompletionStream> {
    const body = applyChatDefaults(params, this.init);
    if (body.stream === true) {
      const open = await this.send('POST', '/v1/chat/completions', {
        body,
        stream: true,
        options,
      });
      // The deadline and the caller's abort signal keep applying while chunks arrive.
      return iterateChatStream(open.response, open) as ChatCompletionStream;
    }
    return this.json<ChatCompletion>('POST', '/v1/chat/completions', { body, options });
  }

  // ─────────────────────────────── embeddings ───────────────────────────────

  private createEmbedding(
    params: EmbeddingCreateParams,
    options: RequestOptions = {},
  ): Promise<CreateEmbeddingResponse> {
    const body = applyEmbeddingDefaults(params, this.init);
    return this.json<CreateEmbeddingResponse>('POST', '/v1/embeddings', { body, options });
  }

  // ─────────────────────────────── models ───────────────────────────────

  private listModels(
    query: ModelListQuery = {},
    options: RequestOptions = {},
  ): Promise<ModelsListResponse> {
    const qs = new URLSearchParams();
    if (query.provider !== undefined) qs.set('provider', query.provider);
    if (query.capability !== undefined) qs.set('capability', query.capability);
    const suffix = qs.toString() === '' ? '' : `?${qs.toString()}`;
    return this.json<ModelsListResponse>('GET', `/v1/models${suffix}`, { options });
  }

  // ─────────────────────────────── call types ───────────────────────────────

  private listCallTypes(options: RequestOptions = {}): Promise<CallTypeListResponse> {
    return this.json<CallTypeListResponse>('GET', '/v1/call-types', { options });
  }

  private createCallType(
    params: CreateCallTypeParams,
    options: RequestOptions = {},
  ): Promise<CallType> {
    return this.json<CallType>('POST', '/v1/call-types', { body: params, options });
  }

  private getCallType(id: string, options: RequestOptions = {}): Promise<CallType> {
    return this.json<CallType>('GET', `/v1/call-types/${seg(id)}`, { options });
  }

  private updateCallType(
    id: string,
    params: CallTypeConfigBody,
    options: RequestOptions = {},
  ): Promise<CallType> {
    return this.json<CallType>('PATCH', `/v1/call-types/${seg(id)}`, { body: params, options });
  }

  private enqueueEval(
    id: string,
    params: EnqueueEvalParams = {},
    options: RequestOptions = {},
  ): Promise<EnqueueEvalResponse> {
    return this.json<EnqueueEvalResponse>('POST', `/v1/call-types/${seg(id)}/evals`, {
      body: params,
      options,
    });
  }

  // ─────────────────────────────── feedback + generation ───────────────────────────────

  private async submitFeedback(
    requestId: string,
    params: FeedbackParams,
    options: RequestOptions = {},
  ): Promise<Feedback> {
    // The route wraps the row in `{ feedback: … }`; unwrap so callers always get a bare Feedback.
    const data = await this.json<{ feedback?: Feedback } & Partial<Feedback>>(
      'POST',
      `/v1/requests/${seg(requestId)}/feedback`,
      { body: params, options },
    );
    return (data.feedback ?? data) as Feedback;
  }

  private getGeneration(requestId: string, options: RequestOptions = {}): Promise<GenerationStats> {
    return this.json<GenerationStats>('GET', `/v1/generation?id=${seg(requestId)}`, { options });
  }

  // ─────────────────────────────── artifact types ───────────────────────────────

  /**
   * `POST /v1/artifact-types`. Versions are append-only: an unchanged upsert returns the existing
   * version and appends nothing, so calling it at startup is free. Unwraps `{ artifact_type }`.
   */
  private async upsertArtifactType(
    params: ArtifactTypeUpsertParams,
    options: RequestOptions = {},
  ): Promise<ArtifactType> {
    const data = await this.json<ArtifactTypeEnvelope>('POST', '/v1/artifact-types', {
      body: params,
      options,
    });
    return data.artifact_type;
  }

  // ─────────────────────────────── artifacts ───────────────────────────────

  /** `POST /v1/artifacts` (upsert by key). Unwraps `{ artifact }`. */
  private async createArtifact(
    params: CreateArtifactParams,
    options: RequestOptions = {},
  ): Promise<Artifact> {
    const data = await this.json<ArtifactEnvelope>('POST', '/v1/artifacts', {
      body: params,
      options,
    });
    return data.artifact;
  }

  /** `GET /v1/artifacts/{id}`. Unwraps `{ artifact }`. */
  private async getArtifact(id: string, options: RequestOptions = {}): Promise<Artifact> {
    const data = await this.json<ArtifactEnvelope>('GET', `/v1/artifacts/${seg(id)}`, { options });
    return data.artifact;
  }

  /** `GET /v1/artifacts` (keyset pagination; metadata only). */
  private listArtifacts(
    query: ArtifactListQuery = {},
    options: RequestOptions = {},
  ): Promise<ArtifactListResponse> {
    return this.json<ArtifactListResponse>(
      'GET',
      `/v1/artifacts${artifactListQueryString(query)}`,
      {
        options,
      },
    );
  }

  /** `POST /v1/artifacts/{id}/final`. */
  private recordArtifactFinal(
    id: string,
    params: FinalParams,
    options: RequestOptions = {},
  ): Promise<FinalResponse> {
    return this.json<FinalResponse>('POST', `/v1/artifacts/${seg(id)}/final`, {
      body: params,
      options,
    });
  }

  // ─────────────────────────────── outcomes ───────────────────────────────

  /** Durably record one outcome (persist first, then best-effort deliver). Never throws. */
  private recordOutcomeEvent(
    target: string | OutcomeTarget,
    outcome: OutcomeInput,
    options: RequestOptions = {},
  ): Promise<OutcomeReceipt> {
    return this.outcomeQueue.enqueue(normalizeOutcomeTarget(target), outcome, options);
  }

  /** `POST /v1/outcomes/batch` (at most 1,000 events). */
  private batchOutcomes(
    outcomes: BatchOutcomeInput[],
    options: RequestOptions = {},
  ): Promise<BatchOutcomesResponse> {
    return this.json<BatchOutcomesResponse>('POST', '/v1/outcomes/batch', {
      body: { outcomes },
      options,
    });
  }

  /** `GET /v1/outcomes/pending` (keyset pagination). */
  private pendingOutcomes(
    query: PendingOutcomesQuery = {},
    options: RequestOptions = {},
  ): Promise<PendingClaimsResponse> {
    return this.json<PendingClaimsResponse>(
      'GET',
      `/v1/outcomes/pending${pendingQueryString(query)}`,
      {
        options,
      },
    );
  }

  /** Drain the durable outcome queue. */
  private flushOutcomes(options?: RequestOptions): Promise<OutcomeFlushReport> {
    return this.outcomeQueue.flush(options);
  }

  /** Send one finalized outcome event verbatim (the queue's transport). */
  private async sendOutcome(
    entry: QueuedOutcome,
    requestOptions: RequestOptions = {},
  ): Promise<OutcomeResult> {
    // Every attempt — the first, each flush, a replay after a restart — carries the SAME key,
    // derived from the persisted entry, so the gateway can answer a replay with the original result.
    const options: RequestOptions = {
      ...requestOptions,
      idempotencyKey: outcomeIdempotencyKey(entry),
    };
    if ('request' in entry.target) {
      // The request shortcut takes a bare event and returns a bare result.
      return this.json<OutcomeResult>(
        'POST',
        `/v1/requests/${seg(entry.target.request)}/outcomes`,
        {
          body: entry.event,
          options,
        },
      );
    }
    const res = await this.json<RecordOutcomesResponse>(
      'POST',
      `/v1/artifacts/${seg(entry.target.artifact)}/outcomes`,
      { body: { outcomes: [entry.event] }, options },
    );
    const result = Array.isArray(res.data) ? res.data[0] : undefined;
    if (result === undefined) {
      throw new UltraRouterError({
        code: 'invalid_response',
        message: 'outcomes route returned no result row',
        status: 0,
        retryable: false,
      });
    }
    return result;
  }

  // ─────────────────────────────── reviewer adapter ───────────────────────────────

  /** `GET /v1/flywheel/reviewer/setup`. */
  private reviewerSetup(options: RequestOptions = {}): Promise<ReviewerSetup> {
    return this.json<ReviewerSetup>('GET', '/v1/flywheel/reviewer/setup', { options });
  }

  /**
   * `POST /v1/flywheel/reviewer/test`: `happy` sends a test artifact and an edited approved final
   * and returns the joined pair; `replay` re-sends the same event id (a `duplicate`);
   * `version_mismatch` deliberately dead-letters one for `repair()`. Test data never enters
   * learning or invoicing.
   */
  private reviewerTest(
    scenario: ReviewerTestScenario = 'happy',
    options: RequestOptions = {},
  ): Promise<ReviewerTestResult> {
    return this.json<ReviewerTestResult>('POST', '/v1/flywheel/reviewer/test', {
      body: { scenario },
      options,
    });
  }

  /** Durably queue one reviewer decision. */
  private reviewerRecord(
    event: ReviewerEvent,
    opts: ReviewerDeliveryOptions = {},
  ): Promise<string> {
    return this.reviewerQueue.enqueue(event, opts);
  }

  /** Post a signed batch immediately. */
  private reviewerSend(
    events: ReviewerEvent[],
    opts: ReviewerDeliveryOptions = {},
    options: RequestOptions = {},
  ): Promise<ReviewerEventsResponse> {
    return this.postSignedReviewerEvents(events, opts.backfill, opts.reviewerSystem, options);
  }

  /** Drain the durable reviewer queue. */
  private reviewerFlush(options?: RequestOptions): Promise<ReviewerFlushReport> {
    return this.reviewerQueue.flush(options);
  }

  /** Reviewer events refused with a repairable reason, still held locally. */
  private reviewerDeadLetters(): Promise<QueuedReviewerEvent[]> {
    return this.reviewerQueue.deadLetters();
  }

  /**
   * `POST /v1/flywheel/reviewer/repair`: re-drive one dead letter with the full original event the
   * client still holds. On success the local dead letter is cleared.
   */
  private async reviewerRepair(
    entry: QueuedReviewerEvent,
    opts: { repinToCurrentVersion?: boolean } = {},
    options: RequestOptions = {},
  ): Promise<ReviewerRepairResult> {
    const result = await this.json<ReviewerRepairResult>('POST', '/v1/flywheel/reviewer/repair', {
      body: {
        event: entry.event,
        ...(opts.repinToCurrentVersion !== undefined
          ? { repin_to_current_version: opts.repinToCurrentVersion }
          : {}),
        ...(entry.reviewerSystem !== undefined ? { reviewer_system: entry.reviewerSystem } : {}),
      },
      options,
    });
    if (result.result?.status === 'accepted' || result.result?.status === 'duplicate') {
      await this.reviewerQueue.clearDeadLetter(entry.id);
    }
    return result;
  }

  /** `GET /v1/flywheel/reviewer/health`. */
  private reviewerHealth(options: RequestOptions = {}): Promise<ReviewerHealth> {
    return this.json<ReviewerHealth>('GET', '/v1/flywheel/reviewer/health', { options });
  }

  /** The reviewer queue's transport: send one already-grouped batch. */
  private sendReviewerBatch(
    entries: readonly QueuedReviewerEvent[],
    backfill: ReviewerBackfill | undefined,
    reviewerSystem: string | undefined,
    options: RequestOptions = {},
  ): Promise<ReviewerEventsResponse> {
    return this.postSignedReviewerEvents(
      entries.map((e) => e.event),
      backfill,
      reviewerSystem,
      options,
    );
  }

  /**
   * POST a signed reviewer batch. The body is serialized once, signed, and the same object is handed
   * to the transport (`JSON.stringify` is deterministic for the same object), so the signature always
   * describes the bytes sent. A retry replays the identical body and signature, which the server's
   * `event_id` idempotency turns into a `duplicate`.
   */
  private postSignedReviewerEvents(
    events: readonly ReviewerEvent[],
    backfill: ReviewerBackfill | undefined,
    reviewerSystem: string | undefined,
    options: RequestOptions,
  ): Promise<ReviewerEventsResponse> {
    const body = {
      ...(reviewerSystem !== undefined ? { reviewer_system: reviewerSystem } : {}),
      ...(backfill !== undefined ? { backfill } : {}),
      events: [...events],
    };
    const raw = JSON.stringify(body);
    return reviewerSignatureHeaders(this.apiKey, raw).then((signature) =>
      this.json<ReviewerEventsResponse>('POST', '/v1/flywheel/reviewer/events', {
        body,
        options: { ...options, headers: { ...(options.headers ?? {}), ...signature } },
      }),
    );
  }

  /**
   * POST a body signed with an oracle secret: `x-ur-oracle-signature: sha256=<hex HMAC of
   * "<timestamp>.<raw body>">` plus `x-ur-oracle-timestamp`. Serialized once, so the signature
   * describes the exact bytes sent.
   */
  private async signedOracleJson<T>(
    path: string,
    params: unknown,
    signing: OracleSigningOptions,
    options: RequestOptions,
  ): Promise<T> {
    const body = params ?? {};
    const raw = JSON.stringify(body);
    const timestamp = String(signing.timestamp ?? Math.floor(Date.now() / 1000));
    const signature = await signReviewerPayload(signing.secret, timestamp, raw);
    return this.json<T>('POST', path, {
      body,
      options: {
        ...options,
        headers: {
          ...(options.headers ?? {}),
          [ORACLE_TIMESTAMP_HEADER]: timestamp,
          [ORACLE_SIGNATURE_HEADER]: signature,
        },
      },
    });
  }

  // ─────────────────────────────── flywheel status ───────────────────────────────

  /** `GET /v1/flywheel/status`. */
  private flywheelStatus(options: RequestOptions = {}): Promise<FlywheelStatus> {
    return this.json<FlywheelStatus>('GET', '/v1/flywheel/status', { options });
  }

  /**
   * The `learning` block of `GET /v1/flywheel/status`: the calibration availability the gateway
   * declares. There is no separate calibration route; this never fabricates a track record.
   */
  private async flywheelCalibration(options: RequestOptions = {}): Promise<FlywheelCalibration> {
    const status = await this.flywheelStatus(options);
    return status.learning;
  }

  // ─────────────────────────────── imports ───────────────────────────────

  /** `POST /v1/imports`. Unwraps `{ import }`. */
  private async createImport(params: ImportParams, options: RequestOptions = {}): Promise<Import> {
    const data = await this.json<ImportEnvelope>('POST', '/v1/imports', { body: params, options });
    return data.import;
  }

  /** `GET /v1/imports/{id}`. Unwraps `{ import }`. */
  private async getImport(id: string, options: RequestOptions = {}): Promise<Import> {
    const data = await this.json<ImportEnvelope>('GET', `/v1/imports/${seg(id)}`, { options });
    return data.import;
  }

  /** `GET /v1/imports` (keyset pagination). */
  private listImports(
    query: ImportListQuery = {},
    options: RequestOptions = {},
  ): Promise<ImportListResponse> {
    return this.json<ImportListResponse>('GET', `/v1/imports${importListQueryString(query)}`, {
      options,
    });
  }

  /** `POST /v1/imports/{id}/cancel`. Unwraps `{ import }`. */
  private async cancelImport(id: string, options: RequestOptions = {}): Promise<Import> {
    const data = await this.json<ImportEnvelope>('POST', `/v1/imports/${seg(id)}/cancel`, {
      options,
    });
    return data.import;
  }

  // ─────────────────────────────── withArtifact ───────────────────────────────

  /**
   * Run `fn` with a scope bound to one artifact `key`: chat and embeddings calls carry
   * `ur.artifact = key`, `scope.record` / `scope.final` target the artifact, and the durable outcome
   * queue is flushed when `fn` settles (success or throw). The artifact is upserted lazily on the
   * first `record` / `final`, so a chat-only scope makes no extra call. Resolves to `fn`'s result.
   *
   * @example
   * ```ts
   * import UltraRouter from "@ultrarouter/sdk";
   *
   * const ur = new UltraRouter({ defaultModel: "openai/gpt-5.2-mini" });
   * const answer = await ur.withArtifact("ticket-4821", async (scope) => {
   *   const res = await scope.chat.completions.create({
   *     messages: [{ role: "user", content: "Draft a reply." }],
   *   });
   *   await scope.record({ channel: "mechanical", kind: "schema_valid" });
   *   return res;
   * });
   * console.log("id" in answer ? answer.id : "stream");
   * ```
   */
  async withArtifact<T>(key: string, fn: (scope: ArtifactScope) => Promise<T> | T): Promise<T> {
    let artifactId: string | undefined;
    const ensureId = async (): Promise<string> => {
      if (artifactId === undefined) {
        const artifact = await this.createArtifact({ key });
        artifactId = artifact.id;
      }
      return artifactId;
    };
    const scope: ArtifactScope = {
      key,
      chat: {
        completions: {
          create: (params, o) => this.chat.completions.create(bindArtifactKey(params, key), o),
        },
      },
      embeddings: {
        create: (params, o) => this.embeddings.create(bindArtifactKey(params, key), o),
      },
      record: async (outcome, o) =>
        this.outcomeQueue.enqueue({ artifact: await ensureId() }, outcome, o),
      final: async (params, o) => this.recordArtifactFinal(await ensureId(), params, o),
    };
    try {
      return await fn(scope);
    } finally {
      // Never lose a durably-queued outcome: drain at the end of the scope, success or error.
      await this.outcomeQueue.flush();
    }
  }

  // ─────────────────────────────── preflight + useLearned ───────────────────────────────

  /**
   * Ask the gateway, before a call you make directly to a provider, which model and fallbacks to use
   * and which learned knowledge to inject (and where). With a cluster key (`artifact_key` or
   * `trace_id`) the response also carries an exposure grant.
   *
   * Pass `messages` (the messages you are about to send) when the call type learns per-request
   * cases: the gateway renders the cases nearest that input. Without `messages` such a call type
   * answers `knowledge: null` with `knowledge_reason: "case_query_missing"`. The messages are used
   * only for that rendering.
   *
   * The client honours the gateway's two cache lifetimes: the config-versioned part is revalidated
   * with `ETag` / `If-None-Match` (a 304 reuses the cached body), the health-ordered fallbacks expire
   * after the live window (`X-UR-Live-Max-Age`, 30 s by default), and the grant is never cached — it
   * is read fresh from the `X-UR-Grant` header on every response, including a 304. `noCache: true`
   * bypasses the cache; `maxAgeS` overrides the live window.
   *
   * @example
   * ```ts
   * import UltraRouter from "@ultrarouter/sdk";
   *
   * const ur = new UltraRouter();
   * const messages = [{ role: "user" as const, content: "Is this invoice a duplicate?" }];
   * const advice = await ur.preflight({ call_type: "invoice-triage", messages });
   * console.log(advice.routing.model?.id, advice.knowledge?.placement);
   * ```
   */
  async preflight(
    params: PreflightParams,
    options: PreflightRequestOptions = {},
  ): Promise<PreflightResponse> {
    const now = options.now ?? Date.now;
    const key = preflightCacheKey(params);
    const hasClusterKey = preflightHasClusterKey(params);
    const entry = options.noCache === true ? undefined : this.preflightCache.get(key);
    const decision = decidePreflightCache(entry, now(), hasClusterKey, options.maxAgeS);

    // The config part is fresh and there is no cluster key (so no grant to fetch): serve the cached
    // body with no network. Its grant was already stripped to null when it was stored.
    if (decision.kind === 'fresh' && entry !== undefined) {
      return withHeaderGrant(entry.body, null);
    }

    const requestOptions: RequestOptions = {
      ...options,
      ...(decision.kind === 'revalidate'
        ? { headers: { ...(options.headers ?? {}), 'if-none-match': decision.ifNoneMatch } }
        : {}),
    };
    const open = await this.send('POST', '/v1/preflight', {
      body: params,
      stream: false,
      options: requestOptions,
      acceptNotModified: decision.kind === 'revalidate',
    });
    const response = open.response;

    // The grant is always read fresh from the uncached header, never from the cached body.
    const headerGrant = parseGrantHeader(response.headers.get(PREFLIGHT_GRANT_HEADER));

    if (response.status === 304 && entry !== undefined) {
      open.release();
      // Config part unchanged: reuse the cached body plus the fresh header grant. `storedAtMs` is not
      // reset, so the unrefreshed fallbacks still expire on the live schedule.
      return withHeaderGrant(entry.body, headerGrant);
    }

    const text = await readText(open);
    const body = parseJsonBody<PreflightResponse>(text, 'POST', '/v1/preflight', response.status);
    const etag = response.headers.get('etag');
    if (etag !== null && options.noCache !== true) {
      const configMaxAgeS =
        parseMaxAgeSeconds(response.headers.get('cache-control')) ??
        PREFLIGHT_DEFAULT_CONFIG_MAX_AGE_S;
      const liveHeader = response.headers.get(PREFLIGHT_LIVE_MAX_AGE_HEADER);
      const liveMaxAgeS =
        (liveHeader !== null ? Number(liveHeader) : Number.NaN) ||
        body.routing?.max_age_s ||
        PREFLIGHT_DEFAULT_LIVE_MAX_AGE_S;
      // Store the body with the grant stripped to null: a grant is never cached.
      this.preflightCache.set(key, {
        etag,
        body: { ...body, grant: null },
        storedAtMs: now(),
        configMaxAgeS,
        liveMaxAgeS,
      });
    }
    return withHeaderGrant(body, headerGrant);
  }

  /**
   * Read the active hosted prompt for a call type (`{ version, template, variables, sha256 }`), or
   * `null` when the call type is code-owned. It reuses {@link UltraRouter.preflight}; render it with
   * {@link renderPrompt}, which applies the same fail-closed `{{name}}` substitution as the gateway.
   */
  async getPrompt(
    callType: string,
    options: PreflightRequestOptions = {},
  ): Promise<PreflightPrompt | null> {
    const res = await this.preflight({ call_type: callType }, options);
    return res.prompt;
  }

  /**
   * A stateful wrapper over {@link UltraRouter.preflight} for callers that call their model directly.
   * It preflights once, then `apply(messages)` inserts the learned module at the cache-safe position
   * (right after the leading system messages) and `record(outcome)` records an outcome that quotes the
   * exposure grant (it upserts the artifact named by `artifact_key` with the grant, then queues the
   * outcome). Include `messages` in `params` when the call type learns per-request cases.
   *
   * @example
   * ```ts
   * import UltraRouter from "@ultrarouter/sdk";
   *
   * const ur = new UltraRouter();
   * const messages = [
   *   { role: "system" as const, content: "You triage invoices." },
   *   { role: "user" as const, content: "Is INV-77 a duplicate?" },
   * ];
   * const session = await ur.useLearned({ call_type: "invoice-triage", artifact_key: "inv-77", messages });
   * const prompt = session.apply(messages); // send `prompt` to your provider
   * await session.record({ channel: "declared", kind: "resolved_true" });
   * console.log(prompt.length, session.model);
   * ```
   */
  async useLearned(
    params: PreflightParams,
    options: PreflightRequestOptions = {},
  ): Promise<LearnedSession> {
    const preflight = await this.preflight(params, options);
    const artifactKey = params.artifact_key;
    const grant = preflight.grant;
    const knowledge = preflight.knowledge;
    return {
      preflight,
      grant,
      knowledge,
      model: preflight.routing.model?.id ?? null,
      apply: <M extends { readonly role?: unknown }>(
        messages: readonly M[],
      ): (M | LearnedMessage)[] =>
        // The caller calls its model directly, so the gateway never sees this request and cannot
        // inject. apply() therefore always injects the returned module, whatever `delivery` says
        // (`delivery` governs only proxied requests). A holdout arm or no module ⇒ unchanged.
        applyLearnedContext(messages, knowledge?.module.content ?? null),
      record: async (
        outcome: OutcomeInput,
        recordOptions: LearnedRecordOptions = {},
      ): Promise<OutcomeReceipt> => {
        if (artifactKey === undefined) {
          throw new UltraRouterError({
            code: 'invalid_request',
            message:
              'useLearned().record needs an `artifact_key` on the preflight params to quote the grant on an artifact',
            status: 0,
            retryable: false,
          });
        }
        const grantId = grant?.grant_id;
        const artifact = await this.createArtifact(
          {
            key: artifactKey,
            archetype: recordOptions.archetype ?? 'answer',
            ...(grantId !== undefined
              ? { grant_id: grantId, attestation: 'applied' as const }
              : {}),
          },
          recordOptions.request ?? {},
        );
        return this.outcomeQueue.enqueue(
          { artifact: artifact.id },
          outcome,
          recordOptions.request ?? {},
        );
      },
    };
  }

  // ─────────────────────────────── asOpenAI ───────────────────────────────

  /**
   * Return an OpenAI-client-compatible configuration (`{ baseURL, apiKey, defaultHeaders? }`, with
   * `/v1` appended) or, given the `OpenAI` constructor, a ready client instance pointed at the
   * gateway. `openai` is not a dependency of this SDK.
   *
   * @example
   * ```ts
   * import OpenAI from "openai";
   * import UltraRouter from "@ultrarouter/sdk";
   *
   * const openai = new UltraRouter().asOpenAI(OpenAI);
   * const res = await openai.chat.completions.create({
   *   model: "openai/gpt-5.2-mini",
   *   messages: [{ role: "user", content: "hi" }],
   * });
   * console.log(res.choices[0]?.message.content);
   * ```
   */
  asOpenAI(): OpenAICompatConfig;
  asOpenAI<T>(ctor: OpenAIConstructor<T>): T;
  asOpenAI<T>(ctor?: OpenAIConstructor<T>): OpenAICompatConfig | T {
    const preset: OpenAICompatConfig = {
      baseURL: `${this.baseURL}/v1`,
      apiKey: this.apiKey,
      ...(Object.keys(this.defaultHeaders).length > 0
        ? { defaultHeaders: this.defaultHeaders }
        : {}),
    };
    return ctor === undefined ? preset : buildOpenAIAdapter(preset, ctor);
  }

  // ─────────────────────────────── transport ───────────────────────────────

  private buildHeaders(options: RequestOptions, hasBody: boolean): Record<string, string> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.apiKey}`,
      ...this.defaultHeaders,
    };
    // A per-request X-UR-Bench-Trace (a fresh trace id per call); caller headers still win.
    if (this.benchTraceFactory !== undefined) {
      headers['x-ur-bench-trace'] = this.benchTraceFactory();
    }
    Object.assign(headers, options.headers ?? {});
    if (hasBody) headers['content-type'] = 'application/json';
    return headers;
  }

  private async send(
    method: string,
    path: string,
    opts: {
      body?: unknown;
      stream: boolean;
      options: RequestOptions;
      /** Return a 304 as a success (the conditional preflight request). */
      acceptNotModified?: boolean;
    },
  ): Promise<OpenResponse> {
    const hasBody = opts.body !== undefined;
    const headers = this.buildHeaders(opts.options, hasBody);
    if (opts.stream) headers['accept'] = 'text/event-stream';
    const req: HttpRequest = {
      method,
      url: `${this.baseURL}${path}`,
      headers,
      ...(hasBody ? { body: JSON.stringify(opts.body) } : {}),
      stream: opts.stream,
      ...(opts.options.signal !== undefined ? { signal: opts.options.signal } : {}),
      timeoutMs: opts.options.timeout ?? this.timeoutMs,
      maxRetries: opts.options.maxRetries ?? this.maxRetries,
      ...(opts.options.idempotencyKey !== undefined
        ? { idempotencyKey: opts.options.idempotencyKey }
        : {}),
      ...(opts.acceptNotModified === true ? { acceptNotModified: true } : {}),
    };
    return executeRequest({ fetch: this.fetchImpl }, req);
  }

  private async json<T>(
    method: string,
    path: string,
    opts: { body?: unknown; options: RequestOptions },
  ): Promise<T> {
    const open = await this.send(method, path, {
      ...(opts.body !== undefined ? { body: opts.body } : {}),
      stream: false,
      options: opts.options,
    });
    return parseJsonBody<T>(await readText(open), method, path, open.response.status);
  }

  /** Like `json` but resolves the raw response text (Bench `md` / `bundle` reports). */
  private async text(
    method: string,
    path: string,
    opts: { body?: unknown; options: RequestOptions },
  ): Promise<string> {
    const open = await this.send(method, path, {
      ...(opts.body !== undefined ? { body: opts.body } : {}),
      stream: false,
      options: opts.options,
    });
    return readText(open);
  }
}

/** Parse a JSON response body; an empty body is `{}`; a non-JSON body is a typed `invalid_response`. */
function parseJsonBody<T>(text: string, method: string, path: string, status: number): T {
  if (text === '') return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new UltraRouterError({
      code: 'invalid_response',
      message: `expected a JSON response from ${method} ${path.split('?')[0] ?? path}`,
      status,
      retryable: false,
    });
  }
}

/** Warn once, at construction, that a live key plus a bench tag is refused by the gateway. */
function warnLiveBenchKey(suite: string): void {
  if (typeof console === 'undefined' || typeof console.warn !== 'function') return;
  console.warn(
    `[ultrarouter] Bench capture (suite '${suite}') is not honored on a live (ur_sk_live_*) key: ` +
      'the gateway returns 400 unless a workspace owner enables `bench_allow_live_capture`. ' +
      'Use a test key (ur_sk_test_*) for Bench. This warning fires once.',
  );
}

/** `GET /v1/models` filters. */
export interface ModelListQuery {
  /** Only models served by this provider slug. */
  provider?: string;
  /** Only models with this capability (for example `tools` or `json_schema`). */
  capability?: string;
}

/**
 * The scope handed to `withArtifact(key, fn)`. Every chat and embeddings call carries
 * `ur.artifact = key`; `record` and `final` target the artifact.
 */
export interface ArtifactScope {
  /** The bound artifact key. */
  readonly key: string;
  /** Chat completions bound to the artifact. */
  chat: {
    completions: {
      /** Create a chat completion carrying `ur.artifact = key`. */
      create: (
        params: ChatCompletionCreateParams,
        options?: RequestOptions,
      ) => Promise<ChatCompletion | ChatCompletionStream>;
    };
  };
  /** Embeddings bound to the artifact. */
  embeddings: {
    /** Create embeddings carrying `ur.artifact = key`. */
    create: (
      params: EmbeddingCreateParams,
      options?: RequestOptions,
    ) => Promise<CreateEmbeddingResponse>;
  };
  /** Durably record an outcome on the bound artifact (upserted on first use). */
  record: (outcome: OutcomeInput, options?: RequestOptions) => Promise<OutcomeReceipt>;
  /** Record the human-approved final on the bound artifact. */
  final: (params: FinalParams, options?: RequestOptions) => Promise<FinalResponse>;
}

/** Options for {@link LearnedSession.record}. */
export interface LearnedRecordOptions {
  /** The artifact archetype for the grant-quoting upsert (default `answer`). */
  archetype?: ArtifactArchetype;
  /** Request options forwarded to the artifact upsert and the outcome record. */
  request?: RequestOptions;
}

/**
 * The session `useLearned(params)` resolves: the preflight answer plus the two actions a caller that
 * calls its model directly needs — place the learned module, and record an outcome quoting the grant.
 */
export interface LearnedSession {
  /** The full preflight response (routing, knowledge, grant, prompt). */
  readonly preflight: PreflightResponse;
  /** The exposure grant (present when a cluster key was given; `null` otherwise). */
  readonly grant: PreflightGrant | null;
  /** The learned knowledge to inject (`null` on a holdout arm or when nothing applies). */
  readonly knowledge: PreflightKnowledge | null;
  /** The recommended model id, or `null` when none resolves. */
  readonly model: string | null;
  /**
   * Insert the learned module into `messages` right after the leading system messages (the same
   * position the gateway uses). Always injects when `knowledge` is present; passes the messages
   * through unchanged when it is `null`. Pure: never mutates the input.
   */
  apply: <M extends { readonly role?: unknown }>(messages: readonly M[]) => (M | LearnedMessage)[];
  /**
   * Record an outcome on the artifact named by the preflight `artifact_key`, quoting the grant
   * (`grant_id` + `attestation: 'applied'`), through the durable outcome queue.
   */
  record: (outcome: OutcomeInput, options?: LearnedRecordOptions) => Promise<OutcomeReceipt>;
}
