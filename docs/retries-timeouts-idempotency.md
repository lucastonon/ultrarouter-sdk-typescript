# Retries, timeouts and idempotency

The SDK's transport retries transient failures automatically, bounds every call with a total
timeout, lets you cancel with an `AbortSignal`, and attaches an idempotency key to writes so a
retried POST can never execute twice. All of it is configurable per client and per call.

## Defaults

| Setting         | Default                          | Set it with                                                    |
| --------------- | -------------------------------- | -------------------------------------------------------------- |
| Retries         | `2` (3 attempts)                 | `new UltraRouter({ maxRetries })` or per call `{ maxRetries }` |
| Total timeout   | `600000` ms                      | `new UltraRouter({ timeout })` or per call `{ timeout }`       |
| Abort           | none                             | per call `{ signal }`                                          |
| Idempotency key | generated per non-streaming POST | per call `{ idempotencyKey }`                                  |

The constants are exported as `DEFAULT_MAX_RETRIES` and `DEFAULT_TIMEOUT_MS`.

## What is retried

A failure is retried only when it is **retryable**, there are retries left, and there is time left
before the total timeout (a stream only before it opens; see [Streaming retries](#streaming-retries)):

- Gateway errors marked retryable in the taxonomy: `rate_limited` (429), `provider_unavailable`
  (502) and `provider_timeout` (504). See the [error table](./errors.md#gateway-error-codes).
- Network failures with no response (`connection`).
- A response without the gateway's JSON error envelope (for example from a proxy) with status
  408, 429 or 5xx.

Everything else is surfaced immediately. The gateway's explicit flag wins over the status class:

- An error body that says `"retryable": false` is never retried, even with a 5xx status. A 5xx with
  no such flag (or no error body at all) is retried.
- A gateway code marked non-retryable in the taxonomy is never retried, whatever its status or
  flag: `model_unpriced`, `invalid_request`, `internal`, `atomic_spend_guard_unavailable` and the
  rest fail on the first attempt.

## Backoff

Between attempts the SDK waits with jittered exponential backoff: about 250–500 ms before the first
retry, doubling per attempt, capped at 8 s. When the response carries a `Retry-After` header (in
seconds or as an HTTP date) the SDK waits that long instead (up to 32 s). A wait never extends past
the total timeout.

```ts
import UltraRouter from '@ultrarouter/sdk';

// Retry up to 4 times, but give up after 20 seconds in total.
const ur = new UltraRouter({ maxRetries: 4, timeout: 20_000 });

// `example/flaky` fails once with provider_unavailable on the local mock gateway, then succeeds.
const res = await ur.chat.completions.create({
  model: 'example/flaky',
  messages: [{ role: 'user', content: 'hello' }],
});
console.log(res.choices[0]?.message.content);
```

## Per-call overrides

Every method takes request options as its last argument. They override the client settings for
that call only.

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();

// A latency-sensitive call: no retries, 5-second budget.
const res = await ur.chat.completions.create(
  { model: 'openai/gpt-5.2-mini', messages: [{ role: 'user', content: 'Quick yes or no?' }] },
  { maxRetries: 0, timeout: 5_000, headers: { 'x-request-source': 'checkout' } },
);
console.log(res.ur.request_id);
```

| Option           | Type                     | Effect                                                      |
| ---------------- | ------------------------ | ----------------------------------------------------------- |
| `signal`         | `AbortSignal`            | Abort the call and any pending retry.                       |
| `timeout`        | `number` (ms)            | Total time for this call, retries and backoff included.     |
| `maxRetries`     | `number`                 | Retries for this call.                                      |
| `headers`        | `Record<string, string>` | Extra headers; they win over the client's `defaultHeaders`. |
| `idempotencyKey` | `string`                 | Use this idempotency key instead of a generated one.        |

## Timeouts and cancellation

The timeout is a deadline for the whole call: every attempt, the backoff between them, and reading
the response body. When it passes, the call rejects with an `UltraRouterError` whose code is
`timeout`; when your `AbortSignal` fires, the code is `aborted`. Both have status `0` and neither
is retried. A response whose body arrives slower than the deadline fails with `timeout` while it is
being read, and aborting after the headers arrived still cancels the body read.

For a stream the deadline covers the whole stream, until the last chunk: a stream that stalls or
runs past it makes the `for await` loop throw `timeout` (and aborting your signal mid-stream makes
it throw `aborted`). Set `timeout` per call to the longest generation you accept — the default is
10 minutes. Leaving the loop early (`break`) or finishing it releases the timer and the signal.

```ts
import UltraRouter, { isUltraRouterError } from '@ultrarouter/sdk';

const ur = new UltraRouter();
const controller = new AbortController();
controller.abort(); // for example, the user navigated away before the call was made

try {
  await ur.models.list(undefined, { signal: controller.signal });
} catch (err) {
  if (isUltraRouterError(err, 'aborted')) console.log('aborted:', err.message);
  else throw err;
}
```

## Idempotency

Every non-streaming `POST` carries an `Idempotency-Key` header. The SDK generates one random UUID
per call and reuses it on every retry of that call, so when a response is lost after the gateway
already acted, the retry replays the original result instead of acting twice.

Pass your own key when the same logical operation can be submitted more than once by your
application (for example after your process restarts):

```ts
import UltraRouter from '@ultrarouter/sdk';

const ur = new UltraRouter();
const orderId = 'order-4711';

const res = await ur.chat.completions.create(
  {
    model: 'openai/gpt-5.2-mini',
    messages: [{ role: 'user', content: `Draft a receipt for ${orderId}` }],
  },
  { idempotencyKey: `receipt-${orderId}` },
);
console.log(res.id);
```

Outcome events have an extra layer: the durable outcome queue fixes each event's
`source_event_id` and `observed_at` before the first send, so a retry is recorded by the gateway as
a duplicate, never as a second event. See [outcomes](./outcomes.md).

## Streaming retries

A request with `stream: true` carries no idempotency key. If the gateway answers it with a
retryable error before the stream opens (for example `rate_limited` or `provider_unavailable`),
nothing was generated, so the SDK retries it like any other request. It is never retried after a
network failure (the request may already have reached the gateway) or once the stream has opened;
a failure mid-stream makes the `for await` loop throw. Retry at the application level if your use
case allows it. See [streaming](./streaming.md).

## Related

- [Errors](./errors.md)
- [Configuration](./configuration.md)
- [Testing your app](./testing.md)
