/**
 * The reviewer adapter: the supported way to send human approve / reject / edit decisions from your
 * review system into the ultrarouter outcome ledger. It is a typed, signed, durable client for
 * `POST /v1/flywheel/reviewer/events`. It is not a connector to any third-party review product; it is
 * the contract your reviewer system posts to.
 *
 * Three properties hold by construction:
 *
 * 1. **The adapter cannot set `learning_use` or impersonate another producer.** {@link ReviewerEvent}
 *    is aliased from the generated schema, which has no `learning_use` / `source` / `producer` /
 *    `latency_class` key. Provenance comes from the API key; learning use is derived by the gateway.
 * 2. **Every delivery is signed and replay-safe.** The signature is HMAC-SHA256 over
 *    `"<unix-seconds>.<exact request body>"`, keyed by your API key, sent as
 *    `X-UR-Reviewer-Signature: sha256=<hex>` with `X-UR-Reviewer-Timestamp`. The body is serialized
 *    once, so the signature always describes the bytes sent; a replay of the same `event_id` is a
 *    server-side no-op (`status: "duplicate"`).
 * 3. **Nothing is lost on a network failure.** Events are persisted before the first send (the
 *    {@link OutcomeStore} port: `MemoryOutcomeStore` by default, `FileOutcomeStore(path)` across
 *    restarts) and replayed verbatim by `flush()`. A refusal the gateway marks repairable is kept as a
 *    dead letter so `repair()` can re-drive it.
 *
 * Uses WebCrypto (`globalThis.crypto.subtle`) only, so it runs on edge runtimes.
 */

import { UltraRouterError } from './errors.js';
import { ulid, type DurableEntry, type OutcomeStore } from './flywheel-queue.js';
import type { components } from './generated/types.js';
import type { RequestOptions } from './types.js';

type Schemas = components['schemas'];

// ─────────────────────────────── the contract types (generated, zero drift) ───────────────────────────────

/** The closed reviewer-decision vocabulary. */
export type ReviewerDecision = Schemas['ReviewerEventInput']['decision'];

/**
 * One reviewer decision as SENT. Aliased from the generated schema: there is no `learning_use`,
 * `source` or `producer` field on it, which is what makes "the adapter cannot supply them" a
 * type-level fact rather than a promise.
 */
export type ReviewerEvent = Schemas['ReviewerEventInput'];

/** The optional, consented final a reviewer approved. `text` is stored only under consent. */
export type ReviewerFinal = NonNullable<ReviewerEvent['final']>;

/** A declared backfill window (progress is reported per id; completion is declared, never inferred). */
export type ReviewerBackfill = NonNullable<Schemas['ReviewerEventsRequest']['backfill']>;

/** The per-event verdict the server returns. */
export type ReviewerEventResult = Schemas['ReviewerEventResult'];

/** `POST /v1/flywheel/reviewer/events` response — per-event verdicts + a rollup. */
export type ReviewerEventsResponse = Schemas['ReviewerEventsResponse'];

/** `GET /v1/flywheel/reviewer/setup` — the mapping preview + the signature recipe. */
export type ReviewerSetup = Schemas['ReviewerSetupResponse'];

/** `GET /v1/flywheel/reviewer/health` — the six named states + the next repair action. */
export type ReviewerHealth = Schemas['ReviewerHealthResponse'];

/** `POST /v1/flywheel/reviewer/test` — the joined artifact + event pair from guided setup. */
export type ReviewerTestResult = Schemas['ReviewerTestResponse'];

/** `POST /v1/flywheel/reviewer/repair` — the refusal before, and the verdict after re-driving. */
export type ReviewerRepairResult = Schemas['ReviewerRepairResponse'];

/** The guided-setup scenarios. */
export type ReviewerTestScenario = NonNullable<Schemas['ReviewerTestRequest']['scenario']>;

// ─────────────────────────────── signing ───────────────────────────────

/** The header carrying the adapter signature (`sha256=<hex>`). */
export const REVIEWER_SIGNATURE_HEADER = 'x-ur-reviewer-signature';
/** The header carrying the signature's unix-second timestamp (bound INTO the MAC). */
export const REVIEWER_TIMESTAMP_HEADER = 'x-ur-reviewer-timestamp';

/** The exact bytes an adapter signs: `"<unix-seconds>.<raw request body>"`. Pure. */
export function reviewerSignedPayload(timestamp: string, rawBody: string): string {
  return `${timestamp}.${rawBody}`;
}

/**
 * Compute the `sha256=<hex>` reviewer signature with WebCrypto. The key is your ultrarouter API key
 * — the same credential that identifies the workspace and the producer, so a signature can never
 * disagree with the events it authorizes. Exported so a non-TypeScript reviewer system can be
 * checked against a known-good implementation.
 */
export async function signReviewerPayload(
  secret: string,
  timestamp: string,
  rawBody: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await globalThis.crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(reviewerSignedPayload(timestamp, rawBody)),
  );
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `sha256=${hex}`;
}

/** Build the two signature headers for an already-serialized body. */
export async function reviewerSignatureHeaders(
  secret: string,
  rawBody: string,
  nowMs: number = Date.now(),
): Promise<Record<string, string>> {
  const timestamp = String(Math.floor(nowMs / 1000));
  return {
    [REVIEWER_TIMESTAMP_HEADER]: timestamp,
    [REVIEWER_SIGNATURE_HEADER]: await signReviewerPayload(secret, timestamp, rawBody),
  };
}

// ─────────────────────────────── the durable reviewer queue ───────────────────────────────

/** One durably-queued reviewer event (persisted before its first send; replayed verbatim). */
export interface QueuedReviewerEvent extends DurableEntry {
  /** Stable queue-entry id (distinct from the reviewer's own `event_id`). */
  readonly id: string;
  /** The wire event — NEVER mutated between attempts (the retry guarantee). */
  readonly event: ReviewerEvent;
  /** The backfill this entry belongs to, when it was enqueued inside one. */
  readonly backfill?: ReviewerBackfill;
  /** The reviewer-system label to send with it. */
  readonly reviewerSystem?: string;
  /** ISO-8601 enqueue time (observability/ordering only). */
  readonly enqueued_at: string;
  /** Delivery attempts so far. */
  attempts: number;
  /**
   * Set when the server refused the event with a REPAIRABLE reason. The entry stays in the store as
   * a DEAD LETTER (we never silently drop evidence a human produced) until `repair()` clears it.
   */
  dead_letter?: { reason: string; at: string };
}

/** The transport seam: send a signed batch and resolve the per-event verdicts. */
export type ReviewerSender = (
  entries: readonly QueuedReviewerEvent[],
  backfill: ReviewerBackfill | undefined,
  reviewerSystem: string | undefined,
  options?: RequestOptions,
) => Promise<ReviewerEventsResponse>;

/** The summary `ur.reviewer.flush()` resolves to. */
export interface ReviewerFlushReport {
  /** Events the server durably recorded this flush. */
  accepted: number;
  /** Replays the server absorbed as visible no-ops. */
  duplicate: number;
  /** Events the server refused with a REPAIRABLE reason — kept as dead letters. */
  deadLettered: number;
  /** Events dropped after a terminal, non-repairable refusal. */
  dropped: number;
  /** Events still queued (a retryable transport failure — try again later). */
  pending: number;
  /** The per-event verdicts, in flush order. */
  results: ReviewerEventResult[];
}

/** Construction dependencies for {@link ReviewerQueue} (all injectable for tests). */
export interface ReviewerQueueDeps {
  /** Where events are persisted before sending. */
  store: OutcomeStore<QueuedReviewerEvent>;
  /** Sends one grouped batch. */
  send: ReviewerSender;
  /** Clock for `enqueued_at` (injectable; defaults to `Date.now`). */
  now?: () => number;
  /** Queue-entry id generator (injectable; defaults to a ULID). */
  genId?: () => string;
  /** Max events per delivery (the server accepts at most 500). */
  batchSize?: number;
}

const DEFAULT_BATCH_SIZE = 200;
const MAX_BATCH_SIZE = 500;

/**
 * The durable reviewer-event queue. `enqueue` persists the event BEFORE any byte hits the network;
 * `flush` drains everything still queued in FIFO order, in batches; a repairable refusal becomes a
 * DEAD LETTER that stays in the store (a human's decision is never discarded because our join was
 * not ready yet), and `deadLetters()` lists them for `repair()`.
 */
export class ReviewerQueue {
  private readonly store: OutcomeStore<QueuedReviewerEvent>;
  private readonly send: ReviewerSender;
  private readonly now: () => number;
  private readonly genId: () => string;
  private readonly batchSize: number;

  /** Create a queue over a store and a sender. */

  constructor(deps: ReviewerQueueDeps) {
    this.store = deps.store;
    this.send = deps.send;
    this.now = deps.now ?? (() => Date.now());
    this.genId = deps.genId ?? ulid;
    this.batchSize = Math.min(Math.max(deps.batchSize ?? DEFAULT_BATCH_SIZE, 1), MAX_BATCH_SIZE);
  }

  /**
   * Persist one reviewer event. Durable FIRST — the network is never touched here, so a crash after
   * `enqueue` loses nothing and `flush()` sends it. Returns the queue-entry id.
   */
  async enqueue(
    event: ReviewerEvent,
    opts: { backfill?: ReviewerBackfill; reviewerSystem?: string } = {},
  ): Promise<string> {
    const entry: QueuedReviewerEvent = {
      id: this.genId(),
      event,
      ...(opts.backfill !== undefined ? { backfill: opts.backfill } : {}),
      ...(opts.reviewerSystem !== undefined ? { reviewerSystem: opts.reviewerSystem } : {}),
      enqueued_at: new Date(this.now()).toISOString(),
      attempts: 0,
    };
    await this.store.append(entry);
    return entry.id;
  }

  /** Every entry still awaiting delivery (dead letters excluded). */
  async pending(): Promise<QueuedReviewerEvent[]> {
    return (await this.store.list()).filter((e) => e.dead_letter === undefined);
  }

  /** Every entry the server refused with a repairable reason. */
  async deadLetters(): Promise<QueuedReviewerEvent[]> {
    return (await this.store.list()).filter((e) => e.dead_letter !== undefined);
  }

  /** Total entries in the store (queued + dead-lettered). */
  async size(): Promise<number> {
    return (await this.store.list()).length;
  }

  /**
   * Drain the queue. Entries are grouped by `(backfill id, reviewer system)` so a declared backfill's
   * progress stays coherent, then sent in batches of at most {@link ReviewerQueueDeps.batchSize}.
   *
   * Per event, and only on a verdict that validates ({@link reviewerVerdictAction}): `accepted` /
   * `duplicate` ⇒ removed; `rejected` / `unsupported` with `repairable: true` ⇒ kept as a dead letter;
   * `rejected` / `unsupported` with `repairable: false` and a named `reason` ⇒ dropped (re-sending the
   * identical payload can never change it). A missing or malformed verdict keeps the event queued.
   * Events are only ever removed by those per-event verdicts: a failed delivery never removes one.
   * A failure whose outcome is unknown (a timeout, a cancellation, a connection failure, a 408/429/5xx
   * answer, a success whose `data` is not a list) leaves the whole batch queued and ends this flush; any
   * other non-retryable 4xx answer (a 401/403, a bad signature, an invalid batch, an HTML 400 from a
   * proxy) also leaves it queued and is THROWN rather than swallowed.
   */
  async flush(options?: RequestOptions): Promise<ReviewerFlushReport> {
    const report: ReviewerFlushReport = {
      accepted: 0,
      duplicate: 0,
      deadLettered: 0,
      dropped: 0,
      pending: 0,
      results: [],
    };
    for (const group of groupEntries(await this.pending())) {
      for (let i = 0; i < group.entries.length; i += this.batchSize) {
        const batch = group.entries.slice(i, i + this.batchSize);
        let response: ReviewerEventsResponse;
        try {
          response = await this.send(batch, group.backfill, group.reviewerSystem, options);
        } catch (err) {
          for (const entry of batch) {
            entry.attempts += 1;
            await this.store.update(entry);
          }
          // A non-retryable 4xx answer (a bad signature, a revoked key, an invalid batch) is raised;
          // anything else (timeout, cancellation, connection, 408/429/5xx, an unreadable answer) is an
          // unknown outcome. Either way the batch stays queued, untouched, for the next flush.
          if (isClientErrorAnswer(err)) throw err;
          break;
        }
        const verdicts: unknown = (response as { data?: unknown } | null)?.data;
        if (!Array.isArray(verdicts)) {
          // A success without a list of verdicts proves nothing: the batch stays queued, untouched.
          for (const entry of batch) {
            entry.attempts += 1;
            await this.store.update(entry);
          }
          break;
        }
        const byId = new Map<unknown, unknown>();
        for (const v of verdicts) {
          if (typeof v === 'object' && v !== null)
            byId.set((v as { event_id?: unknown }).event_id, v);
        }
        for (const entry of batch) {
          const result = byId.get(entry.event.event_id);
          const action = reviewerVerdictAction(result);
          if (action === 'keep') {
            // No verdict, or one that does not validate — keep it queued, never assume.
            entry.attempts += 1;
            await this.store.update(entry);
            continue;
          }
          const verdict = result as ReviewerEventResult;
          report.results.push(verdict);
          if (action === 'remove') {
            if (verdict.status === 'accepted') report.accepted += 1;
            else report.duplicate += 1;
            await this.store.remove(entry.id);
          } else if (action === 'dead_letter') {
            entry.dead_letter = { reason: verdict.reason, at: new Date(this.now()).toISOString() };
            entry.attempts += 1;
            await this.store.update(entry);
            report.deadLettered += 1;
          } else {
            await this.store.remove(entry.id);
            report.dropped += 1;
          }
        }
      }
    }
    report.pending = (await this.pending()).length;
    return report;
  }

  /** Clear a dead letter once its repair succeeded. */
  async clearDeadLetter(entryId: string): Promise<void> {
    await this.store.remove(entryId);
  }
}

/**
 * What a per-event reviewer verdict allows the queue to do. Only a verdict that validates moves an
 * event, and it must be an object with a string `event_id`:
 *
 * - `remove`: `status` is `accepted` or `duplicate` (the gateway recorded the event);
 * - `dead_letter`: `status` is `rejected` / `unsupported`, with a string `reason` and
 *   `repairable: true` (kept for `repair()`);
 * - `drop`: `status` is `rejected` / `unsupported`, with a string `reason` and `repairable: false` (a
 *   terminal refusal of this event);
 * - `keep`: anything else — no verdict, an unknown status, a refusal without a reason or without a
 *   boolean `repairable`. The event stays queued.
 */
export function reviewerVerdictAction(
  verdict: unknown,
): 'remove' | 'dead_letter' | 'drop' | 'keep' {
  if (typeof verdict !== 'object' || verdict === null) return 'keep';
  const v = verdict as Record<string, unknown>;
  if (typeof v.event_id !== 'string') return 'keep';
  if (v.status === 'accepted' || v.status === 'duplicate') return 'remove';
  if (v.status !== 'rejected' && v.status !== 'unsupported') return 'keep';
  if (typeof v.reason !== 'string' || typeof v.repairable !== 'boolean') return 'keep';
  return v.repairable ? 'dead_letter' : 'drop';
}

/**
 * Whether a failure is an HTTP 4xx answer (other than 408/429) the SDK classifies non-retryable (a
 * bad signature, a revoked key, an invalid batch, an HTML error page from a proxy). A reviewer flush
 * raises these (the batch stays queued); every other failure ends the flush quietly with the batch
 * queued. Neither ever removes an event.
 */
function isClientErrorAnswer(err: unknown): boolean {
  return (
    err instanceof UltraRouterError &&
    err.status >= 400 &&
    err.status < 500 &&
    err.status !== 408 &&
    err.status !== 429 &&
    !err.retryable
  );
}

/** Group queued entries by their declared backfill + reviewer system, preserving FIFO order. */
function groupEntries(entries: readonly QueuedReviewerEvent[]): {
  backfill: ReviewerBackfill | undefined;
  reviewerSystem: string | undefined;
  entries: QueuedReviewerEvent[];
}[] {
  const groups = new Map<
    string,
    {
      backfill: ReviewerBackfill | undefined;
      reviewerSystem: string | undefined;
      entries: QueuedReviewerEvent[];
    }
  >();
  for (const entry of entries) {
    const key = `${entry.backfill?.id ?? ''} ${entry.reviewerSystem ?? ''}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, {
        backfill: entry.backfill,
        reviewerSystem: entry.reviewerSystem,
        entries: [entry],
      });
    } else {
      group.entries.push(entry);
    }
  }
  return [...groups.values()];
}
