/**
 * `ur.ur.outcomes.report`: report a task verdict on a request in plain terms (`pass`, `fail` or
 * `unknown`, plus where the verdict came from) instead of choosing an outcome channel and kind.
 *
 * The mapping below is the SDK contract. Both official SDKs carry it, and both test it against the
 * same shared fixture (`test/fixtures/outcome-verdicts.json`, schema version 1):
 *
 * | `source`        | pass                              | fail                              | Teaches? |
 * | --------------- | --------------------------------- | --------------------------------- | -------- |
 * | `verifier`      | `computable` / `oracle_pass`      | `computable` / `oracle_fail`      | yes      |
 * | `business_rule` | `computable` / `oracle_pass`      | `computable` / `oracle_fail`      | yes      |
 * | `webhook`       | `resolution` / `resolved_true`    | `resolution` / `resolved_false`   | yes      |
 * | `human_review`  | `correction` / `accepted_unchanged` | `correction` / `rejected`       | yes      |
 * | `self_rating`   | `proxy` / `thumbs` (value 1)      | `proxy` / `thumbs` (value -1)     | never    |
 *
 * Verdict `unknown` sends nothing. A self-rating is a proxy: it can rank, but it never teaches.
 *
 * Retries never double-report: every report carries a `source_event_id` derived from
 * `(requestId, verdict, source, idempotencyKey)` (see {@link reportSourceEventId}), and the event
 * is sent through the durable outcome queue under that same identity, so a lost acknowledgement, a
 * flush or a second `report` call with the same arguments replays the identical event.
 */

import { REQUEST_ID_PATTERN } from './correlation.js';
import { sha256Hex } from './diff-stats.js';
import { UltraRouterError } from './errors.js';
import type { OutcomeChannel, OutcomeInput } from './outcomes.js';
import type { OutcomeReceiptRecord, RequestOutcomeResult } from './outcome-receipts.js';

/** A task verdict: `pass`, `fail`, or `unknown` (nothing is sent). */
export type OutcomeVerdict = 'pass' | 'fail' | 'unknown';

/** Where a verdict came from. Only `self_rating` never teaches. */
export type OutcomeSource =
  'verifier' | 'business_rule' | 'webhook' | 'human_review' | 'self_rating';

/** One side (pass or fail) of a source's mapping: the outcome channel, kind and optional value. */
export interface OutcomeVerdictMapping {
  /** The outcome channel. */
  readonly channel: OutcomeChannel;
  /** The channel kind. */
  readonly kind: string;
  /** The typed value sent with the event (only `self_rating` has one). */
  readonly value?: { readonly value: number };
}

/** How one {@link OutcomeSource} maps onto outcome channels. */
export interface OutcomeSourceMapping {
  /** A short human label. */
  readonly label: string;
  /** Whether this source can teach (`false` only for the self-rating proxy). */
  readonly teaches: boolean;
  /** The event a `pass` verdict sends. */
  readonly pass: OutcomeVerdictMapping;
  /** The event a `fail` verdict sends. */
  readonly fail: OutcomeVerdictMapping;
}

/** The schema version of the verdict mapping (the shared fixture's `schema_version`). */
export const OUTCOME_VERDICTS_SCHEMA_VERSION = 1;

/** The verdict mapping, source by source. Identical to the shared fixture's `sources`. */
export const OUTCOME_VERDICTS: Readonly<Record<OutcomeSource, OutcomeSourceMapping>> = {
  verifier: {
    label: 'Automated verifier (test suite or computable check)',
    teaches: true,
    pass: { channel: 'computable', kind: 'oracle_pass' },
    fail: { channel: 'computable', kind: 'oracle_fail' },
  },
  business_rule: {
    label: 'Structured-output or business-rule validation',
    teaches: true,
    pass: { channel: 'computable', kind: 'oracle_pass' },
    fail: { channel: 'computable', kind: 'oracle_fail' },
  },
  webhook: {
    label: 'Delayed business resolution (signed webhook)',
    teaches: true,
    pass: { channel: 'resolution', kind: 'resolved_true' },
    fail: { channel: 'resolution', kind: 'resolved_false' },
  },
  human_review: {
    label: 'Human review',
    teaches: true,
    pass: { channel: 'correction', kind: 'accepted_unchanged' },
    fail: { channel: 'correction', kind: 'rejected' },
  },
  self_rating: {
    label: 'Self-rating (weak proxy; never teaches)',
    teaches: false,
    pass: { channel: 'proxy', kind: 'thumbs', value: { value: 1 } },
    fail: { channel: 'proxy', kind: 'thumbs', value: { value: -1 } },
  },
};

/** Every {@link OutcomeSource}, in table order. */
export const OUTCOME_SOURCES = Object.keys(OUTCOME_VERDICTS) as readonly OutcomeSource[];

/** Every {@link OutcomeVerdict}. */
export const OUTCOME_VERDICT_VALUES: readonly OutcomeVerdict[] = ['pass', 'fail', 'unknown'];

/** `true` for every source except `self_rating`, which is a proxy that never teaches. */
export type OutcomeTeaches<S extends OutcomeSource> = S extends 'self_rating' ? false : true;

/** The arguments of `ur.ur.outcomes.report`. */
export interface OutcomeReportParams<
  S extends OutcomeSource = OutcomeSource,
  V extends OutcomeVerdict = OutcomeVerdict,
> {
  /** The task verdict. `unknown` sends nothing (missing feedback stays unknown). */
  verdict: V;
  /** Where the verdict came from. `self_rating` is a proxy that never teaches. */
  source: S;
  /**
   * Your own key for this verdict (for example the verifier name or a webhook event id). It is part
   * of the derived identity: the same `(requestId, verdict, source, idempotencyKey)` is always the
   * same event, so retrying never double-reports. Two independent verdicts of the same source on
   * the same request need two keys.
   */
  idempotencyKey?: string | undefined;
  /**
   * When the verdict was observed (ISO-8601 or a `Date`; default: the first time it is reported).
   * Pass it explicitly when a report may be retried from another process, so the replay is
   * byte-identical.
   */
  observedAt?: string | Date | undefined;
  /** A content hash of the evidence behind the verdict (never the evidence itself). */
  evidenceHash?: string | undefined;
  /** The `source_event_id` of an earlier report this one revises. */
  supersedes?: string | undefined;
}

/** The result of reporting `unknown`: nothing was sent. */
export interface OutcomeNotReported<S extends OutcomeSource = OutcomeSource> {
  /** Always `not_reported`. */
  readonly status: 'not_reported';
  /** The request the verdict was about. */
  readonly requestId: string;
  /** Always `unknown`. */
  readonly verdict: 'unknown';
  /** The source passed in. */
  readonly source: S;
  /** Always `false`: an unknown verdict carries no signal. */
  readonly teaches: false;
  /** Always `verdict_unknown`. */
  readonly reason: 'verdict_unknown';
}

/**
 * The result of reporting `pass` or `fail`. `status` is the delivery state of the durable queue:
 * `delivered` (the gateway answered; see `result` and `receipt`), `queued` (the outcome of the send
 * is unknown or the gateway was unavailable; the identical event stays queued for
 * `ur.ur.outcomes.flush()`), or `rejected` (the gateway definitively refused the event; see `error`).
 */
export interface OutcomeReported<S extends OutcomeSource = OutcomeSource> {
  /** The delivery state. */
  readonly status: 'delivered' | 'queued' | 'rejected';
  /** The request the verdict is about. */
  readonly requestId: string;
  /** The verdict sent. */
  readonly verdict: 'pass' | 'fail';
  /** The source passed in. */
  readonly source: S;
  /** The outcome channel the verdict mapped to. */
  readonly channel: OutcomeChannel;
  /** The channel kind the verdict mapped to. */
  readonly kind: string;
  /**
   * Whether this source can teach: `false` for `self_rating` (a proxy ranks but never teaches),
   * `true` otherwise. The gateway's own assignment is in `result.learning_use`.
   */
  readonly teaches: OutcomeTeaches<S>;
  /** The `source_event_id` sent (derived unless you supplied the parts). Use it as `supersedes`. */
  readonly sourceEventId: string;
  /** The durable queue entry id (stable for the same identity). */
  readonly entryId: string;
  /** The gateway's answer when delivered, else `null`. Its `status` may be `pending`. */
  readonly result: RequestOutcomeResult | null;
  /** The durable receipt when the gateway returned one, else `null`. */
  readonly receipt: OutcomeReceiptRecord | null;
  /** Why the event is still queued or was refused, else `null`. */
  readonly error: UltraRouterError | null;
}

/** What `report` resolves to for a given source and verdict. */
export type OutcomeReportResult<
  S extends OutcomeSource = OutcomeSource,
  V extends OutcomeVerdict = OutcomeVerdict,
> = V extends 'unknown' ? OutcomeNotReported<S> : OutcomeReported<S>;

/** The version tag mixed into every derived `source_event_id`. */
export const REPORT_IDENTITY_VERSION = 'ur-outcome-report/v1';

/**
 * The `source_event_id` a report carries: `rpt_` followed by the lowercase hex SHA-256 of the UTF-8
 * string `"ur-outcome-report/v1\n" + requestId + "\n" + verdict + "\n" + source + "\n" +
 * (idempotencyKey ?? "")`. Deterministic, so the same report is always the same event.
 */
export function reportSourceEventId(
  requestId: string,
  verdict: 'pass' | 'fail',
  source: OutcomeSource,
  idempotencyKey?: string,
): string {
  const material = [REPORT_IDENTITY_VERSION, requestId, verdict, source, idempotencyKey ?? ''];
  return `rpt_${sha256Hex(material.join('\n'))}`;
}

function invalid(message: string): UltraRouterError {
  return new UltraRouterError({ code: 'invalid_request', message, status: 0, retryable: false });
}

/** A validated report: either nothing to send, or the event and its stable identity. */
export type OutcomeReportPlan =
  | { readonly send: false; readonly result: OutcomeNotReported }
  | {
      readonly send: true;
      readonly mapping: OutcomeVerdictMapping;
      readonly teaches: boolean;
      readonly verdict: 'pass' | 'fail';
      readonly event: OutcomeInput & { source_event_id: string };
    };

/**
 * Validate a report and build the event it sends. Pure: no IO.
 *
 * @throws {UltraRouterError} `invalid_request` for a malformed request id, an unknown verdict or
 * source, an empty `idempotencyKey`, or an unparseable `observedAt`.
 */
export function planOutcomeReport(
  requestId: string,
  params: OutcomeReportParams,
): OutcomeReportPlan {
  if (typeof requestId !== 'string' || !REQUEST_ID_PATTERN.test(requestId)) {
    throw invalid(
      'report needs the request id of a gateway call (1-64 of A-Z, a-z, 0-9, "_", "-")',
    );
  }
  const { verdict, source } = params;
  if (!(OUTCOME_SOURCES as readonly string[]).includes(source)) {
    throw invalid(
      `unknown outcome source '${String(source)}'; use one of ${OUTCOME_SOURCES.join(', ')}`,
    );
  }
  if (!(OUTCOME_VERDICT_VALUES as readonly string[]).includes(verdict)) {
    throw invalid(`unknown verdict '${String(verdict)}'; use pass, fail or unknown`);
  }
  if (
    params.idempotencyKey !== undefined &&
    (typeof params.idempotencyKey !== 'string' || params.idempotencyKey === '')
  ) {
    throw invalid('idempotencyKey must be a non-empty string when given');
  }
  if (verdict === 'unknown') {
    return {
      send: false,
      result: {
        status: 'not_reported',
        requestId,
        verdict,
        source,
        teaches: false,
        reason: 'verdict_unknown',
      },
    };
  }
  let observedAt: string | undefined;
  if (params.observedAt !== undefined) {
    const date =
      params.observedAt instanceof Date ? params.observedAt : new Date(params.observedAt);
    if (Number.isNaN(date.getTime()))
      throw invalid('observedAt must be an ISO-8601 instant or a Date');
    observedAt = date.toISOString();
  }
  const sourceMapping = OUTCOME_VERDICTS[source];
  const mapping = sourceMapping[verdict];
  const event: OutcomeInput & { source_event_id: string } = {
    channel: mapping.channel,
    kind: mapping.kind,
    ...(mapping.value !== undefined ? { value: { ...mapping.value } } : {}),
    source_event_id: reportSourceEventId(requestId, verdict, source, params.idempotencyKey),
    ...(observedAt !== undefined ? { observed_at: observedAt } : {}),
    ...(params.evidenceHash !== undefined ? { evidence_hash: params.evidenceHash } : {}),
    ...(params.supersedes !== undefined ? { supersedes_event_id: params.supersedes } : {}),
  };
  return { send: true, mapping, teaches: sourceMapping.teaches, verdict, event };
}
