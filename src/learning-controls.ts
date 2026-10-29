/**
 * Learning controls for one call type: `ur.ur.learning.*` over `/v1/call-types/{id}/learning*`.
 *
 * Learning turns verified outcomes into candidate versions, evaluates each candidate against the
 * version currently serving (the incumbent), and promotes it only when the promotion policy says so.
 * These controls read that state and steer it: enable, pause, resume, disable, version history,
 * rollback to an exact earlier version, and manual promote / reject.
 *
 * Every shape is aliased from the generated OpenAPI types, so it cannot drift from the contract.
 */

import { UltraRouterError } from './errors.js';
import type { components } from './generated/types.js';
import type { OperationRequestBody, OperationResponse } from './resources.js';

type Schemas = components['schemas'];

/** `GET /v1/call-types/{id}/learning`: a call type's learning status (`object: "learning"`). */
export type LearningStatus = Schemas['LearningStatus'];

/**
 * The learning state: `off`, `collecting` (enabled, waiting for evidence), `learning` (a reflection
 * is due or an evaluation runs), `paused`, `disabled` (the kill switch), `unavailable` (consent,
 * provider or repeated failures), `quota_exhausted` / `budget_exhausted` (refused for resources and
 * retried with backoff — never silent).
 */
export type LearningState = LearningStatus['state'];

/** The result of every learning control: what happened plus the resulting status. */
export type LearningControlResult = Schemas['LearningControlResponse'];

/** The control a {@link LearningControlResult} reports. */
export type LearningControlAction = LearningControlResult['action'];

/** The full promotion policy (as the status reports it). */
export type LearningPromotionPolicy = Schemas['LearningPromotionPolicy'];

/**
 * How a candidate becomes active: `evaluate` (a randomized evaluation against the incumbent under a
 * rule frozen when it starts), `manual` (an owner or admin promotes or rejects it) or `immediate`
 * (publication is activation).
 */
export type LearningPromotionMode = LearningPromotionPolicy['mode'];

/**
 * What an evaluation must show: `success` (a higher whole-task success rate) or `cost_noninferior`
 * (a lower mean cost with success not worse than the declared margin).
 */
export type LearningObjective = LearningPromotionPolicy['objective'];

/**
 * `ur.ur.learning.enable(callTypeId, params)`: `reflection_model` (required; it must resolve to a
 * workspace-owned offer), and optionally `lessons_mode`, `lessons_k`, `promotion` (an object of
 * policy changes merged over the current policy) and `recipe`.
 */
export type EnableLearningParams = Schemas['EnableLearningRequest'];

/** `ur.ur.learning.rollback(callTypeId, params)`: the earlier `version_id` (default: the previous one). */
export type LearningRollbackParams = OperationRequestBody<'rollbackLearning'>;

/** A learned version as the history reports it (`object: "learning_version"`, id `epb_…`). */
export type LearningVersion = Schemas['LearningVersion'];

/** A version's state. Versions are immutable; only their state moves. */
export type LearningVersionState = LearningVersion['state'];

/** A short reference to a version inside a status (`active_version`, `latest_candidate`). */
export type LearningVersionRef = NonNullable<LearningStatus['active_version']>;

/** `GET /v1/call-types/{id}/learning/versions`: the version history, newest first. */
export type LearningVersionList = OperationResponse<'listLearningVersions'>;

/** `GET /v1/call-types/{id}/learning/versions/{version_id}`: one version, its lessons and provenance. */
export type LearningVersionDetail = Schemas['LearningVersionDetail'];

/** One lesson of a learned version. */
export type LearningLesson = LearningVersionDetail['lessons'][number];

/** One prospective randomized evaluation (`object: "learning_evaluation"`, id `lev_…`). */
export type LearningEvaluation = Schemas['LearningEvaluation'];

/** An evaluation's decision; every decision except `promoted` keeps the incumbent. */
export type LearningEvaluationDecision = LearningEvaluation['decision'];

/** One arm's evidence in an evaluation. */
export type LearningArmEvidence = LearningEvaluation['arms']['candidate'];

/** `GET /v1/call-types/{id}/learning/evaluations`: evaluations, newest first. */
export type LearningEvaluationList = OperationResponse<'listLearningEvaluations'>;

/** Evidence counts: recorded, verified, consumed, incorporated by the active version, backlog. */
export type LearningEvidence = LearningStatus['evidence'];

/** Outcome receipts attributed to the call type, by state. */
export type LearningReceiptCounts = LearningStatus['outcome_receipts'];

// ─────────────────────────────── actionable errors ───────────────────────────────

/** Why a learning control was refused, in terms you can act on. */
export type LearningErrorReason =
  | 'missing_consent'
  | 'provider_unavailable'
  | 'not_enabled'
  | 'invalid_promotion'
  | 'version_conflict'
  | 'quota_exhausted'
  | 'budget_exhausted'
  | 'not_found'
  | 'forbidden';

/**
 * The refusals each {@link LearningErrorReason} is recognised from: a named refusal (the first
 * token of the gateway's message, e.g. `corrections_consent_required: …` or
 * `reflection_model_not_workspace_owned (no_workspace_key): …`), else the error code.
 */
export const LEARNING_ERROR_CODES: Readonly<Record<LearningErrorReason, readonly string[]>> = {
  missing_consent: ['corrections_consent_required'],
  provider_unavailable: ['reflection_model_not_workspace_owned'],
  not_enabled: ['learning_not_enabled'],
  invalid_promotion: ['promotion_invalid'],
  version_conflict: [
    'version_already_active',
    'version_active',
    'no_rollback_target',
    'rollback_target_not_earlier',
  ],
  quota_exhausted: ['quota_exhausted'],
  budget_exhausted: ['budget_exhausted', 'spend_cap_exceeded'],
  not_found: ['not_found'],
  forbidden: ['permission'],
};

/** What to do about each {@link LearningErrorReason}. */
export const LEARNING_ERROR_ACTIONS: Readonly<Record<LearningErrorReason, string>> = {
  missing_consent:
    "A workspace owner or admin must turn on the workspace's corrections consent before learning can be enabled.",
  provider_unavailable:
    'Give the reflection model a workspace-owned offer (one of your custom providers, or a provider your workspace stored its own key for); learning never falls back to a platform provider. `detail` names what is missing.',
  not_enabled: 'Enable learning for this call type first (ur.ur.learning.enable).',
  invalid_promotion:
    'Fix the promotion policy: `detail` names the field or combination that is out of range.',
  version_conflict:
    'Read the version history (ur.ur.learning.versions): a rollback needs an earlier, non-active version (or a previous active one), and promote / reject act on a candidate that is not already active.',
  quota_exhausted:
    'The learning provider refused for quota. Learning retries with backoff on its own; resume it once the quota is raised.',
  budget_exhausted:
    'The learning budget is spent. Raise the budget or wait for the next period, then resume learning.',
  not_found: 'Check the call type id (or slug) and the version id.',
  forbidden:
    'Use a key with the config:write scope (config:read for reads) or an owner/admin session.',
};

/**
 * A learning control refused for a reason you can act on: `reason` names it, `refusal` is the
 * gateway's named refusal (or code), `detail` its parenthesized sub-reason when there is one, and
 * `action` says what to do. It is an {@link UltraRouterError}, so `code`, `status`, `requestId` and
 * `retryable` are the gateway's.
 */
export class LearningError extends UltraRouterError {
  /** Why the control was refused. */
  readonly reason: LearningErrorReason;
  /** The named refusal (the first token of the message, e.g. `no_rollback_target`) or the error code. */
  readonly refusal: string;
  /** The parenthesized sub-reason (e.g. `no_workspace_key`), or `null`. */
  readonly detail: string | null;
  /** What to do about it. */
  readonly action: string;

  /** Wrap a gateway error with its learning reason. */
  constructor(
    cause: UltraRouterError,
    reason: LearningErrorReason,
    refusal: string,
    detail: string | null,
  ) {
    super({
      code: cause.code,
      message: `${cause.message} (${LEARNING_ERROR_ACTIONS[reason]})`,
      status: cause.status,
      requestId: cause.requestId,
      retryable: cause.retryable,
      providerCode: cause.providerCode,
      envelope: cause.envelope,
    });
    this.name = 'LearningError';
    this.reason = reason;
    this.refusal = refusal;
    this.detail = detail;
    this.action = LEARNING_ERROR_ACTIONS[reason];
  }
}

/**
 * The named refusal a gateway message starts with: a `snake_case` token (at least one underscore),
 * optionally followed by a parenthesized sub-reason, then `:` or the end. `null` for anything else.
 */
export function parseLearningRefusal(
  message: string,
): { refusal: string; detail: string | null } | null {
  const m = /^([a-z][a-z0-9]*(?:_[a-z0-9]+)+)(?:\s*\(([a-z0-9_]+)\))?(?=\s*(?::|$))/.exec(message);
  if (m === null) return null;
  return { refusal: m[1] as string, detail: m[2] ?? null };
}

/** The {@link LearningErrorReason} for a named refusal or an error code, or `null`. */
export function learningErrorReason(token: string): LearningErrorReason | null {
  for (const [reason, codes] of Object.entries(LEARNING_ERROR_CODES)) {
    if (codes.includes(token)) return reason as LearningErrorReason;
  }
  return null;
}

/**
 * Turn a gateway refusal of a learning control into a {@link LearningError}: the named refusal at
 * the start of the message decides first, then the error code. Anything else (a transport failure,
 * an unrecognised refusal) is returned unchanged.
 */
export function toLearningError(err: unknown): unknown {
  if (!(err instanceof UltraRouterError) || err instanceof LearningError || err.status === 0) {
    return err;
  }
  const named = parseLearningRefusal(err.message);
  const byName = named === null ? null : learningErrorReason(named.refusal);
  if (byName !== null && named !== null) {
    return new LearningError(err, byName, named.refusal, named.detail);
  }
  const byCode = learningErrorReason(err.code);
  return byCode === null ? err : new LearningError(err, byCode, err.code, null);
}
