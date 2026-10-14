/**
 * The fetch transport for `@ultrarouter/sdk`: automatic retries for retryable failures (rate
 * limits, provider outages, raw network errors) with jittered exponential backoff that honours
 * `Retry-After`; a total request timeout; caller `AbortSignal` support; and an auto-generated
 * idempotency key on non-streaming POSTs, stable across retries so a retried write replays
 * instead of executing twice. Uses only `fetch`, `AbortController` and `crypto.randomUUID`.
 */

import { UltraRouterError, errorFromResponse, errorFromTransport } from './errors.js';
import type { FetchLike } from './types.js';

/** The clock, sleep and jitter source the retry loop uses. Injectable so tests never wait. */
export interface RetryClock {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
}

const defaultClock: RetryClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: () => Math.random(),
};

const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8_000;

/** One HTTP request as the transport executes it. */
export interface HttpRequest {
  method: string;
  /** Absolute URL. */
  url: string;
  headers: Record<string, string>;
  /** Serialized JSON body, or undefined for GET/DELETE. */
  body?: string | undefined;
  /** A streaming request never carries an idempotency key and is retried only on a retryable response. */
  stream: boolean;
  signal?: AbortSignal | undefined;
  /** Total request timeout in ms. */
  timeoutMs: number;
  maxRetries: number;
  /** Explicit idempotency key; else one is auto-generated for retriable POSTs. */
  idempotencyKey?: string | undefined;
  /**
   * Treat a `304 Not Modified` as a successful response (return it) rather than an error. Used by
   * the conditional (`If-None-Match`) preflight request, whose 304 carries a fresh `X-UR-Grant`
   * header while the cached body stays valid.
   */
  acceptNotModified?: boolean | undefined;
}

/** The transport dependencies: the `fetch` implementation and an optional clock. */
export interface HttpTransport {
  fetch: FetchLike;
  clock?: RetryClock;
}

/** Parse a `Retry-After` header (delta-seconds or an HTTP date) into ms, or null. */
function parseRetryAfter(header: string | null, now: number): number | null {
  if (header === null) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - now);
  return null;
}

/** Jittered exponential backoff for attempt `n` (0-based), honoring `Retry-After`. */
function backoffMs(attempt: number, retryAfter: number | null, random: () => number): number {
  if (retryAfter !== null) return Math.min(retryAfter, MAX_DELAY_MS * 4);
  const exp = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
  // Full jitter in [0.5, 1.0] of the computed window (avoids a thundering herd).
  return Math.floor(exp * (0.5 + random() * 0.5));
}

/** A stable idempotency key: the caller's, else a random UUID for a retriable POST. */
function resolveIdempotencyKey(req: HttpRequest): string | undefined {
  if (req.idempotencyKey !== undefined) return req.idempotencyKey;
  // The gateway rejects Idempotency-Key on streaming chat; only non-stream POSTs get one.
  if (req.method === 'POST' && !req.stream) return globalThis.crypto.randomUUID();
  return undefined;
}

/**
 * A successful response whose deadline and caller-abort wiring stay LIVE until {@link release}: the
 * total timeout covers reading the body (JSON or SSE), not just waiting for the headers, and the
 * caller's `AbortSignal` keeps cancelling until the body is consumed or the stream is torn down.
 */
export interface OpenResponse {
  /** The 2xx (or accepted 304) response. Read its body through {@link readText} or the SSE parser. */
  readonly response: Response;
  /** Aborts when the total deadline passes or the caller's signal fires, until {@link release}. */
  readonly signal: AbortSignal;
  /** Map a failure while consuming the body to a typed error (`timeout`, `aborted` or `connection`). */
  toError(cause: unknown): UltraRouterError;
  /** Stop the deadline timer and detach the caller's abort listener. Idempotent. */
  release(): void;
}

/** One attempt's abort wiring: the caller's signal plus the remaining-deadline timer. */
interface AttemptWiring {
  readonly signal: AbortSignal;
  toError(cause: unknown): UltraRouterError;
  release(): void;
}

function wireAttempt(callerSignal: AbortSignal | undefined, remainingMs: number): AttemptWiring {
  const controller = new AbortController();
  let timedOut = false;
  let released = false;
  const onAbort = (): void => {
    controller.abort((callerSignal as AbortSignal).reason);
  };
  if (callerSignal !== undefined) {
    if (callerSignal.aborted) controller.abort(callerSignal.reason);
    else callerSignal.addEventListener('abort', onAbort, { once: true });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('timeout'));
  }, remainingMs);
  return {
    signal: controller.signal,
    toError(cause: unknown): UltraRouterError {
      if (cause instanceof UltraRouterError) return cause;
      const userAborted = callerSignal?.aborted === true;
      return errorFromTransport(cause, userAborted ? 'aborted' : timedOut ? 'timeout' : null);
    },
    release(): void {
      if (released) return;
      released = true;
      clearTimeout(timer);
      if (callerSignal !== undefined) callerSignal.removeEventListener('abort', onAbort);
    },
  };
}

/**
 * Race a promise against an abort signal: rejects with the signal's reason as soon as it aborts
 * (running `onAbort` to tear the source down), else settles like the promise. Works for every
 * `fetch` implementation, including ones that ignore the request signal once headers arrived.
 */
export function untilAborted<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  onAbort?: () => void,
): Promise<T> {
  if (signal.aborted) {
    onAbort?.();
    promise.catch(() => undefined);
    return Promise.reject(signal.reason ?? new Error('aborted'));
  }
  return new Promise<T>((resolve, reject) => {
    const listener = (): void => {
      onAbort?.();
      reject(signal.reason ?? new Error('aborted'));
    };
    signal.addEventListener('abort', listener, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', listener);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener('abort', listener);
        reject(err);
      },
    );
  });
}

/**
 * Read an {@link OpenResponse} body as UTF-8 text under the call's deadline and abort signal, then
 * release the wiring. A deadline that passes mid-body rejects with a `timeout` error, a caller abort
 * with `aborted`, a broken connection with `connection`.
 */
export async function readText(open: OpenResponse): Promise<string> {
  try {
    const body = open.response.body;
    if (body === null) return '';
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    for (;;) {
      const { value, done } = await untilAborted(reader.read(), open.signal, () => {
        void reader.cancel().catch(() => undefined);
      });
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } catch (cause) {
    throw open.toError(cause);
  } finally {
    open.release();
  }
}

/**
 * Execute one HTTP request with the retry, timeout and idempotency policy. Resolves an
 * {@link OpenResponse} for a 2xx (the caller reads the JSON or SSE body through it, still under the
 * same deadline and abort signal, and the read releases the wiring). Throws {@link UltraRouterError}
 * on a non-2xx after exhausting retries, or on a transport/timeout failure.
 */
export async function executeRequest(
  transport: HttpTransport,
  req: HttpRequest,
): Promise<OpenResponse> {
  const clock = transport.clock ?? defaultClock;
  const deadline = clock.now() + req.timeoutMs;
  const idempotencyKey = resolveIdempotencyKey(req);
  const headers: Record<string, string> = { ...req.headers };
  if (idempotencyKey !== undefined) headers['idempotency-key'] = idempotencyKey;

  let lastError: UltraRouterError | null = null;
  for (let attempt = 0; attempt <= req.maxRetries; attempt += 1) {
    const remaining = deadline - clock.now();
    if (remaining <= 0) {
      throw lastError ?? errorFromTransport(new Error('request timeout'), 'timeout');
    }

    const wiring = wireAttempt(req.signal, remaining);
    let handedOver = false;
    try {
      const response = await transport.fetch(req.url, {
        method: req.method,
        headers,
        ...(req.body !== undefined ? { body: req.body } : {}),
        signal: wiring.signal,
      });

      // A conditional request's 304 is a success to the caller (unchanged config part); its headers
      // (a fresh, uncached `X-UR-Grant`) are the payload. It carries no body and is never retried.
      if (response.ok || (req.acceptNotModified === true && response.status === 304)) {
        handedOver = true;
        return {
          response,
          signal: wiring.signal,
          toError: wiring.toError,
          release: wiring.release,
        };
      }

      // Non-2xx: decide retry vs surface. Consume the body (under the deadline) so it never leaks.
      let bodyText = '';
      try {
        bodyText = await untilAborted(response.text(), wiring.signal);
      } catch (cause) {
        if (wiring.signal.aborted) throw wiring.toError(cause);
      }
      const parsed = safeJson(bodyText);
      const err = errorFromResponse(response.status, parsed);
      lastError = err;
      // The error's `retryable` flag already folds in the gateway taxonomy: a non-retryable code
      // (for example `model_unpriced` or `invalid_request`) is never retried, whatever its status.
      // A streaming request that fails with a retryable response is retried too: the stream never
      // opened, so nothing was generated.
      const canRetry = attempt < req.maxRetries && err.retryable;
      if (!canRetry) throw err;
      const retryAfter = parseRetryAfter(response.headers.get('retry-after'), clock.now());
      await clock.sleep(cappedBackoff(attempt, retryAfter, clock, deadline));
      continue;
    } catch (cause) {
      if (cause instanceof UltraRouterError) throw cause;
      const err = wiring.toError(cause);
      lastError = err;
      // A transport failure on a streaming request is never retried: the request may already have
      // reached the gateway, and a stream carries no idempotency key.
      const canRetry = attempt < req.maxRetries && !req.stream && err.retryable;
      if (!canRetry) throw err;
      await clock.sleep(cappedBackoff(attempt, null, clock, deadline));
      continue;
    } finally {
      if (!handedOver) wiring.release();
    }
  }
  throw lastError ?? errorFromTransport(new Error('request failed'), null);
}

/** Backoff clamped so we never sleep past the total deadline. */
function cappedBackoff(
  attempt: number,
  retryAfter: number | null,
  clock: RetryClock,
  deadline: number,
): number {
  const wanted = backoffMs(attempt, retryAfter, clock.random);
  const remaining = deadline - clock.now();
  return Math.max(0, Math.min(wanted, remaining));
}

/** Parse JSON, tolerating a non-JSON error body (returns the raw text wrapper). */
function safeJson(text: string): unknown {
  if (text === '') return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: { message: text } };
  }
}
