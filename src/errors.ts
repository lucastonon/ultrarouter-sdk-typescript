/**
 * Errors raised by `@ultrarouter/sdk`.
 *
 * Every failure the gateway returns is a JSON envelope
 * `{ error: { code, message, request_id, retryable, provider_code? } }`. The SDK surfaces it as an
 * {@link UltraRouterError} carrying the stable `code`, the HTTP `status`, the correlation
 * `requestId` and a `retryable` flag, so callers branch on a string instead of guessing from a
 * status. Client-side failures use `status: 0`: `connection` (DNS, refused or reset connection),
 * `timeout` (the `timeout` deadline passed) and `aborted` (your `AbortSignal` fired).
 */

/**
 * The body of a well-formed gateway error envelope, `{ error: { code, message, request_id,
 * retryable, provider_code? } }` (the `GatewayError` schema): every required field present with its
 * declared type. {@link UltraRouterError.envelope} carries it when, and only when, the response body
 * was exactly that.
 */
export interface GatewayErrorEnvelope {
  /** The stable error code the gateway sent. */
  readonly code: string;
  /** The human-readable, secret-free explanation. */
  readonly message: string;
  /** The gateway correlation id (`req_…`). */
  readonly request_id: string;
  /** Whether the gateway says the same request may be retried as-is (the raw flag, before any clamp). */
  readonly retryable: boolean;
  /** The raw upstream provider error code, when a provider produced the failure. */
  readonly provider_code?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate a parsed response body as a gateway error envelope. Returns the envelope only when the body
 * is `{ error: { code, message, request_id, retryable } }` with a non-empty string `code`, string
 * `message` and `request_id`, a boolean `retryable` and, when present, a string `provider_code`;
 * anything else (an HTML page from a proxy, an empty body, a different JSON shape) is `undefined`.
 */
export function parseGatewayErrorEnvelope(body: unknown): GatewayErrorEnvelope | undefined {
  if (!isPlainObject(body) || !isPlainObject(body.error)) return undefined;
  const e = body.error;
  if (
    typeof e.code !== 'string' ||
    e.code === '' ||
    typeof e.message !== 'string' ||
    typeof e.request_id !== 'string' ||
    typeof e.retryable !== 'boolean' ||
    (e.provider_code !== undefined && typeof e.provider_code !== 'string')
  ) {
    return undefined;
  }
  return {
    code: e.code,
    message: e.message,
    request_id: e.request_id,
    retryable: e.retryable,
    ...(typeof e.provider_code === 'string' ? { provider_code: e.provider_code } : {}),
  };
}

/**
 * A structured gateway or transport error. Every method on the client rejects with this class
 * (or a subclass such as {@link ModelUnpricedError}).
 *
 * @example
 * ```ts
 * import UltraRouter, { UltraRouterError } from "@ultrarouter/sdk";
 *
 * const ur = new UltraRouter();
 * try {
 *   await ur.chat.completions.create({
 *     model: "example/unpriced-model",
 *     messages: [{ role: "user", content: "hi" }],
 *   });
 * } catch (err) {
 *   if (err instanceof UltraRouterError) {
 *     console.log(err.code, err.status, err.retryable, err.requestId);
 *   }
 * }
 * ```
 */
export class UltraRouterError extends Error {
  /**
   * The stable error code: one of {@link GATEWAY_ERROR_CODES}; `connection`, `timeout` or `aborted`
   * for a transport failure, a deadline or a caller abort; `configuration` for a missing client
   * setting the SDK needs before it can send anything (today, no gateway base URL);
   * `invalid_response` for an unparseable response; `invalid_request` for a request refused before
   * sending; or `http_<status>` when a non-gateway component (a proxy, a load balancer) answered
   * without the JSON envelope.
   */
  readonly code: string;
  /** HTTP status of the failed response (`0` for a transport or timeout error). */
  readonly status: number;
  /** The gateway correlation id (`req_…`) when the gateway produced the error. Quote it in support requests. */
  readonly requestId: string | undefined;
  /** Whether the same request may be safely retried as-is. The SDK only auto-retries retryable errors. */
  readonly retryable: boolean;
  /** The raw upstream provider error code, when a provider produced the failure. */
  readonly providerCode: string | undefined;
  /**
   * The validated gateway error envelope this error was decoded from: present only when the response
   * body was a well-formed `{ error: { code, message, request_id, retryable } }` envelope
   * ({@link GatewayErrorEnvelope}); `undefined` for a transport failure, a client-side check, or an
   * answer without that envelope (for example an HTML error page from a proxy). The durable outcome
   * queue drops an event only on a rejection that carries one (`isDefinitiveRejection`).
   */
  readonly envelope: GatewayErrorEnvelope | undefined;

  /** Create an error. Usually you receive one from the client rather than constructing it. */

  constructor(opts: {
    code: string;
    message: string;
    status: number;
    requestId?: string | undefined;
    retryable: boolean;
    providerCode?: string | undefined;
    envelope?: GatewayErrorEnvelope | undefined;
  }) {
    super(opts.message);
    this.name = 'UltraRouterError';
    this.code = opts.code;
    this.status = opts.status;
    this.requestId = opts.requestId;
    this.retryable = opts.retryable;
    this.providerCode = opts.providerCode;
    this.envelope = opts.envelope;
  }
}

/**
 * The gateway error taxonomy: every stable error code with its canonical HTTP status and whether a
 * client may retry it as-is. The SDK uses this table to decide retries — a code marked
 * `retryable: false` is never retried, whatever its status.
 */
export const GATEWAY_ERROR_TAXONOMY = {
  /** Malformed or invalid request body, parameters, or an unsupported option. */
  invalid_request: { status: 400, retryable: false },
  /** A declared `ur.manifest` is structurally invalid (for example overlapping ranges). */
  manifest_invalid: { status: 400, retryable: false },
  /** A declared `ur.manifest` content hash does not match the bytes the gateway received. */
  manifest_mismatch: { status: 400, retryable: false },
  /** Missing or invalid API key. */
  authentication: { status: 401, retryable: false },
  /** The key is valid but lacks the scope or permission the route requires. */
  permission: { status: 403, retryable: false },
  /** Unknown model, request, or resource. */
  not_found: { status: 404, retryable: false },
  /** The workspace model policy forbids the requested model. Change the model or the policy. */
  model_denied_by_policy: { status: 403, retryable: false },
  /**
   * The requested model has no usable price, so the gateway refuses the call before dispatch
   * (nothing reaches a provider and nothing is billed). Use a priced model, or declare pricing on
   * the custom provider that serves it. Never retried. See {@link ModelUnpricedError}.
   */
  model_unpriced: { status: 403, retryable: false },
  /** The selected model cannot honour a requested capability (tools, `json_schema`, vision, …). */
  capability_unsupported: { status: 400, retryable: false },
  /** The active hosted prompt declares a required `{{variable}}` the request did not supply. */
  prompt_variables_missing: { status: 400, retryable: false },
  /** An idempotent write collided with a different payload under the same idempotency key. */
  conflict: { status: 409, retryable: false },
  /** Rate limit hit. Retried with backoff, honouring `Retry-After`. */
  rate_limited: { status: 429, retryable: true },
  /** The workspace or key hard spend cap is reached for the current period. */
  spend_cap_exceeded: { status: 402, retryable: false },
  /** The pre-dispatch cost estimate of this single call exceeds `ur.max_cost_usd`. */
  max_cost_exceeded: { status: 402, retryable: false },
  /** Live Bench execution is not available on this deployment (dry runs still work). */
  atomic_spend_guard_unavailable: { status: 503, retryable: false },
  /** The upstream provider is unreachable or failed. Retried with backoff. */
  provider_unavailable: { status: 502, retryable: true },
  /** The upstream provider exceeded the per-attempt deadline. Retried with backoff. */
  provider_timeout: { status: 504, retryable: true },
  /** The provider refused the content (moderation or safety). */
  content_filtered: { status: 400, retryable: false },
  /** The prompt plus the requested completion exceeds the model context window. */
  context_length: { status: 400, retryable: false },
  /** The client disconnected before the request completed. */
  cancelled: { status: 499, retryable: false },
  /** An unexpected gateway failure. Quote the `requestId` when reporting it. */
  internal: { status: 500, retryable: false },
} as const satisfies Record<string, { readonly status: number; readonly retryable: boolean }>;

/** A stable gateway error code (the closed set the gateway returns). */
export type GatewayErrorCode = keyof typeof GATEWAY_ERROR_TAXONOMY;

/**
 * Every stable gateway error code, in taxonomy order. Switch on `UltraRouterError.code` against
 * these values; a transport failure uses `connection` / `timeout` instead.
 */
export const GATEWAY_ERROR_CODES = Object.keys(
  GATEWAY_ERROR_TAXONOMY,
) as readonly GatewayErrorCode[];

/** Type guard: is `value` one of the stable {@link GatewayErrorCode}s? */
export function isGatewayErrorCode(value: string): value is GatewayErrorCode {
  return Object.prototype.hasOwnProperty.call(GATEWAY_ERROR_TAXONOMY, value);
}

/**
 * The typed error for `model_unpriced`: the gateway refused the call because the requested model
 * has no price it can bill against. It is a permission-class refusal (HTTP 403) raised before any
 * provider is called, and it is never retried.
 *
 * @example
 * ```ts
 * import UltraRouter, { ModelUnpricedError } from "@ultrarouter/sdk";
 *
 * const ur = new UltraRouter();
 * try {
 *   await ur.chat.completions.create({
 *     model: "example/unpriced-model",
 *     messages: [{ role: "user", content: "hi" }],
 *   });
 * } catch (err) {
 *   if (err instanceof ModelUnpricedError) {
 *     console.log(`pick a priced model: ${err.message}`);
 *   }
 * }
 * ```
 */
export class ModelUnpricedError extends UltraRouterError {
  /** Always `model_unpriced`. */
  declare readonly code: 'model_unpriced';
  /** Always `false`: retrying cannot succeed until the model is priced. */
  declare readonly retryable: false;

  /** Create a `model_unpriced` error (`retryable` is always `false`). */

  constructor(opts: {
    message: string;
    status: number;
    requestId?: string | undefined;
    providerCode?: string | undefined;
    envelope?: GatewayErrorEnvelope | undefined;
  }) {
    super({ ...opts, code: 'model_unpriced', retryable: false });
    this.name = 'ModelUnpricedError';
  }
}

/**
 * Type guard for SDK errors, optionally narrowed to one code.
 *
 * @example
 * ```ts
 * import { isUltraRouterError } from "@ultrarouter/sdk";
 *
 * function describe(err: unknown): string {
 *   if (isUltraRouterError(err, "rate_limited")) return "slow down";
 *   if (isUltraRouterError(err)) return `${err.code} (${String(err.status)})`;
 *   return "unexpected error";
 * }
 * console.log(describe(new Error("boom")));
 * ```
 */
export function isUltraRouterError(err: unknown, code?: string): err is UltraRouterError {
  return err instanceof UltraRouterError && (code === undefined || err.code === code);
}

/**
 * HTTP statuses the SDK treats as retryable when a response carries no gateway error code:
 * 408, 429 and every 5xx.
 */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 408 || (status >= 500 && status <= 599);
}

/**
 * Build an {@link UltraRouterError} from a non-2xx response body. For a known gateway code the
 * taxonomy decides retryability (a non-retryable code is never retried, even when the envelope or
 * the status suggests otherwise); for anything else the envelope's `retryable` flag, then the
 * status class, decides. Only fields of the declared type are read; a body that is not a
 * well-formed gateway envelope leaves {@link UltraRouterError.envelope} undefined.
 */
export function errorFromResponse(status: number, body: unknown): UltraRouterError {
  const envelope = parseGatewayErrorEnvelope(body);
  const err: Record<string, unknown> =
    isPlainObject(body) && isPlainObject(body.error) ? body.error : {};
  const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
  const code = str(err.code) || `http_${String(status)}`;
  const message = str(err.message) ?? `request failed with status ${String(status)}`;
  const requestId = str(err.request_id);
  const providerCode = str(err.provider_code);
  const flag = typeof err.retryable === 'boolean' ? err.retryable : undefined;
  if (code === 'model_unpriced') {
    return new ModelUnpricedError({ message, status, requestId, providerCode, envelope });
  }
  const retryable = isGatewayErrorCode(code)
    ? GATEWAY_ERROR_TAXONOMY[code].retryable && flag !== false
    : (flag ?? isRetryableStatus(status));
  return new UltraRouterError({
    code,
    message,
    status,
    requestId,
    retryable,
    providerCode,
    envelope,
  });
}

/**
 * Wrap a transport failure (no HTTP response). A raw network error is retryable (`connection`); a
 * timeout (`timeout`) or a caller abort through an `AbortSignal` (`aborted`) is not.
 */
export function errorFromTransport(
  cause: unknown,
  kind: 'timeout' | 'aborted' | null,
): UltraRouterError {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (kind === 'aborted') {
    return new UltraRouterError({
      code: 'aborted',
      message: `request aborted: ${message}`,
      status: 0,
      retryable: false,
    });
  }
  if (kind === 'timeout') {
    return new UltraRouterError({
      code: 'timeout',
      message: `request timed out: ${message}`,
      status: 0,
      retryable: false,
    });
  }
  return new UltraRouterError({
    code: 'connection',
    message: `connection error: ${message}`,
    status: 0,
    retryable: true,
  });
}
