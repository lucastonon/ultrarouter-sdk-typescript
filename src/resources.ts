/**
 * Types for the operations the client covers beyond chat, embeddings and the outcome ledger, plus
 * the type machinery behind the typed {@link import('./client.js').UltraRouter.request} escape
 * hatch. Every shape is derived from the generated OpenAPI types, so it cannot drift from the
 * published contract.
 */

import type { components, operations, paths } from './generated/types.js';

type Schemas = components['schemas'];

// ─────────────────────────────── generic operation helpers ───────────────────────────────

/** Every `operationId` in the published OpenAPI document. */
export type OperationId = keyof operations;

/** The JSON body of an operation's success response (`200`, `201` or `202`), or `unknown`. */
export type SuccessBody<Responses> = Responses extends {
  200: { content: { 'application/json': infer B } };
}
  ? B
  : Responses extends { 201: { content: { 'application/json': infer B } } }
    ? B
    : Responses extends { 202: { content: { 'application/json': infer B } } }
      ? B
      : unknown;

/** The success response body of an operation, by `operationId`. */
export type OperationResponse<Op extends OperationId> = SuccessBody<operations[Op]['responses']>;

/** The JSON request body of an operation, by `operationId` (`never` when it takes none). */
export type OperationRequestBody<Op extends OperationId> = operations[Op] extends {
  requestBody: { content: { 'application/json': infer B } };
}
  ? B
  : operations[Op] extends { requestBody?: { content: { 'application/json': infer B } } }
    ? B
    : never;

/** The query parameters of an operation, by `operationId` (`never` when it takes none). */
export type OperationQuery<Op extends OperationId> = operations[Op]['parameters'] extends {
  query?: infer Q;
}
  ? Q
  : never;

/** An HTTP method the typed {@link import('./client.js').UltraRouter.request} helper accepts. */
export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** Every path template that defines the given method, e.g. `ApiPath<'get'>` includes `/v1/models/{id}`. */
export type ApiPath<M extends HttpMethod> = {
  [P in keyof paths]: paths[P][M] extends { responses: unknown } ? P : never;
}[keyof paths];

/** The operation object for a path template + method. */
export type ApiOperation<M extends HttpMethod, P extends ApiPath<M>> = paths[P][M];

/** The success response body for a path template + method. */
export type ApiResponse<M extends HttpMethod, P extends ApiPath<M>> =
  ApiOperation<M, P> extends { responses: infer R } ? SuccessBody<R> : unknown;

type PathParamsOf<Op> = Op extends { parameters: { path: infer PP } } ? PP : never;
/** Query values are strings on the wire; numbers and booleans are accepted and stringified, and `undefined` is skipped. */
type LooseQuery<Q> = {
  [K in keyof Q]?: Q[K] | (NonNullable<Q[K]> extends string ? number | boolean : never) | undefined;
};
type QueryOf<Op> = Op extends { parameters: { query?: infer Q } }
  ? LooseQuery<NonNullable<Q>>
  : never;
type BodyOf<Op> = Op extends { requestBody: { content: { 'application/json': infer B } } }
  ? B
  : Op extends { requestBody?: { content: { 'application/json': infer B } } }
    ? B
    : never;

/**
 * Options for the typed {@link import('./client.js').UltraRouter.request} helper: the path
 * parameters, the query string and the JSON body, each typed from the OpenAPI operation.
 */
export interface ApiRequestInit<M extends HttpMethod, P extends ApiPath<M>> {
  /** Values for the `{placeholders}` in the path template. Each value is percent-encoded. */
  path?: PathParamsOf<ApiOperation<M, P>>;
  /** Query-string parameters. `undefined` values are skipped. */
  query?: QueryOf<ApiOperation<M, P>>;
  /** The JSON request body. */
  body?: BodyOf<ApiOperation<M, P>>;
}

// ─────────────────────────────── models + key ───────────────────────────────

/** `models.retrieve(id)`: one logical model with every provider offer that serves it. */
export type ModelDetail = Schemas['ModelDetailResponse'];

/** `ur.key.get()`: the presented API key describing itself (scopes, caps, usage this period). */
export type KeyInfo = Schemas['KeyIntrospection'];

// ─────────────────────────────── call types: evals, recommendations ───────────────────────────────

/** `ur.callTypes.listEvals(id)`: a call type's eval runs, their candidates and run specs. */
export type EvalRunList = Schemas['EvalRunListResponse'];

/**
 * `ur.callTypes.recommendations(id)`: the eval-backed model recommendations for a call type. The
 * OpenAPI document does not publish this response schema yet, so it is typed as an open object.
 */
export type CallTypeRecommendations = Record<string, unknown>;

// ─────────────────────────────── hosted prompts ───────────────────────────────

/** `ur.callTypes.prompts.list(id)`: every hosted prompt version of a call type + the active pointer. */
export type HostedPromptList = OperationResponse<'listHostedPrompts'>;

/** One immutable hosted prompt version (`create` / `get`). */
export type HostedPromptVersion = OperationResponse<'getHostedPrompt'>;

/** The body of `ur.callTypes.prompts.create(id, params)`. */
export type CreateHostedPromptParams = OperationRequestBody<'createHostedPrompt'>;

/** The body of `ur.callTypes.prompts.activate(id, version, params)`. */
export type ActivateHostedPromptParams = OperationRequestBody<'activateHostedPrompt'>;

/** The active hosted-prompt pointer after `activate` / `deactivate`. */
export type HostedPromptPointer = OperationResponse<'activateHostedPrompt'>;

/** `ur.callTypes.prompts.proposal(id)`: the host-your-prompt onboarding proposal for a call type. */
export type HostedPromptProposal = OperationResponse<'getHostedPromptProposal'>;

// ─────────────────────────────── verified memory ───────────────────────────────

/** `ur.callTypes.verifiedMemory.get(id)`: the verified-memory setting and its live servability. */
export type VerifiedMemoryStatus = OperationResponse<'getVerifiedMemory'>;

/** The body of `ur.callTypes.verifiedMemory.enable(id, params)`. */
export type EnableVerifiedMemoryParams = OperationRequestBody<'enableVerifiedMemory'>;

/** The result of `ur.callTypes.verifiedMemory.enable(id)`. */
export type VerifiedMemoryEnableResult = OperationResponse<'enableVerifiedMemory'>;

/** The result of `ur.callTypes.verifiedMemory.disable(id)` (the kill switch). */
export type VerifiedMemoryDisableResult = OperationResponse<'disableVerifiedMemory'>;

// ─────────────────────────────── improvement reads ───────────────────────────────

/** `ur.improvementReads.list()`: for every call type, a cost read and a quality read. */
export type ImprovementReads = Schemas['ImprovementReadsResponse'];

/** One call type's pair of improvement reads. */
export type CallTypeImprovementReads = Schemas['CallTypeImprovementReads'];

// ─────────────────────────────── verdict sources ───────────────────────────────

/** `ur.flywheel.sources()`: every verdict source of the workspace and whether it counts. */
export type VerdictSources = OperationResponse<'listVerdictSources'>;

/** The body of `ur.flywheel.sourceChecks.issue(params)`. */
export type IssueSourceCheckParams = OperationRequestBody<'issueVerdictSourceCheck'>;

/** An issued planted-failure check (its probes are returned once). */
export type SourceCheck = OperationResponse<'issueVerdictSourceCheck'>;

/** The body of `ur.flywheel.sourceChecks.answer(id, params)`. */
export type AnswerSourceCheckParams = OperationRequestBody<'gradeVerdictSourceCheck'>;

/** A graded planted-failure check. */
export type SourceCheckGrade = OperationResponse<'gradeVerdictSourceCheck'>;

// ─────────────────────────────── oracles (checks) ───────────────────────────────

/** The body of `ur.oracles.register(params)`. */
export type RegisterOracleParams = OperationRequestBody<'registerOracle'>;

/** A registered oracle version. */
export type OracleRegistration = OperationResponse<'registerOracle'>;

/** `ur.oracles.get(id)`: an oracle, the role its current version earned, and its transport state. */
export type Oracle = OperationResponse<'getOracle'>;

/** The body of `ur.oracles.qualify(id, params)`. */
export type QualifyOracleParams = OperationRequestBody<'qualifyOracle'>;

/** An oracle qualification. */
export type OracleQualification = OperationResponse<'qualifyOracle'>;

/** The body of `ur.oracles.test(id, params)`. */
export type TestOracleParams = OperationRequestBody<'testOracle'>;

/** A send-test result (never graded). */
export type OracleTestResult = OperationResponse<'testOracle'>;

/** The result of `ur.oracles.revoke(id)`. */
export type OracleRevocation = OperationResponse<'revokeOracle'>;

/** The body of `ur.oracles.claimJobs(id, params)` (pull transport). */
export type ClaimOracleJobsParams = OperationRequestBody<'claimOracleJobs'>;

/** Claimed pull jobs; each payload is returned exactly once. */
export type OracleJobClaim = OperationResponse<'claimOracleJobs'>;

/** The body of `ur.oracles.submitVerdicts(id, params)` (pull transport). */
export type SubmitOracleVerdictsParams = OperationRequestBody<'submitOracleVerdicts'>;

/** The recorded verdicts. */
export type OracleVerdictsResult = OperationResponse<'submitOracleVerdicts'>;

/** Signing options for the oracle pull transport: the oracle's HMAC secret. */
export interface OracleSigningOptions {
  /** The oracle signing secret returned when the oracle was registered or its secret rotated. */
  secret: string;
  /** Override the signing time (unix seconds). Defaults to now; a testing seam. */
  timestamp?: number;
}

/** The request header carrying the oracle pull-transport signature (`sha256=<hex>`). */
export const ORACLE_SIGNATURE_HEADER = 'x-ur-oracle-signature';

/** The request header carrying the oracle signature timestamp (unix seconds). */
export const ORACLE_TIMESTAMP_HEADER = 'x-ur-oracle-timestamp';

// ─────────────────────────────── bounded experiments (run surface) ───────────────────────────────

/** The body of `ur.flywheel.experiments.enrol(id, params)` (`{ phase, pair_key, slot }`). */
export type EnrolExperimentExecutionParams =
  OperationRequestBody<'enrolFlywheelExperimentExecution'>;

/**
 * One enrolled experiment execution. `arm` is decided by the sealed assignment, never by the
 * caller; send `execution_id` as the `x-ur-experiment-execution` header on every call of the run.
 */
export type ExperimentExecution = OperationResponse<'enrolFlywheelExperimentExecution'>;

/** The request header every call of an enrolled execution carries (its `execution_id`). */
export const EXPERIMENT_EXECUTION_HEADER = 'x-ur-experiment-execution';

/** The body of `ur.flywheel.experiments.outcome(...)` — ids, hashes and numbers only, never a body. */
export type RecordExperimentOutcomeParams =
  OperationRequestBody<'recordFlywheelExperimentExecutionOutcome'>;

/**
 * The `POST …/executions/{execution_id}/outcome` response. The gateway returns one of two shapes,
 * discriminated by `object`: a recorded outcome, or — with `?dry_run=true` — the dry-run answer.
 */
type ExperimentOutcomeResult = OperationResponse<'recordFlywheelExperimentExecutionOutcome'>;

/** A recorded live-execution outcome (`object: 'flywheel_experiment_execution_outcome'`). */
export type ExperimentExecutionOutcome = Extract<
  ExperimentOutcomeResult,
  { object: 'flywheel_experiment_execution_outcome' }
>;

/**
 * An outcome dry-run answer (`object: 'flywheel_experiment_execution_outcome_dry_run'`): the answer
 * the record would give now — `status`, the named `refusal`, `missing_request_ids`,
 * `unlisted_request_ids` and `open_holds` — with nothing written.
 */
export type ExperimentExecutionOutcomeDryRun = Extract<
  ExperimentOutcomeResult,
  { object: 'flywheel_experiment_execution_outcome_dry_run' }
>;

/** The explicit screen re-evaluation (`POST …/screen/evaluate`): counts before the verdict, the verdict after. */
export type ExperimentScreenEvaluation = OperationResponse<'evaluateFlywheelExperimentScreen'>;

/** The explicit prospective-test re-evaluation (`POST …/test/evaluate`): counts before the decision, the decision after. */
export type ExperimentTestEvaluation = OperationResponse<'evaluateFlywheelExperimentTest'>;
