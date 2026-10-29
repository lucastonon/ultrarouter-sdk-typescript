/**
 * Learning controls for one call type: `ur.ur.learning.*` over `/v1/call-types/{id}/learning*`.
 *
 * Learning turns verified outcomes into candidate adaptations, evaluates each candidate against the
 * version currently serving (the incumbent), and promotes it only when the frozen decision rule
 * says so. These controls read that state and steer it: enable, pause, resume, disable, version
 * history, rollback to an exact earlier version, and manual promote / reject.
 *
 * The request and response types are written by hand ahead of the published API description and
 * are kept in this one module so they can be replaced by the generated ones without touching
 * callers. Fields may be added; the open string unions accept values a newer gateway introduces.
 */

import { UltraRouterError } from './errors.js';

/**
 * The learning state of a call type. `not_enabled` and `disabled` serve no learned version;
 * `active` learns and serves; `paused` keeps serving the active version but stops learning and
 * evaluation; `unavailable` has no usable learning provider; `quota_exhausted` and
 * `budget_exhausted` are stopped by a provider quota or the learning budget (never silently).
 */
export type LearningState =
  | 'not_enabled'
  | 'active'
  | 'paused'
  | 'disabled'
  | 'unavailable'
  | 'quota_exhausted'
  | 'budget_exhausted'
  | (string & {});

/**
 * How a candidate becomes active: `evaluate` (randomized evaluation against the incumbent under a
 * rule frozen before it starts), `manual` (an owner or admin promotes or rejects it) or `immediate`
 * (publication is activation).
 */
export type LearningPromotionMode = 'evaluate' | 'manual' | 'immediate';

/**
 * What an evaluation must show: `success` (better task success) or `cost_noninferior` (lower cost
 * without losing more success than the declared margin).
 */
export type LearningObjective = 'success' | 'cost_noninferior';

/** A learned version's state. Versions are immutable; only their state moves. */
export type LearningVersionState =
  'candidate' | 'evaluating' | 'active' | 'retired' | 'rejected' | 'superseded' | (string & {});

/** An evaluation's decision; `running` until it decides. */
export type LearningEvaluationDecision =
  | 'running'
  | 'promoted'
  | 'retained'
  | 'inconclusive'
  | 'rejected'
  | 'stopped_budget'
  | 'stopped_manual'
  | (string & {});

/** A promotion policy: the mode and, for `evaluate`, the objective. */
export interface LearningPromotionPolicy {
  /** How a candidate becomes active. */
  mode: LearningPromotionMode;
  /** What an evaluation must show (for `evaluate`). */
  objective?: LearningObjective | undefined;
}

/** `ur.ur.learning.enable(callTypeId, params)`: the self-serve enable request. */
export interface EnableLearningParams {
  /** The model (one your workspace has configured) that writes candidate adaptations. */
  reflection_model: string;
  /** The promotion policy, or just its mode (default `evaluate`). */
  promotion?: LearningPromotionMode | LearningPromotionPolicy | undefined;
  /** A named learning recipe (default: the gateway's default recipe). */
  recipe?: string | undefined;
}

/** A short reference to a learned version inside a status. */
export interface LearningVersionRef {
  /** The version id. */
  id: string;
  /** The version state. */
  state: LearningVersionState;
  /** When the version was created (ISO-8601). */
  created_at?: string;
}

/** Evidence counts: outcomes that arrived, were verified, were incorporated, and are still pending. */
export interface LearningEvidenceCounts {
  /** Outcomes that arrived. */
  arrived: number;
  /** Outcomes verified against an episode. */
  verified: number;
  /** Verified outcomes already used to learn. */
  incorporated: number;
  /** Outcomes still waiting (for example on a pending receipt). */
  pending: number;
}

/** `GET /v1/call-types/{id}/learning`: the learning status of one call type. */
export interface LearningStatus {
  /** The call type id. */
  call_type_id: string;
  /** The learning state. */
  state: LearningState;
  /** A stable machine reason for the state, when there is one (for example `provider_missing`). */
  reason?: string | null;
  /** The learning provider: the reflection model and whether it is usable. */
  provider?: { model: string | null; state?: string } | null;
  /** The promotion policy. */
  promotion?: LearningPromotionPolicy | null;
  /** The version serving now (the incumbent), or `null`. */
  active?: LearningVersionRef | null;
  /** The newest candidate, or `null`. */
  candidate?: LearningVersionRef | null;
  /** The running or latest evaluation, or `null`. */
  evaluation?: LearningEvaluation | null;
  /** Evidence counts. */
  evidence?: LearningEvidenceCounts;
  /** Outcomes waiting to be learned from. */
  backlog?: number | null;
  /** The learning budget: its state and what is left. */
  budget?: { state: 'ok' | 'exhausted' | (string & {}); remaining_usd?: number | null } | null;
}

/** One learned version in the history. */
export interface LearningVersion {
  /** The version id. */
  id: string;
  /** The version state. */
  state: LearningVersionState;
  /** Why the version is in this state (a stable machine code), when known. */
  state_reason?: string | null;
  /** The version this one was derived from, or `null`. */
  parent_version_id?: string | null;
  /** The number of lessons in the version. */
  lesson_count?: number;
  /** The evaluation that decided this version, when one did. */
  evaluation_id?: string | null;
  /** When the version was created (ISO-8601). */
  created_at: string;
}

/** `GET /v1/call-types/{id}/learning/versions`: the version history, newest first. */
export interface LearningVersionList {
  /** The versions. */
  data: LearningVersion[];
}

/** One lesson of a learned version. */
export interface LearningLesson {
  /** The lesson id (stable across versions). */
  id: string;
  /** The lesson text. */
  text: string;
  /** The tool the lesson is scoped to, or `null` for general guidance. */
  tool?: string | null;
  /** How many evidence cases support it. */
  evidence_count?: number;
}

/** `GET /v1/call-types/{id}/learning/versions/{version_id}`: one version, its lessons and provenance. */
export interface LearningVersionDetail extends LearningVersion {
  /** The lessons. */
  lessons: LearningLesson[];
  /** A summary of where the lessons came from. */
  provenance?: { episodes: number; outcomes: number } | null;
}

/** One arm's evidence in an evaluation. */
export interface LearningArmEvidence {
  /** The version the arm served. */
  version_id: string | null;
  /** Episodes with a verified verdict. */
  verified: number;
  /** Verified episodes that passed. */
  passed: number;
  /** Episodes whose verdict stayed unknown. */
  unknown?: number;
}

/** One prospective evaluation of a candidate against the incumbent. */
export interface LearningEvaluation {
  /** The evaluation id. */
  id: string;
  /** The decision (`running` until decided). */
  decision: LearningEvaluationDecision;
  /** Why it decided, when it has. */
  reason?: string | null;
  /** The objective, frozen when the evaluation started. */
  objective?: LearningObjective;
  /** The decision rule, frozen when the evaluation started. */
  rule?: Record<string, unknown>;
  /** The candidate arm. */
  candidate?: LearningArmEvidence;
  /** The incumbent arm. */
  incumbent?: LearningArmEvidence;
  /** The one-sided interval on (candidate − incumbent) success, in percentage points. */
  interval?: { lower: number | null; upper: number | null } | null;
  /** When it started (ISO-8601). */
  started_at?: string;
  /** When it decided (ISO-8601), else `null`. */
  decided_at?: string | null;
}

/** `GET /v1/call-types/{id}/learning/evaluations`: evaluations, newest first. */
export interface LearningEvaluationList {
  /** The evaluations. */
  data: LearningEvaluation[];
}

/** `ur.ur.learning.rollback(callTypeId, params)`: point the active version at an earlier one. */
export interface LearningRollbackParams {
  /** The exact earlier version to serve. */
  version_id: string;
  /** Why (recorded with the audit event). */
  reason?: string | undefined;
}

/** `ur.ur.learning.promote` / `reject`: an optional reason for the manual decision. */
export interface LearningDecisionParams {
  /** Why (recorded with the audit event). */
  reason?: string | undefined;
}

// ─────────────────────────────── actionable errors ───────────────────────────────

/** Why a learning control was refused, in terms you can act on. */
export type LearningErrorReason =
  | 'missing_consent'
  | 'provider_unavailable'
  | 'quota_exhausted'
  | 'budget_exhausted'
  | 'not_found'
  | 'forbidden';

/** The gateway error codes each {@link LearningErrorReason} is recognised from. */
export const LEARNING_ERROR_CODES: Readonly<Record<LearningErrorReason, readonly string[]>> = {
  missing_consent: [
    'consent_required',
    'corrections_consent_required',
    'learning_consent_required',
  ],
  provider_unavailable: [
    'learning_provider_unavailable',
    'reflection_provider_unavailable',
    'learning_unavailable',
    'provider_unavailable',
  ],
  quota_exhausted: ['quota_exhausted', 'provider_quota_exhausted', 'learning_quota_exhausted'],
  budget_exhausted: ['budget_exhausted', 'learning_budget_exhausted', 'spend_cap_exceeded'],
  not_found: ['not_found'],
  forbidden: ['permission', 'forbidden'],
};

/** What to do about each {@link LearningErrorReason}. */
export const LEARNING_ERROR_ACTIONS: Readonly<Record<LearningErrorReason, string>> = {
  missing_consent:
    "A workspace owner or admin must turn on the workspace's corrections consent before learning can be enabled.",
  provider_unavailable:
    'Configure a provider key for the reflection model in this workspace (learning never falls back to another provider), then retry.',
  quota_exhausted:
    'The learning provider refused for quota. Learning resumes on its own after the provider quota resets, or resume it once the quota is raised.',
  budget_exhausted:
    'The learning budget is spent. Raise the budget or wait for the next period, then resume learning.',
  not_found: 'Check the call type id (or slug) and the version id.',
  forbidden:
    'Use a key with the config:write scope (config:read for reads) or an owner/admin session; promote and reject need an owner or admin.',
};

/**
 * A learning control refused for a reason you can act on: `reason` names it and `action` says what
 * to do. It is an {@link UltraRouterError}, so `code`, `status`, `requestId` and `retryable` are the
 * gateway's.
 */
export class LearningError extends UltraRouterError {
  /** Why the control was refused. */
  readonly reason: LearningErrorReason;
  /** What to do about it. */
  readonly action: string;

  /** Wrap a gateway error with its learning reason. */
  constructor(cause: UltraRouterError, reason: LearningErrorReason) {
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
    this.action = LEARNING_ERROR_ACTIONS[reason];
  }
}

/** The {@link LearningErrorReason} for a gateway error code, or `null`. */
export function learningErrorReason(code: string): LearningErrorReason | null {
  for (const [reason, codes] of Object.entries(LEARNING_ERROR_CODES)) {
    if (codes.includes(code)) return reason as LearningErrorReason;
  }
  return null;
}

/**
 * Turn a gateway refusal of a learning control into a {@link LearningError} when its code is one of
 * {@link LEARNING_ERROR_CODES}; anything else (a transport failure, an unrecognised code) is returned
 * unchanged.
 */
export function toLearningError(err: unknown): unknown {
  if (!(err instanceof UltraRouterError) || err instanceof LearningError || err.status === 0) {
    return err;
  }
  const reason = learningErrorReason(err.code);
  return reason === null ? err : new LearningError(err, reason);
}
