/**
 * Outcome receipts: the durable acknowledgement the gateway gives an outcome reported on a request
 * (`POST /v1/requests/{id}/outcomes`), readable later through `GET /v1/outcome-receipts/{id}` and
 * `GET /v1/requests/{id}/outcome-receipts`.
 *
 * An outcome may arrive before the gateway has finished writing the request it names (the write is
 * asynchronous). The gateway then answers `status: "pending"` with a receipt and applies the outcome
 * once the request lands, so a client never has to wait or sleep before reporting.
 *
 * These types are written by hand ahead of the published API description and are kept in this one
 * module so they can be replaced by the generated ones without touching callers. Fields may be added.
 */

import { UltraRouterError } from './errors.js';
import type { OutcomeChannel, OutcomeResult } from './outcomes.js';

/**
 * A receipt's lifecycle: `pending` until its request lands, then exactly one final state —
 * `applied` (recorded), `rejected` (refused, see `reason`), `failed` (could not be applied) or
 * `expired` (its request never landed in time; an unknown or foreign request id ends here too,
 * indistinguishable from an unknown one).
 */
export type OutcomeReceiptState = 'pending' | 'applied' | 'rejected' | 'failed' | 'expired';

/** The final receipt states: {@link OutcomeReceiptState} values other than `pending`. */
export const TERMINAL_RECEIPT_STATES: readonly OutcomeReceiptState[] = [
  'applied',
  'rejected',
  'failed',
  'expired',
];

/** Whether a receipt state is final (anything but `pending`). */
export function isTerminalReceiptState(state: string): boolean {
  return (TERMINAL_RECEIPT_STATES as readonly string[]).includes(state);
}

/**
 * How an applied outcome relates to the request's episode: `associated` (it is the episode's
 * verdict), `pending` (the episode record has not landed yet), `not_recorded` (it never landed in
 * time) or `not_applicable` (the outcome does not teach, or the request has no episode).
 */
export type OutcomeEpisodeAssociation =
  'associated' | 'pending' | 'not_recorded' | 'not_applicable';

/** One outcome receipt as the gateway reports it. */
export interface OutcomeReceiptRecord {
  /** The receipt id. */
  id: string;
  /** The request the outcome names. */
  request_id: string;
  /** The receipt state. */
  status: OutcomeReceiptState;
  /** A stable machine reason for a non-applied state (for example `request_not_found`), else `null`. */
  reason?: string | null;
  /** How the outcome relates to the request's episode. */
  episode?: OutcomeEpisodeAssociation | null;
  /** The outcome channel. */
  channel: OutcomeChannel | (string & {});
  /** The channel kind. */
  kind: string;
  /** The idempotency discriminator the outcome was reported with. */
  source_event_id?: string | null;
  /** The recorded outcome event, once applied. */
  outcome_event_id?: string | null;
  /** When the receipt was created (ISO-8601). */
  created_at?: string;
  /** When the receipt last changed (ISO-8601). */
  updated_at?: string;
  /** When the outcome was applied (ISO-8601), else `null`. */
  applied_at?: string | null;
  /** The receipt's next deadline (ISO-8601). */
  expires_at?: string | null;
}

/** `GET /v1/requests/{id}/outcome-receipts`: every receipt for one request, oldest first. */
export interface OutcomeReceiptList {
  /** The receipts. */
  data: OutcomeReceiptRecord[];
}

/**
 * The answer of `POST /v1/requests/{id}/outcomes`: the outcome result, where `status` may also be
 * `pending` (accepted durably, applied once the request lands), plus the durable receipt.
 */
export type RequestOutcomeResult = Omit<OutcomeResult, 'status'> & {
  /** `pending` (durably accepted, not applied yet), or one of the outcome result statuses. */
  status: OutcomeResult['status'] | 'pending';
  /** The durable receipt for this outcome. */
  receipt?: OutcomeReceiptRecord;
};

/** Options for `ur.ur.outcomes.waitForReceipt`. */
export interface WaitForReceiptOptions {
  /** The longest time to wait, in ms (default 30000). */
  timeoutMs?: number | undefined;
  /** Stop waiting: the call rejects with an `aborted` error. */
  signal?: AbortSignal | undefined;
  /** The first delay between reads, in ms (default 250); it doubles after every read. */
  pollIntervalMs?: number | undefined;
  /** The longest delay between reads, in ms (default 4000). */
  maxPollIntervalMs?: number | undefined;
}

/** `waitForReceipt` defaults. */
export const RECEIPT_WAIT_DEFAULTS = {
  timeoutMs: 30_000,
  pollIntervalMs: 250,
  maxPollIntervalMs: 4_000,
} as const;

/**
 * `waitForReceipt` ran out of time before the receipt reached a final state. The receipt is still
 * durable on the gateway; read it again later with `ur.ur.outcomes.receipt(id)`.
 */
export class ReceiptWaitTimeoutError extends UltraRouterError {
  /** The receipt that was being waited on. */
  readonly receiptId: string;
  /** The last receipt read before time ran out, or `null` when no read succeeded. */
  readonly lastReceipt: OutcomeReceiptRecord | null;

  /** Create the error. */
  constructor(receiptId: string, timeoutMs: number, lastReceipt: OutcomeReceiptRecord | null) {
    super({
      code: 'timeout',
      message: `receipt ${receiptId} was still ${lastReceipt?.status ?? 'unread'} after ${String(timeoutMs)}ms`,
      status: 0,
      retryable: false,
    });
    this.name = 'ReceiptWaitTimeoutError';
    this.receiptId = receiptId;
    this.lastReceipt = lastReceipt;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Whether a value looks like a receipt: an object with string `id` and `status`. */
export function isOutcomeReceiptRecord(value: unknown): value is OutcomeReceiptRecord {
  return isRecord(value) && typeof value.id === 'string' && typeof value.status === 'string';
}

/** Read one receipt from a response body: a bare receipt or one wrapped as `{ receipt }`. */
export function parseOutcomeReceipt(body: unknown): OutcomeReceiptRecord {
  const candidate = isRecord(body) && isRecord(body.receipt) ? body.receipt : body;
  if (!isOutcomeReceiptRecord(candidate)) {
    throw new UltraRouterError({
      code: 'invalid_response',
      message: 'the receipt route answered without a recognisable receipt',
      status: 0,
      retryable: false,
    });
  }
  return candidate;
}

/** Read a receipt list from a response body: `{ data: [...] }`, `{ receipts: [...] }` or a bare array. */
export function parseOutcomeReceiptList(body: unknown): OutcomeReceiptList {
  const items = Array.isArray(body)
    ? body
    : isRecord(body) && Array.isArray(body.data)
      ? body.data
      : isRecord(body) && Array.isArray(body.receipts)
        ? body.receipts
        : null;
  if (items === null || !items.every(isOutcomeReceiptRecord)) {
    throw new UltraRouterError({
      code: 'invalid_response',
      message: 'the receipts route answered without a recognisable receipt list',
      status: 0,
      retryable: false,
    });
  }
  return { data: items };
}
