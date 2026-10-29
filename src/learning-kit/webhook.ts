/**
 * A starter receiver for delayed outcomes delivered by your own systems as signed webhooks (an order
 * shipped, a ticket stayed closed, an invoice was paid). It verifies the HMAC-SHA256 signature in
 * constant time, refuses a timestamp outside the tolerance window, deduplicates redeliveries by
 * event id, and reports the verdict with `source: 'webhook'`.
 *
 * When the payload carries no `observed_at`, the signed timestamp is used (as
 * `YYYY-MM-DDTHH:MM:SS.000Z`), so every process handling the same delivery sends byte-identical
 * events.
 *
 * Signature scheme: the sender computes `sha256=` + the hex HMAC-SHA256, keyed with the shared
 * secret, of `"<timestamp>.<raw body>"` (timestamp in Unix seconds), and sends it in
 * `x-webhook-signature` with the timestamp in `x-webhook-timestamp` ({@link signWebhook} does
 * this). The secret comes from `ULTRAROUTER_WEBHOOK_SECRET` unless you pass one; it is never logged
 * and never appears in an error or a result.
 *
 * Uses WebCrypto only, so it runs on Node.js, Deno, Bun and edge runtimes.
 */

import { signReviewerPayload } from '../reviewer.js';
import type {
  OutcomeReportParams,
  OutcomeReportResult,
  OutcomeVerdict,
} from '../outcome-report.js';

/** The default signature header. */
export const WEBHOOK_SIGNATURE_HEADER = 'x-webhook-signature';
/** The default timestamp header (Unix seconds). */
export const WEBHOOK_TIMESTAMP_HEADER = 'x-webhook-timestamp';
/** The environment variable the secret is read from when none is passed. */
export const WEBHOOK_SECRET_ENV = 'ULTRAROUTER_WEBHOOK_SECRET';
/** The default timestamp tolerance, in seconds (either direction). */
export const WEBHOOK_DEFAULT_TOLERANCE_S = 300;

/** Why a delivery was refused before anything was reported. */
export type WebhookRejectReason =
  | 'missing_signature'
  | 'missing_timestamp'
  | 'malformed_signature'
  | 'malformed_timestamp'
  | 'stale_timestamp'
  | 'bad_signature'
  | 'malformed_payload';

/** The signature check's answer. */
export type WebhookSignatureCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: Exclude<WebhookRejectReason, 'malformed_payload'> };

function readEnv(name: string): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  const value = proc?.env?.[name];
  return value === undefined || value === '' ? undefined : value;
}

/** Compare two equal-format strings without an early exit (constant time in their length). */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const SIGNATURE_FORMAT = /^sha256=[0-9a-f]{64}$/;
const TIMESTAMP_FORMAT = /^[0-9]{1,12}$/;

/**
 * Sign a webhook body the way {@link createWebhookReceiver} verifies it. Returns the headers to
 * send. For senders and tests.
 */
export async function signWebhook(
  secret: string,
  rawBody: string,
  timestampSeconds: number = Math.floor(Date.now() / 1000),
): Promise<Record<string, string>> {
  const timestamp = String(Math.floor(timestampSeconds));
  return {
    [WEBHOOK_TIMESTAMP_HEADER]: timestamp,
    [WEBHOOK_SIGNATURE_HEADER]: await signReviewerPayload(secret, timestamp, rawBody),
  };
}

/** The inputs of {@link verifyWebhookSignature}. */
export interface VerifyWebhookParams {
  /** The shared secret. */
  secret: string;
  /** The raw request body, exactly as received (before any JSON parsing). */
  rawBody: string;
  /** The signature header value, `sha256=<hex>`. */
  signature: string | null | undefined;
  /** The timestamp header value (Unix seconds). */
  timestamp: string | null | undefined;
  /** The tolerance, in seconds, either direction (default 300). */
  toleranceSeconds?: number | undefined;
  /** The clock, in ms (default `Date.now`). */
  now?: (() => number) | undefined;
}

/**
 * Verify a webhook signature: both headers present and well formed, the timestamp within the
 * tolerance of now, and the HMAC equal in constant time.
 */
export async function verifyWebhookSignature(
  params: VerifyWebhookParams,
): Promise<WebhookSignatureCheck> {
  const { signature, timestamp } = params;
  if (signature === null || signature === undefined || signature === '') {
    return { ok: false, reason: 'missing_signature' };
  }
  if (timestamp === null || timestamp === undefined || timestamp === '') {
    return { ok: false, reason: 'missing_timestamp' };
  }
  if (!SIGNATURE_FORMAT.test(signature)) return { ok: false, reason: 'malformed_signature' };
  if (!TIMESTAMP_FORMAT.test(timestamp)) return { ok: false, reason: 'malformed_timestamp' };
  const tolerance = params.toleranceSeconds ?? WEBHOOK_DEFAULT_TOLERANCE_S;
  const nowS = Math.floor((params.now ?? Date.now)() / 1000);
  if (Math.abs(nowS - Number(timestamp)) > tolerance)
    return { ok: false, reason: 'stale_timestamp' };
  const expected = await signReviewerPayload(params.secret, timestamp, params.rawBody);
  return constantTimeEqual(expected, signature)
    ? { ok: true }
    : { ok: false, reason: 'bad_signature' };
}

/**
 * Where seen event ids are kept. `claim` must be atomic: it returns `true` only to the first caller
 * for an id (until the claim expires or is released). Implement it over Redis `SET NX PX` or a
 * unique database row to deduplicate across processes.
 */
export interface WebhookDedupeStore {
  /** Claim an event id for `ttlMs`; `true` when this call claimed it, `false` when already claimed. */
  claim(eventId: string, ttlMs: number): boolean | Promise<boolean>;
  /** Release a claim whose processing did not complete, so a redelivery is processed again. */
  release(eventId: string): void | Promise<void>;
}

/**
 * The default in-process {@link WebhookDedupeStore}: claims expire after their TTL, and the oldest
 * claims are forgotten beyond `maxEntries` (default 10,000). One process only.
 */
export class MemoryWebhookDedupeStore implements WebhookDedupeStore {
  private readonly claims = new Map<string, number>();
  private readonly maxEntries: number;
  private readonly now: () => number;

  /** Create a store (`maxEntries` default 10,000; `now` default `Date.now`). */
  constructor(options: { maxEntries?: number; now?: () => number } = {}) {
    this.maxEntries = options.maxEntries ?? 10_000;
    this.now = options.now ?? Date.now;
  }

  /** Claim an id unless an unexpired claim exists. */
  claim(eventId: string, ttlMs: number): boolean {
    const now = this.now();
    const expires = this.claims.get(eventId);
    if (expires !== undefined && expires > now) return false;
    this.claims.delete(eventId);
    this.claims.set(eventId, now + ttlMs);
    while (this.claims.size > this.maxEntries) {
      const oldest = this.claims.keys().next().value;
      if (oldest === undefined) break;
      this.claims.delete(oldest);
    }
    return true;
  }

  /** Forget a claim. */
  release(eventId: string): void {
    this.claims.delete(eventId);
  }

  /** The number of claims held (expired ones included until they are reclaimed or evicted). */
  get size(): number {
    return this.claims.size;
  }
}

/** One delivered outcome, as your payload describes it. */
export interface WebhookOutcome {
  /** The sender's unique event id (the dedupe key). */
  eventId: string;
  /** The gateway request id the outcome is about. */
  requestId: string;
  /** The verdict. `unknown` reports nothing. */
  verdict: OutcomeVerdict;
  /** When it happened (ISO-8601), if the sender says. */
  observedAt?: string | undefined;
  /** A content hash of the sender's evidence, if any. */
  evidenceHash?: string | undefined;
}

/** Anything with the client's `report` method (pass `ur.ur.outcomes`). */
export interface WebhookReporter {
  /** Report a webhook verdict on a request. */
  report(
    requestId: string,
    params: OutcomeReportParams<'webhook'>,
  ): Promise<OutcomeReportResult<'webhook'>>;
}

/** Options for {@link createWebhookReceiver}. */
export interface WebhookReceiverOptions {
  /** Where verdicts are reported (pass `ur.ur.outcomes`). */
  reporter: WebhookReporter;
  /** The shared secret (default: the `ULTRAROUTER_WEBHOOK_SECRET` environment variable). */
  secret?: string | undefined;
  /** The timestamp tolerance in seconds, either direction (default 300). */
  toleranceSeconds?: number | undefined;
  /** Where seen event ids are kept (default: an in-process {@link MemoryWebhookDedupeStore}). */
  dedupe?: WebhookDedupeStore | undefined;
  /** How long an event id stays claimed, in ms (default 7 days; longer than any redelivery window). */
  dedupeTtlMs?: number | undefined;
  /** The signature header name (default `x-webhook-signature`). */
  signatureHeader?: string | undefined;
  /** The timestamp header name (default `x-webhook-timestamp`). */
  timestampHeader?: string | undefined;
  /**
   * Map your payload to a {@link WebhookOutcome}. The default reads
   * `{ event_id, request_id, verdict, observed_at?, evidence_hash? }`. Throw to refuse it.
   */
  parse?: ((payload: unknown) => WebhookOutcome) | undefined;
  /** The clock, in ms (default `Date.now`). */
  now?: (() => number) | undefined;
}

/** One received HTTP request: its headers and the raw body, exactly as received. */
export interface WebhookRequest {
  /** The request headers (a `Headers` object or Node's lower-cased header record). */
  headers: Headers | Readonly<Record<string, string | readonly string[] | undefined>>;
  /** The raw body text. Verify before parsing: never re-serialize it. */
  rawBody: string;
}

/**
 * What the receiver did, with the HTTP status to answer the sender: `reported` and `duplicate` are
 * 200 (stop redelivering); `rejected` is 400 / 401 (never retried successfully); `deferred` is 503
 * (the gateway did not acknowledge yet; the claim is released so the sender's redelivery reports
 * again, under the same identity, so nothing is double-reported).
 */
export type WebhookHandleResult =
  | {
      readonly status: 'reported';
      readonly httpStatus: 200;
      readonly eventId: string;
      readonly requestId: string;
      readonly report: OutcomeReportResult<'webhook'>;
    }
  | { readonly status: 'duplicate'; readonly httpStatus: 200; readonly eventId: string }
  | {
      readonly status: 'rejected';
      readonly httpStatus: 400 | 401;
      readonly reason: WebhookRejectReason;
    }
  | {
      readonly status: 'deferred';
      readonly httpStatus: 503;
      readonly eventId: string;
      readonly reason: string;
    };

/** A webhook receiver: hand it each request; answer the sender with `httpStatus`. */
export interface WebhookReceiver {
  /** Verify, deduplicate and report one delivery. */
  handle(request: WebhookRequest): Promise<WebhookHandleResult>;
}

function header(headers: WebhookRequest['headers'], name: string): string | undefined {
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name) ?? undefined;
  }
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    if (key.toLowerCase() !== lower) continue;
    const first: unknown = Array.isArray(value) ? value[0] : value;
    return typeof first === 'string' ? first : undefined;
  }
  return undefined;
}

const VERDICTS: readonly string[] = ['pass', 'fail', 'unknown'];

/** The default payload mapping: `{ event_id, request_id, verdict, observed_at?, evidence_hash? }`. */
export function parseWebhookOutcome(payload: unknown): WebhookOutcome {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('payload is not an object');
  }
  const p = payload as Record<string, unknown>;
  if (typeof p.event_id !== 'string' || p.event_id === '') throw new Error('event_id is missing');
  if (typeof p.request_id !== 'string' || p.request_id === '')
    throw new Error('request_id is missing');
  if (typeof p.verdict !== 'string' || !VERDICTS.includes(p.verdict))
    throw new Error('verdict is invalid');
  return {
    eventId: p.event_id,
    requestId: p.request_id,
    verdict: p.verdict as OutcomeVerdict,
    ...(typeof p.observed_at === 'string' ? { observedAt: p.observed_at } : {}),
    ...(typeof p.evidence_hash === 'string' ? { evidenceHash: p.evidence_hash } : {}),
  };
}

const DEFAULT_DEDUPE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Create a webhook receiver. The order of checks is fixed: both headers, the timestamp window, the
 * signature (constant-time), then the payload, then the event-id claim, then the report. A body is
 * never parsed before its signature is verified.
 *
 * @throws {Error} when no secret is passed and `ULTRAROUTER_WEBHOOK_SECRET` is not set.
 */
export function createWebhookReceiver(options: WebhookReceiverOptions): WebhookReceiver {
  const secret = options.secret ?? readEnv(WEBHOOK_SECRET_ENV);
  if (secret === undefined || secret === '') {
    throw new Error(`a webhook secret is required: pass \`secret\` or set ${WEBHOOK_SECRET_ENV}`);
  }
  const reporter = options.reporter;
  const dedupe =
    options.dedupe ??
    new MemoryWebhookDedupeStore(options.now !== undefined ? { now: options.now } : {});
  const ttl = options.dedupeTtlMs ?? DEFAULT_DEDUPE_TTL_MS;
  const signatureHeader = options.signatureHeader ?? WEBHOOK_SIGNATURE_HEADER;
  const timestampHeader = options.timestampHeader ?? WEBHOOK_TIMESTAMP_HEADER;
  const parse = options.parse ?? parseWebhookOutcome;
  const reject = (reason: WebhookRejectReason): WebhookHandleResult => ({
    status: 'rejected',
    httpStatus: reason === 'malformed_payload' ? 400 : 401,
    reason,
  });

  return {
    async handle(request: WebhookRequest): Promise<WebhookHandleResult> {
      const timestamp = header(request.headers, timestampHeader);
      const check = await verifyWebhookSignature({
        secret,
        rawBody: request.rawBody,
        signature: header(request.headers, signatureHeader),
        timestamp,
        toleranceSeconds: options.toleranceSeconds,
        now: options.now,
      });
      if (!check.ok) return reject(check.reason);
      let outcome: WebhookOutcome;
      try {
        outcome = parse(JSON.parse(request.rawBody) as unknown);
      } catch {
        return reject('malformed_payload');
      }
      if (!(await dedupe.claim(outcome.eventId, ttl))) {
        return { status: 'duplicate', httpStatus: 200, eventId: outcome.eventId };
      }
      // Without a sender-given time, the signed timestamp: identical in every process that handles
      // this delivery, so racing handlers send byte-identical events.
      const observedAt = outcome.observedAt ?? new Date(Number(timestamp) * 1000).toISOString();
      let report: OutcomeReportResult<'webhook'>;
      try {
        report = await reporter.report(outcome.requestId, {
          verdict: outcome.verdict,
          source: 'webhook',
          idempotencyKey: outcome.eventId,
          observedAt,
          ...(outcome.evidenceHash !== undefined ? { evidenceHash: outcome.evidenceHash } : {}),
        });
      } catch (err) {
        await dedupe.release(outcome.eventId);
        if (err instanceof Error && (err as { code?: unknown }).code === 'invalid_request') {
          return reject('malformed_payload');
        }
        return {
          status: 'deferred',
          httpStatus: 503,
          eventId: outcome.eventId,
          reason: err instanceof Error ? err.name : 'error',
        };
      }
      if (report.status === 'queued') {
        await dedupe.release(outcome.eventId);
        return {
          status: 'deferred',
          httpStatus: 503,
          eventId: outcome.eventId,
          reason: report.error?.code ?? 'queued',
        };
      }
      return {
        status: 'reported',
        httpStatus: 200,
        eventId: outcome.eventId,
        requestId: outcome.requestId,
        report,
      };
    },
  };
}
