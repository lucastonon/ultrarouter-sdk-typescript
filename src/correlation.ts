/**
 * Request and episode correlation. Every gateway response carries the request id on the
 * `x-ur-request-id` header; a client may also send its own id (`[A-Za-z0-9_-]{1,64}`) on that header
 * so it knows the id before the call returns (and still knows it when the response is lost). The
 * optional episode handle rides `x-ur-artifact` (the same key as the body field `ur.artifact`): every
 * step that carries the same key belongs to one episode, so one terminal outcome covers all of them.
 *
 * Pure and edge-portable: no IO, no Node-only API.
 */

import { UltraRouterError } from './errors.js';
import { ulid } from './flywheel-queue.js';

/** The header the gateway echoes the request id on, and accepts a client-chosen id from. */
export const REQUEST_ID_HEADER = 'x-ur-request-id';

/** The header that carries the episode handle (equivalent to the body field `ur.artifact`). */
export const EPISODE_HEADER = 'x-ur-artifact';

/** The shape the gateway accepts for a client-sent request id: 1–64 of `A-Z a-z 0-9 _ -`. */
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** The longest episode key the SDK sends in a header. */
export const EPISODE_KEY_MAX_LENGTH = 256;

/** Printable ASCII with no leading or trailing space: what a header value can carry unchanged. */
const EPISODE_KEY_PATTERN = /^[!-~](?:[ -~]*[!-~])?$/;

/** Whether `value` is a request id the gateway accepts from a client. */
export function isValidRequestId(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value);
}

/**
 * Mint a client-side request id (`req_c_<ULID>`, 32 characters). Send it with
 * `{ requestId }` on a chat or embeddings call to know the id before the call returns. The `req_c_`
 * prefix keeps a client-minted id apart from the ids the gateway mints itself.
 */
export function mintRequestId(): string {
  return `req_c_${ulid()}`;
}

/**
 * Mint an episode key (`ep_<ULID>`). Give every independent task its own key, even when two tasks
 * start with identical text: without a key the gateway groups steps by their opening text, so two
 * concurrent tasks that open the same way would be merged into one episode and share one verdict.
 */
export function mintEpisodeKey(): string {
  return `ep_${ulid()}`;
}

/** The ids {@link correlationHeaders} turns into request headers. */
export interface CorrelationOptions {
  /** A client-chosen request id (`[A-Za-z0-9_-]{1,64}`), sent as `x-ur-request-id`. */
  requestId?: string | undefined;
  /** The episode handle, sent as `x-ur-artifact`: printable ASCII, at most 256 characters. */
  episodeKey?: string | undefined;
}

function invalid(message: string): UltraRouterError {
  return new UltraRouterError({ code: 'invalid_request', message, status: 0, retryable: false });
}

/** Throw `invalid_request` unless `value` is an acceptable client request id. */
export function assertRequestId(value: unknown): asserts value is string {
  if (!isValidRequestId(value)) {
    throw invalid('a request id must be 1-64 characters of A-Z, a-z, 0-9, "_" or "-"');
  }
}

/** Throw `invalid_request` unless `value` can travel as the `x-ur-artifact` header. */
export function assertEpisodeKey(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length > EPISODE_KEY_MAX_LENGTH ||
    !EPISODE_KEY_PATTERN.test(value)
  ) {
    throw invalid(
      'an episode key must be 1-256 printable ASCII characters with no leading or trailing space; send any other key in the body as `ur.artifact`',
    );
  }
}

/**
 * The correlation headers for any HTTP client, validated: `x-ur-request-id` for `requestId`,
 * `x-ur-artifact` for `episodeKey`. Pass them as per-call headers to the official `openai` client
 * (`{ headers: correlationHeaders({ requestId, episodeKey }) }`) or to `fetch`.
 *
 * @throws {UltraRouterError} `invalid_request` for a malformed id or key.
 */
export function correlationHeaders(options: CorrelationOptions): Record<string, string> {
  const headers: Record<string, string> = {};
  if (options.requestId !== undefined) {
    assertRequestId(options.requestId);
    headers[REQUEST_ID_HEADER] = options.requestId;
  }
  if (options.episodeKey !== undefined) {
    assertEpisodeKey(options.episodeKey);
    headers[EPISODE_HEADER] = options.episodeKey;
  }
  return headers;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function fromHeaders(headers: unknown): string | null {
  if (headers === null || headers === undefined) return null;
  if (typeof (headers as Headers).get === 'function') {
    const value = (headers as Headers).get(REQUEST_ID_HEADER);
    return value === null || value === '' ? null : value;
  }
  if (isRecord(headers)) {
    for (const [name, value] of Object.entries(headers)) {
      if (name.toLowerCase() !== REQUEST_ID_HEADER) continue;
      const first = Array.isArray(value) ? (value[0] as unknown) : value;
      return typeof first === 'string' && first !== '' ? first : null;
    }
  }
  return null;
}

/**
 * Read the gateway request id from whatever you hold: an SDK result (`.requestId`), a response body
 * with the `ur` block (`ur.request_id`, which is also what the official `openai` client returns), a
 * `Response`, a `Headers` object, or anything with a `headers` property (for example the `response`
 * of the `openai` client's `.withResponse()`). Returns `null` when none is present.
 */
export function readRequestId(source: unknown): string | null {
  if (!isRecord(source)) return null;
  if (typeof Headers !== 'undefined' && source instanceof Headers) return fromHeaders(source);
  const own = (source as { requestId?: unknown }).requestId;
  if (typeof own === 'string' && own !== '') return own;
  const block = (source as { ur?: unknown }).ur;
  if (isRecord(block) && typeof block.request_id === 'string' && block.request_id !== '') {
    return block.request_id;
  }
  if ('headers' in source) return fromHeaders((source as { headers?: unknown }).headers);
  return fromHeaders(source);
}

/** The correlation the SDK attaches to every chat completion and embeddings result. */
export interface RequestCorrelation {
  /**
   * The gateway request id: the `x-ur-request-id` response header, else the body's
   * `ur.request_id`. Pass it to `ur.ur.outcomes.report`. Not enumerable, so it never appears in
   * `JSON.stringify` of the result.
   */
  readonly requestId: string;
}

/** The correlation the SDK attaches to a chat stream as soon as it opens. */
export interface StreamCorrelation {
  /**
   * The gateway request id from the `x-ur-request-id` header (or the id you sent), available before
   * the first chunk; `null` only when the gateway sent no header and you sent no id. The final
   * chunk's `ur.request_id` carries it too.
   */
  readonly requestId: string | null;
}

/** Attach a non-enumerable `requestId` to a result object. */
export function attachRequestId<T extends object, V extends string | null>(
  target: T,
  requestId: V,
): T & { readonly requestId: V } {
  Object.defineProperty(target, 'requestId', {
    value: requestId,
    enumerable: false,
    writable: false,
    configurable: true,
  });
  return target as T & { readonly requestId: V };
}
