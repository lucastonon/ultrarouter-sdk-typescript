/**
 * The durable local outcome queue. Every outcome recorded through `ur.outcomes.record` or
 * `withArtifact` is finalized (its `observed_at` and `source_event_id` are fixed) and persisted to the
 * store before the first network send, then replayed verbatim on every retry.
 *
 * Why: because the stored event is byte-stable across attempts (same `observed_at`, same
 * client-generated `source_event_id`, same `artifact_version`), a retry can only ever be a duplicate on
 * the gateway's `(producer, target, kind, source_event_id)` idempotency key, never a conflicting second
 * event. Re-deriving `observed_at` or letting the server assign the id would double-count.
 *
 * The queue carries the typed event (ids, hashes, numeric values) only, never a body. The store is a
 * pluggable port: the default `MemoryOutcomeStore` lives in the process; `FileOutcomeStore` survives
 * restarts. Zero runtime dependencies.
 */

import {
  GATEWAY_ERROR_TAXONOMY,
  UltraRouterError,
  isGatewayErrorCode,
  type GatewayErrorCode,
} from './errors.js';
import { canonicalJson } from './context-runtime/_core/canonical-json.js';
import type { RequestOptions } from './types.js';
import type { OutcomeInput, OutcomeResult, OutcomeTarget } from './outcomes.js';

/**
 * A finalized outcome event: the caller's {@link OutcomeInput} with `observed_at` and
 * `source_event_id` guaranteed present (fixed at enqueue). This is the EXACT wire payload
 * replayed on every attempt — never re-derived.
 */
export type FinalizedOutcomeEvent = OutcomeInput & {
  observed_at: string;
  source_event_id: string;
};

/** One durably-queued outcome (persisted before its first send; replayed verbatim). */
export interface QueuedOutcome {
  /** Stable queue-entry id (distinct from the event's `source_event_id`). */
  readonly id: string;
  /** Where the outcome lands (an artifact or a request). */
  readonly target: OutcomeTarget;
  /** The finalized wire event — NEVER mutated between attempts (the retry guarantee). */
  readonly event: FinalizedOutcomeEvent;
  /** ISO-8601 enqueue time (for observability / ordering; not the event's `observed_at`). */
  readonly enqueued_at: string;
  /** Delivery attempts so far (bumped on each retryable failure). */
  attempts: number;
}

/**
 * The minimum shape a durably-queued entry must have: a stable id and an attempt counter.
 * {@link QueuedOutcome} satisfies it, and so does the reviewer queue's entry — which is
 * why the stores below are generic rather than duplicated (one durability
 * implementation, two queues).
 */
export interface DurableEntry {
  /** A stable queue-entry id. */
  readonly id: string;
  /** Delivery attempts so far. */
  attempts: number;
}

/**
 * The durability port. Every method may be sync or async. Implementations MUST persist the
 * whole entry (a real store writes it to disk before returning) so a crash after `append` but
 * before delivery never loses the event. Generic over the entry type, defaulting to
 * {@link QueuedOutcome} so every existing `OutcomeStore` usage is unchanged.
 */
export interface OutcomeStore<T extends DurableEntry = QueuedOutcome> {
  /** Persist a new entry (must be durable before resolving). */
  append(entry: T): void | Promise<void>;
  /** Persist an updated entry. */
  update(entry: T): void | Promise<void>;
  /** Remove an entry by id. */
  remove(id: string): void | Promise<void>;
  /** Every queued entry, in insertion order. */
  list(): T[] | Promise<T[]>;
}

/**
 * The receipt `ur.outcomes.record` resolves to. A delivery failure never throws: `queued` means the
 * outcome is unknown or the event was not refused (a timeout, a cancellation, a connection failure, any
 * 401/403/408/429/5xx answer, an answer without a well-formed gateway envelope such as an HTML error
 * page, or a malformed success) and the identical event stays in the store for
 * {@link OutcomeQueue.flush}; `rejected` means the server definitively refused the EVENT
 * ({@link isDefinitiveRejection}) and it was dropped. Only a store that cannot persist
 * ({@link OutcomeStoreError}) throws.
 */
export type OutcomeReceipt =
  | { status: 'delivered'; entryId: string; result: OutcomeResult }
  | { status: 'rejected'; entryId: string; error: UltraRouterError }
  | { status: 'queued'; entryId: string; error: UltraRouterError };

/** The summary `ur.outcomes.flush` resolves to. */
export interface OutcomeFlushReport {
  /** Events delivered (a server result was returned) this flush. */
  delivered: number;
  /** Events dropped this flush because the server definitively refused them ({@link isDefinitiveRejection}). */
  rejected: number;
  /** Events still queued after this flush (an unknown outcome or a refused credential — flush again later). */
  pending: number;
  /** The delivered server results, in flush order. */
  results: OutcomeResult[];
}

/** The transport seam: send ONE finalized event and resolve its server result, or throw. */
export type OutcomeSender = (
  entry: QueuedOutcome,
  options?: RequestOptions,
) => Promise<OutcomeResult>;

/** Construction dependencies for {@link OutcomeQueue} (all injectable for tests). */
export interface OutcomeQueueDeps {
  /** Where entries are persisted before sending. */
  store: OutcomeStore;
  /** Sends one finalized event. */
  send: OutcomeSender;
  /** Clock for `observed_at` + `enqueued_at` (injectable; defaults to `Date.now`). */
  now?: () => number;
  /** Queue-entry / `source_event_id` generator (injectable; defaults to a ULID). */
  genId?: () => string;
}

/**
 * The gateway error codes that refuse an outcome EVENT itself — its payload (`invalid_request`), its
 * target (`not_found`) or a different payload under its identity (`conflict`) — so that replaying the
 * identical bytes can never succeed. Every other code (the credentials, the workspace's spend, the
 * transport, a code this SDK does not know) leaves the event queued.
 */
export const EVENT_REJECTION_CODES: readonly GatewayErrorCode[] = [
  'invalid_request',
  'not_found',
  'conflict',
];

/** HTTP statuses that never drop an event, whatever the body, code or flag says. */
const NEVER_DEFINITIVE_STATUS: ReadonlySet<number> = new Set([401, 403, 408, 429]);

/**
 * Whether an error is the server DEFINITIVELY refusing an event, so a durable queue may drop it. All
 * of these must hold:
 *
 * 1. the status is a 4xx other than 401, 403, 408 and 429 (those four keep the event unconditionally);
 * 2. the response body was a well-formed gateway error envelope ({@link UltraRouterError.envelope}:
 *    `code`, `message`, `request_id` and `retryable` present with their types), whose code is the
 *    error's code;
 * 3. the code is one of {@link EVENT_REJECTION_CODES}, non-retryable in the taxonomy, and the status is
 *    the one the taxonomy assigns it (400, 404, 409);
 * 4. the envelope says `retryable: false`.
 *
 * Everything else keeps the event queued: timeouts (the SDK's own deadline included), cancellation,
 * connection failures, 5xx answers, an answer without the envelope (an HTML 400 from a proxy, an
 * empty or unreadable body), an unknown or contradictory code, and a malformed success.
 */
export function isDefinitiveRejection(err: unknown): boolean {
  if (!(err instanceof UltraRouterError)) return false;
  if (NEVER_DEFINITIVE_STATUS.has(err.status)) return false;
  if (err.status < 400 || err.status >= 500) return false;
  const envelope = err.envelope;
  if (envelope === undefined || envelope.code !== err.code) return false;
  if (envelope.retryable || err.retryable) return false;
  const code = envelope.code;
  if (!isGatewayErrorCode(code) || !EVENT_REJECTION_CODES.includes(code)) return false;
  const taxonomy = GATEWAY_ERROR_TAXONOMY[code];
  return !taxonomy.retryable && taxonomy.status === err.status;
}

// `pending` is the request shortcut's durable acceptance: the gateway holds a receipt and applies the
// outcome once the request it names has landed, so the event is delivered and leaves the queue.
const OUTCOME_RESULT_STATUSES: ReadonlySet<unknown> = new Set([
  'accepted',
  'duplicate',
  'conflict',
  'rejected',
  'pending',
]);

/** How many delivered events {@link OutcomeQueue.enqueueStable} remembers for byte-identical replays. */
const DELIVERED_MEMORY = 1024;

/** Whether a 2xx answer is an outcome result: an object whose `status` is one the contract defines. */
function isOutcomeResult(value: unknown): value is OutcomeResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    OUTCOME_RESULT_STATUSES.has((value as { status?: unknown }).status)
  );
}

/**
 * The Idempotency-Key a queued outcome is ALWAYS sent with: derived from the persisted queue-entry id,
 * so every replay — including one after a process restart with a {@link FileOutcomeStore} — carries
 * the same key as the first attempt.
 */
export function outcomeIdempotencyKey(entry: Pick<QueuedOutcome, 'id'>): string {
  return `ur-outcome-${entry.id}`;
}

/**
 * The durable outcome queue. `enqueue` persists then best-effort delivers; `flush` drains
 * everything still queued (the end-of-execution safety net, and `withArtifact`'s finally step).
 */
export class OutcomeQueue {
  private readonly store: OutcomeStore;
  private readonly send: OutcomeSender;
  private readonly now: () => number;
  private readonly genId: () => string;
  /** Recently delivered stable entries (id → event), so a repeat replays the identical bytes. */
  private readonly delivered = new Map<string, FinalizedOutcomeEvent>();
  /** Stable enqueues in flight, so concurrent repeats of one identity send once. */
  private readonly inflight = new Map<string, Promise<OutcomeReceipt>>();

  /** Create a queue over a store and a sender. */

  constructor(deps: OutcomeQueueDeps) {
    this.store = deps.store;
    this.send = deps.send;
    this.now = deps.now ?? (() => Date.now());
    this.genId = deps.genId ?? ulid;
  }

  /**
   * Finalize an outcome (fix `observed_at` + `source_event_id`), PERSIST it, THEN attempt a
   * single best-effort delivery. Only a definitive refusal of the event
   * ({@link isDefinitiveRejection}) drops it; every other failure leaves the identical entry in
   * place for {@link flush}. A delivery failure never throws; a store that cannot persist does.
   */
  async enqueue(
    target: OutcomeTarget,
    outcome: OutcomeInput,
    options?: RequestOptions,
  ): Promise<OutcomeReceipt> {
    const event: FinalizedOutcomeEvent = {
      ...outcome,
      // observed_at is fixed HERE — never re-read on a retry (the retry guarantee).
      observed_at: outcome.observed_at ?? new Date(this.now()).toISOString(),
      // The client OWNS the idempotency discriminator; letting the server assign it would
      // make a retry a fresh (non-duplicate) event. Fixed at enqueue, replayed verbatim.
      source_event_id: outcome.source_event_id ?? this.genId(),
    };
    const entry: QueuedOutcome = {
      id: this.genId(),
      target,
      event,
      enqueued_at: new Date(this.now()).toISOString(),
      attempts: 0,
    };
    // (1) DURABLE FIRST — persist the whole event before any byte hits the network.
    await this.store.append(entry);
    // (2) then attempt delivery.
    return this.deliver(entry, options);
  }

  /**
   * Like {@link enqueue}, under a caller-chosen stable entry id (so the Idempotency-Key, derived from
   * the entry id, is stable too). A repeat of the same identity never creates a second event:
   *
   * - an entry with that id still in the store is replayed verbatim;
   * - an entry delivered earlier by this queue is replayed with its original bytes (`observed_at`
   *   included) unless the caller now sends a different payload;
   * - a different payload under the same `source_event_id` is sent as its own entry, so the gateway
   *   answers it as a conflict instead of it silently replacing the first;
   * - concurrent calls for one id share one send.
   */
  enqueueStable(
    entryId: string,
    target: OutcomeTarget,
    outcome: OutcomeInput & { source_event_id: string },
    options?: RequestOptions,
  ): Promise<OutcomeReceipt> {
    const running = this.inflight.get(entryId);
    if (running !== undefined) return running;
    const run = this.runStable(entryId, target, outcome, options).finally(() => {
      this.inflight.delete(entryId);
    });
    this.inflight.set(entryId, run);
    return run;
  }

  private async runStable(
    entryId: string,
    target: OutcomeTarget,
    outcome: OutcomeInput & { source_event_id: string },
    options?: RequestOptions,
  ): Promise<OutcomeReceipt> {
    const stored = (await this.store.list()).find((e) => e.id === entryId);
    const known = stored?.event ?? this.delivered.get(entryId);
    if (known !== undefined) {
      const candidate: FinalizedOutcomeEvent = {
        ...outcome,
        observed_at: outcome.observed_at ?? known.observed_at,
      };
      if (canonicalJson(candidate) !== canonicalJson(known)) {
        // The same identity with a different payload: never overwrite the first event. Send it as
        // its own entry; the gateway answers it as a conflict.
        return this.enqueue(target, candidate, options);
      }
      if (stored !== undefined) return this.deliver(stored, options);
      const replay: QueuedOutcome = {
        id: entryId,
        target,
        event: known,
        enqueued_at: new Date(this.now()).toISOString(),
        attempts: 0,
      };
      await this.store.append(replay);
      return this.deliver(replay, options);
    }
    const entry: QueuedOutcome = {
      id: entryId,
      target,
      event: { ...outcome, observed_at: outcome.observed_at ?? new Date(this.now()).toISOString() },
      enqueued_at: new Date(this.now()).toISOString(),
      attempts: 0,
    };
    await this.store.append(entry);
    return this.deliver(entry, options);
  }

  /**
   * Drain every queued outcome, replaying each stored event verbatim (same `source_event_id`, same
   * `observed_at`, same Idempotency-Key). Delivered and definitively refused entries are removed;
   * everything else stays for the next flush.
   */
  async flush(options?: RequestOptions): Promise<OutcomeFlushReport> {
    const entries = await this.store.list();
    const report: OutcomeFlushReport = { delivered: 0, rejected: 0, pending: 0, results: [] };
    for (const entry of entries) {
      const receipt = await this.deliver(entry, options);
      if (receipt.status === 'delivered') {
        report.delivered += 1;
        report.results.push(receipt.result);
      } else if (receipt.status === 'rejected') {
        report.rejected += 1;
      }
    }
    report.pending = (await this.store.list()).length;
    return report;
  }

  /** The number of outcomes still durably queued (awaiting a successful flush). */
  async size(): Promise<number> {
    return (await this.store.list()).length;
  }

  /** Remember a delivered event (bounded, oldest forgotten first) for {@link enqueueStable}. */
  private remember(entry: QueuedOutcome): void {
    this.delivered.delete(entry.id);
    this.delivered.set(entry.id, entry.event);
    if (this.delivered.size > DELIVERED_MEMORY) {
      const oldest = this.delivered.keys().next().value;
      if (oldest !== undefined) this.delivered.delete(oldest);
    }
  }

  /** Send one entry VERBATIM; classify the outcome; update the store accordingly. */
  private async deliver(entry: QueuedOutcome, options?: RequestOptions): Promise<OutcomeReceipt> {
    try {
      const result = await this.send(entry, options);
      if (!isOutcomeResult(result)) {
        // A success the contract does not describe (an empty body, another JSON shape) proves nothing.
        throw new UltraRouterError({
          code: 'invalid_response',
          message: 'the outcome route answered without a recognisable result',
          status: 0,
          retryable: false,
        });
      }
      await this.store.remove(entry.id);
      this.remember(entry);
      return { status: 'delivered', entryId: entry.id, result };
    } catch (err) {
      const error =
        err instanceof UltraRouterError
          ? err
          : new UltraRouterError({
              code: 'connection',
              message: err instanceof Error ? err.message : String(err),
              status: 0,
              retryable: true,
            });
      if (isDefinitiveRejection(error)) {
        // The server refused THIS event (invalid, unknown target, a conflicting payload): replaying
        // the identical bytes can never change that, so it is dropped and reported.
        await this.store.remove(entry.id);
        return { status: 'rejected', entryId: entry.id, error };
      }
      // Unknown outcome (timeout, cancellation, connection, 401/403/408/429/5xx, no well-formed
      // envelope, a malformed success): keep the identical event for a later flush.
      entry.attempts += 1;
      await this.store.update(entry);
      return { status: 'queued', entryId: entry.id, error };
    }
  }
}

// ─────────────────────────────── stores ───────────────────────────────

/**
 * The default in-process store (durable for the lifetime of the client — survives transient
 * send failures across retries/flush). Insertion order is preserved so flush replays FIFO.
 */
export class MemoryOutcomeStore<T extends DurableEntry = QueuedOutcome> implements OutcomeStore<T> {
  private readonly entries = new Map<string, T>();

  /** Store a new entry. */

  append(entry: T): void {
    this.entries.set(entry.id, entry);
  }
  /** Replace an existing entry. */
  update(entry: T): void {
    if (this.entries.has(entry.id)) this.entries.set(entry.id, entry);
  }
  /** Remove an entry by id. */
  remove(id: string): void {
    this.entries.delete(id);
  }
  /** Every queued entry, in insertion order. */
  list(): T[] {
    return [...this.entries.values()];
  }
}

/**
 * A {@link FileOutcomeStore} file that cannot be read, is not valid JSON, does not hold a list of
 * queue entries, or cannot be written. The file is never overwritten after a failed read, so its
 * events can be recovered by hand.
 */
export class OutcomeStoreError extends Error {
  /** The queue file this error is about. */
  readonly path: string;

  /** Create the error for a queue file. */
  constructor(path: string, message: string) {
    super(message);
    this.name = 'OutcomeStoreError';
    this.path = path;
  }
}

/** The minimal `node:fs/promises` surface the file store needs (typed shim for the lazy import). */
interface FsPromisesLike {
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  writeFile(path: string, data: string, options: { encoding: 'utf8'; mode: number }): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  unlink(path: string): Promise<void>;
}

/**
 * Load `node:fs/promises` at runtime. The specifier is read from an object property so the
 * edge/bundler static analysis can't fold it into the module graph — the SDK core stays
 * edge-portable and this import only executes if a program actually uses {@link FileOutcomeStore}.
 */
async function loadNodeFs(): Promise<FsPromisesLike> {
  const ref = { specifier: 'node:fs/promises' };
  return (await import(ref.specifier)) as unknown as FsPromisesLike;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * A Node file-backed store for CROSS-RESTART durability (opt-in). It serializes the whole queue
 * to a JSON file, rewriting it atomically (a temporary file with mode `0600`, then a rename) on
 * every mutation and reading it back on first use. `node:fs/promises` is imported LAZILY (see
 * {@link loadNodeFs}) so the SDK core stays edge-portable and zero-dep. Mutations are serialized
 * through an internal promise chain (no concurrent writes); point two clients at two files.
 *
 * The store starts empty ONLY when the file does not exist. A file that cannot be read, is not valid
 * JSON, or does not hold a list of entries throws {@link OutcomeStoreError} on every operation and is
 * never overwritten, so the events in it can be recovered.
 */
export class FileOutcomeStore<T extends DurableEntry = QueuedOutcome> implements OutcomeStore<T> {
  private readonly path: string;
  private loaded = false;
  private cache: T[] = [];
  private tail: Promise<unknown> = Promise.resolve();

  /** Persist the queue as JSON at `path` (created, with its directory, on first write). */

  constructor(path: string) {
    this.path = path;
  }

  /** Persist a new entry. */

  append(entry: T): Promise<void> {
    return this.mutate((items) => {
      items.push(entry);
    });
  }
  /** Persist an updated entry. */
  update(entry: T): Promise<void> {
    return this.mutate((items) => {
      const i = items.findIndex((e) => e.id === entry.id);
      if (i >= 0) items[i] = entry;
    });
  }
  /** Remove an entry by id. */
  remove(id: string): Promise<void> {
    return this.mutate((items) => {
      const i = items.findIndex((e) => e.id === id);
      if (i >= 0) items.splice(i, 1);
    });
  }
  /** Every queued entry, in insertion order. */
  async list(): Promise<T[]> {
    return this.serialize(async () => {
      await this.ensureLoaded();
      return this.cache.map((e) => ({ ...e }));
    });
  }

  private mutate(fn: (items: T[]) => void): Promise<void> {
    return this.serialize(async () => {
      await this.ensureLoaded();
      const next = [...this.cache];
      fn(next);
      await this.persist(next);
      this.cache = next;
    });
  }

  /** Run `fn` after all prior store operations complete (a strict serial chain). */
  private serialize<R>(fn: () => Promise<R>): Promise<R> {
    const run = this.tail.then(fn, fn);
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    const fs = await loadNodeFs();
    let raw: string;
    try {
      raw = await fs.readFile(this.path, 'utf8');
    } catch (err) {
      if ((err as { code?: unknown }).code === 'ENOENT') {
        this.cache = [];
        this.loaded = true;
        return;
      }
      throw new OutcomeStoreError(
        this.path,
        `cannot read the queue file ${this.path}: ${errorText(err)}; it was left untouched`,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new OutcomeStoreError(
        this.path,
        `the queue file ${this.path} is not valid JSON (${errorText(err)}); it was left untouched so its events can be recovered`,
      );
    }
    if (
      !Array.isArray(parsed) ||
      !parsed.every(
        (e: unknown) =>
          typeof e === 'object' && e !== null && typeof (e as { id?: unknown }).id === 'string',
      )
    ) {
      throw new OutcomeStoreError(
        this.path,
        `the queue file ${this.path} does not hold a list of queue entries; it was left untouched so its events can be recovered`,
      );
    }
    this.cache = parsed as T[];
    this.loaded = true;
  }

  private async persist(items: readonly T[]): Promise<void> {
    const fs = await loadNodeFs();
    const slash = Math.max(this.path.lastIndexOf('/'), this.path.lastIndexOf('\\'));
    const tmp = `${this.path}.${ulid()}.tmp`;
    try {
      if (slash > 0) await fs.mkdir(this.path.slice(0, slash), { recursive: true });
      await fs.writeFile(tmp, JSON.stringify(items), { encoding: 'utf8', mode: 0o600 });
      await fs.rename(tmp, this.path);
    } catch (err) {
      await fs.unlink(tmp).catch(() => undefined);
      throw new OutcomeStoreError(
        this.path,
        `cannot write the queue file ${this.path}: ${errorText(err)}`,
      );
    }
  }
}

// ─────────────────────────────── ULID (pure, edge-portable) ───────────────────────────────

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * A lexicographically-sortable ULID (48-bit timestamp + 80-bit randomness, Crockford base32).
 * Uses the global `crypto.getRandomValues` (edge-portable). This is the default
 * `source_event_id` / queue-entry generator; it is INJECTABLE so tests stay deterministic.
 */
export function ulid(now: number = Date.now()): string {
  let ts = Math.floor(now);
  let time = '';
  for (let i = 0; i < 10; i += 1) {
    time = CROCKFORD[ts % 32] + time;
    ts = Math.floor(ts / 32);
  }
  const rnd = new Uint8Array(16);
  globalThis.crypto.getRandomValues(rnd);
  let rand = '';
  for (let i = 0; i < 16; i += 1) rand += CROCKFORD[rnd[i]! % 32];
  return time + rand;
}
