/**
 * Outcome receipts: the durable acknowledgement the gateway gives an outcome reported on a request
 * (`POST /v1/requests/{id}/outcomes`), readable later through `GET /v1/outcome-receipts/{id}` and
 * `GET /v1/requests/{id}/outcome-receipts`.
 *
 * An outcome may arrive before the gateway has finished writing the request it names (the write is
 * asynchronous). The gateway then answers `status: "pending"` with a receipt and applies the outcome
 * once the request lands, so a client never has to wait or sleep before reporting.
 *
 * Every shape is aliased from the generated OpenAPI types, so it cannot drift from the contract.
 */

import { UltraRouterError } from './errors.js';
import type { OperationResponse } from './resources.js';

/** One outcome receipt (`object: "outcome_receipt"`, id `ocr_…`). */
export type OutcomeReceiptRecord = OperationResponse<'getOutcomeReceipt'>;

/**
 * A receipt's lifecycle: `pending` until its request is recorded, then exactly one final state —
 * `applied` (recorded), `rejected` (refused, see `reason`), `failed` (recording kept hitting an
 * internal error) or `expired` (no request with this id appeared in your workspace within 15
 * minutes; `reason: "request_not_found"`, indistinguishable from an unknown id).
 */
export type OutcomeReceiptState = OutcomeReceiptRecord['status'];

/** The episode association of an applied teaching outcome: `{ status, trace_id, verdict }`. */
export type OutcomeReceiptEpisode = OutcomeReceiptRecord['episode'];

/**
 * How an outcome relates to the request's episode: `associated` (the episode carries a verdict),
 * `pending` (a teaching outcome waiting for its episode to be recorded), `not_recorded` (no episode
 * held the request in time) or `not_applicable` (the outcome does not teach, or was not applied).
 */
export type OutcomeEpisodeAssociation = OutcomeReceiptEpisode['status'];

/**
 * What an outcome did to its episode: `recorded` (it is the verdict), `kept_earlier` (the first
 * verdict wins), `revised` (a `supersedes` revision before the episode was learned from) or
 * `revised_after_incorporation` (recorded and counted, never silently unlearned); `null` until
 * associated.
 */
export type OutcomeEpisodeVerdict = OutcomeReceiptEpisode['verdict'];

/** `GET /v1/requests/{id}/outcome-receipts`: every receipt for one request, oldest first. */
export type OutcomeReceiptList = OperationResponse<'listRequestOutcomeReceipts'>;

/**
 * The answer of `POST /v1/requests/{id}/outcomes`: the outcome result (`accepted`, `duplicate`, or
 * `pending` while the request has not been recorded yet) plus its durable `receipt`.
 */
export type RequestOutcomeResult = OperationResponse<'recordRequestOutcome'>;

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

function invalid(message: string): UltraRouterError {
  return new UltraRouterError({ code: 'invalid_response', message, status: 0, retryable: false });
}

/** Check a receipt response body; a body that is not a receipt is a typed `invalid_response`. */
export function parseOutcomeReceipt(body: unknown): OutcomeReceiptRecord {
  if (!isOutcomeReceiptRecord(body)) {
    throw invalid('the receipt route answered without a recognisable receipt');
  }
  return body;
}

/** Check a receipt-list response body (`{ object: "list", data: [...] }`). */
export function parseOutcomeReceiptList(body: unknown): OutcomeReceiptList {
  if (!isRecord(body) || !Array.isArray(body.data) || !body.data.every(isOutcomeReceiptRecord)) {
    throw invalid('the receipts route answered without a recognisable receipt list');
  }
  return body as OutcomeReceiptList;
}
